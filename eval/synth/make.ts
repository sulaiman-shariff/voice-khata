/**
 * Render every scene: TTS per line (cached), 0.4-1.5 s gaps, noise at 5-15 dB SNR.
 * Writes <DATA>/synth/<scene>.pcm (16 kHz s16le mono) + .json (scene + per-line start/end ms).
 * DATA defaults to eval/data; set SYNTH_DATA to point at the main repo's eval/data.
 * Run: npx tsx --env-file=.env eval/synth/make.ts
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { TtsPool, type TtsSpeed } from '../../server/gnani/tts.js'
import { SCENES, type Scene } from './scenes.js'

const RATE = 16000
const DATA = process.env.SYNTH_DATA ?? 'eval/data'
const OUT = `${DATA}/synth`
const CACHE = `${DATA}/synth/tts_cache`
const NOISE_DIR = `${DATA}/noise`

/** Small deterministic PRNG so re-runs give identical mixes. */
function rng(seed: string) {
  let s = createHash('sha1').update(seed).digest().readUInt32LE(0) || 1
  return () => {
    s ^= s << 13; s >>>= 0
    s ^= s >>> 17
    s ^= s << 5; s >>>= 0
    return s / 0x100000000
  }
}

// speaker variety: speak() takes no voice argument, so rotate speed instead of voice
const SPEEDS: TtsSpeed[] = [1, 1.2, 0.8, 1]

async function render(pool: TtsPool, text: string, lang: string, speed: TtsSpeed): Promise<Buffer> {
  const f = `${CACHE}/${createHash('sha1').update(`${lang}|${speed}|${text}`).digest('hex').slice(0, 24)}.pcm`
  if (existsSync(f)) return readFileSync(f)
  const chunks: Buffer[] = []
  const r = await pool.speak(text, lang, (b) => chunks.push(b), undefined, speed)
  if (r.error || !chunks.length) throw new Error(`TTS failed for "${text}": ${r.error ?? 'no audio'}`)
  const pcm = Buffer.concat(chunks)
  writeFileSync(f, pcm)
  return pcm
}

const toInt16 = (b: Buffer) => new Int16Array(b.buffer, b.byteOffset, Math.floor(b.length / 2))
const rms = (x: ArrayLike<number>) => {
  let s = 0
  for (let i = 0; i < x.length; i++) s += x[i]! * x[i]!
  return Math.sqrt(s / Math.max(1, x.length))
}

async function makeScene(pool: TtsPool, scene: Scene, noises: Int16Array[]) {
  const rand = rng(scene.id)
  const parts: Int16Array[] = []
  const times: { startMs: number; endMs: number }[] = []
  let n = Math.round(RATE * 0.6) // lead-in
  parts.push(new Int16Array(n))
  for (const [i, line] of scene.lines.entries()) {
    const pcm = toInt16(await render(pool, line.text, line.lang, SPEEDS[i % SPEEDS.length]!))
    times.push({ startMs: Math.round((n / RATE) * 1000), endMs: Math.round(((n + pcm.length) / RATE) * 1000) })
    parts.push(pcm)
    n += pcm.length
    const gap = Math.round(RATE * (0.4 + rand() * 1.1))
    parts.push(new Int16Array(gap))
    n += gap
  }
  const speech = new Int16Array(n)
  let o = 0
  for (const p of parts) { speech.set(p, o); o += p.length }

  // noise at 5-15 dB SNR, relative to the speech RMS over the whole session
  const noise = noises[Math.floor(rand() * noises.length)]!
  const snr = 5 + rand() * 10
  const start = Math.floor(rand() * Math.max(1, noise.length - n))
  const seg = new Float32Array(n)
  for (let i = 0; i < n; i++) seg[i] = noise[(start + i) % noise.length]!
  const gain = rms(speech) / 10 ** (snr / 20) / Math.max(1, rms(seg))
  const mixed = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) {
    const v = Math.round(speech[i]! + seg[i]! * gain)
    mixed.writeInt16LE(Math.max(-32768, Math.min(32767, v)), i * 2)
  }
  writeFileSync(`${OUT}/${scene.id}.pcm`, mixed)
  writeFileSync(
    `${OUT}/${scene.id}.json`,
    JSON.stringify({ id: scene.id, snrDb: +snr.toFixed(1), durationMs: Math.round((n / RATE) * 1000), lines: scene.lines.map((l, i) => ({ ...l, ...times[i] })) }, null, 1),
  )
  return n / RATE
}

async function main() {
  const key = process.env.GNANI_API_KEY
  if (!key) throw new Error('GNANI_API_KEY not set (run with --env-file=.env)')
  mkdirSync(CACHE, { recursive: true })
  const noises = readdirSync(NOISE_DIR).filter((f) => f.endsWith('.pcm')).map((f) => toInt16(readFileSync(`${NOISE_DIR}/${f}`)))
  if (!noises.length) throw new Error(`no .pcm noise in ${NOISE_DIR}`)
  const pool = new TtsPool(key, 2)
  let total = 0
  try {
    for (const s of SCENES) {
      const sec = await makeScene(pool, s, noises)
      total += sec
      console.log(`${s.id}  ${sec.toFixed(1)}s`)
    }
  } finally {
    pool.close()
  }
  console.log(`${SCENES.length} scenes, ${(total / 60).toFixed(1)} minutes -> ${OUT}`)
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('synth/make.ts')) main().catch((e) => { console.error(e); process.exit(1) })
