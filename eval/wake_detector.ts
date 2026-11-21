/**
 * On-phone wake detector eval: the app's own inference path (src/lib/wake: Chunker ->
 * toModelInput -> WakeStream) on onnxruntime-web's WASM backend in Node.
 *  1. Trainer's held-out positives (*_1.2_* in WAKE_DATA/pos) must score >= threshold;
 *     its non-wake clips (WAKE_DATA/neg) must stay below (note: those negatives were in training).
 *  2. Synthetic counter scenes (eval/data/synth): wakes on "KhataBhai ..." lines, on chatter that
 *     merely mentions KhataBhai (reported separately), and false wakes on everything else.
 *  3. Pure noise (eval/data/noise/*.pcm, DEMAND street/cafeteria/square + babble): false wakes/hour.
 * Usage: npx tsx eval/wake_detector.ts   (WAKE_DATA=<trainer data dir>, THRESHOLD=0.5)
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import * as ort from 'onnxruntime-web'
import { Chunker, MODEL_CONTRACT, toModelInput } from '../src/lib/wake/features.js'
import { WakeStream, type MakeTensor, type SessionLike } from '../src/lib/wake/stream.js'

const MODEL = 'public/wakeword/khatabhai.onnx'
const WAKE_DATA = process.env.WAKE_DATA ?? '.claude/worktrees/agent-a0ed002bab25ebaac/wakeword/data'
const SYNTH = 'eval/data/synth'
const NOISE = 'eval/data/noise'
const THRESHOLD = Number(process.env.THRESHOLD ?? MODEL_CONTRACT.threshold)
const RATE = MODEL_CONTRACT.sampleRate
const CHUNK_MS = (MODEL_CONTRACT.chunkSamples / RATE) * 1000
/** A wake counts for a line if it fires between the line's start and 600 ms after its end. */
const LINE_TAIL_MS = 600
const WAKE_WORD = /khata[\s,.-]*bhai|खाता[\s,]*भाई|ಖಾತಾ[\s,]*ಭಾಯ್/i

ort.env.wasm.numThreads = 1
const makeTensor: MakeTensor = (type, data, dims) =>
  type === 'int64' ? new ort.Tensor('int64', data as BigInt64Array, dims) : new ort.Tensor('float32', data as Float32Array, dims)

const session = await ort.InferenceSession.create(readFileSync(MODEL), { executionProviders: ['wasm'] })
const stream = await WakeStream.open(session as unknown as SessionLike, makeTensor, { threshold: THRESHOLD })

function pcm(path: string): Int16Array {
  const b = readFileSync(path)
  return new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + (b.byteLength & ~1)))
}

let inferMs = 0
let chunks = 0
/** Streams a recording from the warm state in 512-sample mic frames (as the worklet sends them). */
async function run(audio: Int16Array): Promise<{ wakes: { ms: number; score: number }[]; max: number }> {
  stream.reset()
  const chunker = new Chunker()
  const ready: Int16Array[] = []
  for (let o = 0; o < audio.length; o += 512) chunker.push(audio.subarray(o, Math.min(o + 512, audio.length)), (c) => ready.push(c))
  // 1 s of silence so a wake word at the very end still completes
  for (let i = 0; i < 13; i++) ready.push(new Int16Array(MODEL_CONTRACT.chunkSamples))
  const wakes: { ms: number; score: number }[] = []
  let max = 0
  for (let i = 0; i < ready.length; i++) {
    const t0 = performance.now()
    const { score, wake } = await stream.step(toModelInput(ready[i]).data)
    inferMs += performance.now() - t0
    chunks++
    max = Math.max(max, score)
    if (wake) wakes.push({ ms: (i + 1) * CHUNK_MS, score })
  }
  return { wakes, max }
}

const f2 = (x: number) => x.toFixed(2)

// 1. trainer clips
if (existsSync(WAKE_DATA)) {
  for (const [dir, want] of [['pos', true], ['neg', false]] as const) {
    let files = readdirSync(`${WAKE_DATA}/${dir}`).filter((f) => f.endsWith('.pcm'))
    if (dir === 'pos') files = files.filter((f) => f.includes('_1.2_'))
    let pass = 0
    const fails: string[] = []
    const maxes: number[] = []
    for (const f of files) {
      const { max } = await run(pcm(`${WAKE_DATA}/${dir}/${f}`))
      maxes.push(max)
      if (max >= THRESHOLD === want) pass++
      else fails.push(`${f}=${f2(max)}`)
    }
    maxes.sort((a, b) => a - b)
    console.log(
      `${dir === 'pos' ? 'held-out positives (_1.2_)' : 'trainer negatives       '}: ${pass}/${files.length} ok,`,
      `max score ${f2(maxes[0])}..${f2(maxes.at(-1)!)}${fails.length ? `  FAIL: ${fails.join(' ')}` : ''}`,
    )
  }
} else console.log(`(no trainer data at ${WAKE_DATA}; skipping held-out clips)`)

// 2. synthetic scenes
type SynthLine = { text: string; addressed: boolean; startMs: number; endMs: number }
type SynthScene = { id: string; durationMs: number; lines: SynthLine[] }
let addressed = 0
let caught = 0
const missed: string[] = []
let mention = 0
let mentionFired = 0
const mentionRows: string[] = []
let otherFalse = 0
const falseRows: string[] = []
let otherMs = 0
for (const f of readdirSync(SYNTH).filter((x) => x.endsWith('.json')).sort()) {
  const scene: SynthScene = JSON.parse(readFileSync(`${SYNTH}/${f}`, 'utf-8'))
  const { wakes } = await run(pcm(`${SYNTH}/${scene.id}.pcm`))
  const used = new Set<number>()
  let claimedMs = 0
  for (const line of scene.lines) {
    const hits = wakes.filter((w, i) => w.ms >= line.startMs && w.ms <= line.endMs + LINE_TAIL_MS && !used.has(i) && used.add(i))
    const tag = `${scene.id}: "${line.text.slice(0, 48)}"`
    if (line.addressed) {
      addressed++
      claimedMs += line.endMs + LINE_TAIL_MS - line.startMs
      if (hits.length) caught++
      else missed.push(tag)
    } else if (WAKE_WORD.test(line.text)) {
      mention++
      claimedMs += line.endMs + LINE_TAIL_MS - line.startMs
      if (hits.length) mentionFired++
      mentionRows.push(`${hits.length ? 'FIRED' : 'quiet'} ${tag}${hits.length ? ` (${f2(hits[0].score)})` : ''}`)
    } else if (hits.length) {
      otherFalse += hits.length
      falseRows.push(`${tag} (${f2(hits[0].score)})`)
    }
  }
  // wakes in the gaps between lines (noise only) are false too
  wakes.forEach((w, i) => {
    if (!used.has(i)) {
      otherFalse++
      falseRows.push(`${scene.id}: gap at ${(w.ms / 1000).toFixed(1)} s (${f2(w.score)})`)
    }
  })
  otherMs += scene.durationMs + 13 * CHUNK_MS - claimedMs
}
console.log(`synth addressed lines: ${caught}/${addressed} woke`)
for (const m of missed) console.log(`  missed ${m}`)
console.log(`synth chatter that mentions KhataBhai: ${mentionFired}/${mention} woke (not_for_me handles these)`)
for (const r of mentionRows) console.log(`  ${r}`)
console.log(
  `synth other audio (chatter w/o wake word + gaps, ${(otherMs / 60000).toFixed(1)} min): ${otherFalse} false wakes`,
  `= ${f2(otherFalse / (otherMs / 3600000))}/h`,
)
for (const r of falseRows) console.log(`  false ${r}`)

// 3. pure noise
let noiseMs = 0
let noiseFalse = 0
for (const f of existsSync(NOISE) ? readdirSync(NOISE).filter((x) => x.endsWith('.pcm')) : []) {
  const audio = pcm(`${NOISE}/${f}`)
  const { wakes, max } = await run(audio)
  noiseMs += (audio.length / RATE) * 1000
  noiseFalse += wakes.length
  console.log(`noise ${f}: ${(audio.length / RATE / 60).toFixed(1)} min, ${wakes.length} wakes, max score ${f2(max)}`)
}
if (noiseMs) console.log(`pure noise: ${noiseFalse} false wakes in ${(noiseMs / 60000).toFixed(1)} min = ${f2(noiseFalse / (noiseMs / 3600000))}/h`)
console.log(`inference: ${(inferMs / chunks).toFixed(2)} ms per 80 ms chunk (Node, onnxruntime-web wasm, 1 thread), threshold ${THRESHOLD}`)
process.exit(0)
