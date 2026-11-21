/**
 * Scoring for the synthetic counter sessions.
 * Part 1: the pure scoring function. Part 2 (playback through a Session) is runScenes().
 */
import fs from 'node:fs'
import path from 'node:path'
import { SCENES, type Scene, type ToolCall } from './scenes.js'

/** What the system did for one line: did it wake, and which tool calls did it make. */
export type LineResult = { woke: boolean; calls: ToolCall[] }

export type SceneScore = {
  sceneId: string
  falseWakes: number
  falseWakesPerHour: number
  missedWakes: number
  unaddressedEntries: number
  wrong: number
  addressed: number
}

type Entry = { name?: unknown; amount?: unknown; direction?: unknown }
const entriesOf = (c: ToolCall): Entry[] =>
  c.name === 'add_entries' && Array.isArray(c.args.entries) ? (c.args.entries as Entry[]) : []

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase()

/** Same tool; for add_entries same name/amount/direction set; for others same name arg. */
export function callMatches(got: ToolCall, want: ToolCall): boolean {
  if (got.name !== want.name) return false
  if (want.name === 'add_entries') {
    const key = (e: Entry) => `${norm(e.name)}|${Number(e.amount)}|${norm(e.direction)}`
    const a = entriesOf(got).map(key).sort()
    const b = entriesOf(want).map(key).sort()
    return a.length === b.length && a.every((k, i) => k === b[i])
  }
  if ('name' in want.args) return norm(got.args.name) === norm(want.args.name)
  return true
}

export function scoreScene(scene: Scene, results: LineResult[], durationMs: number): SceneScore {
  let falseWakes = 0
  let missedWakes = 0
  let unaddressedEntries = 0
  let wrong = 0
  let addressed = 0
  scene.lines.forEach((line, i) => {
    const r = results[i] ?? { woke: false, calls: [] }
    if (!line.addressed) {
      if (r.woke) falseWakes++
      unaddressedEntries += r.calls.reduce((n, c) => n + entriesOf(c).length, 0)
      return
    }
    addressed++
    if (!r.woke) {
      missedWakes++
      return
    }
    const want = line.expect ?? []
    const ok = want.length === r.calls.length && want.every((w, j) => callMatches(r.calls[j]!, w))
    if (!ok) wrong++
  })
  return {
    sceneId: scene.id,
    falseWakes,
    falseWakesPerHour: durationMs > 0 ? falseWakes / (durationMs / 3_600_000) : 0,
    missedWakes,
    unaddressedEntries,
    wrong,
    addressed,
  }
}

export function sumScores(scores: SceneScore[], totalMs: number) {
  const t = { falseWakes: 0, missedWakes: 0, unaddressedEntries: 0, wrong: 0, addressed: 0 }
  for (const s of scores) for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += s[k]
  return { ...t, falseWakesPerHour: totalMs > 0 ? t.falseWakes / (totalMs / 3_600_000) : 0 }
}

/**
 * The line a transcript (or anything handled right after it) belongs to: the line that ended most
 * recently before `tMs`, if that was within `tailMs`; else -1. A final arrives after its line ends,
 * and the next line is longer than the recogniser's delay, so "last ended" is the right owner.
 */
export function assignToLines(lines: { startMs: number; endMs: number }[], tMs: number, tailMs: number): number {
  let idx = -1
  lines.forEach((l, i) => { if (l.endMs <= tMs) idx = i })
  return idx >= 0 && tMs <= lines[idx]!.endMs + tailMs ? idx : -1
}

const TAIL_MS = 4000
const FRAME = 1024 // 32 ms of 16 kHz s16le
type Meta = { id: string; durationMs: number; lines: { startMs: number; endMs: number }[] }

const transcriptOf = (ops: { op: string; source?: { transcript?: string } }[]) => ops.find((o) => o.op === 'entry')?.source?.transcript ?? ''

/** One scene through a fresh, asleep Session with real Gnani STT and the real Gemini agent. */
async function playScene(scene: Scene, meta: Meta, pcm: Buffer, pace: number): Promise<{ results: LineResult[]; errors: number }> {
  const { Session } = await import('../../server/session.js')
  const { SttStream } = await import('../../server/gnani/stt.js')
  const { MultiStt } = await import('../../server/gnani/multi.js')
  const { decide } = await import('../../server/agent/agent.js')
  const { GEMINI_TOOLS } = await import('../../server/agent/tools.js')
  const key = process.env.GNANI_API_KEY ?? ''
  const extra = (process.env.LISTEN_LANGS ?? 'en-IN,hi-IN,kn-IN').split(',').map((x) => x.trim()).filter((x) => x && x !== 'off')
  const t0 = performance.now()
  const wakes: number[] = []
  const finals: { t: number; text: string; line: number }[] = []
  const agentCalls: { t: number; text: string; calls: ToolCall[] }[] = []
  // entries the ledger wrote (the local fast path never calls the agent), by scene time
  const opsSeen: { t: number; text: string; entries: { name: string; amount: number; direction: string }[] }[] = []
  const names = new Map<string, string>(['Ramesh', 'Suresh', 'Mahi'].map((n, i) => [`c${i}`, n]))
  let errors = 0
  const session = new Session({
    openStt: (locale, keyterms, cb) => {
      const events = { onSpeechStart: cb.onSpeechStart, onSpeechEnd: cb.onSpeechEnd, onPartial: cb.onPartial,
        onFinal: (t: string, l?: string) => {
          const now = (performance.now() - t0) * pace
          finals.push({ t: now, text: t, line: assignToLines(meta.lines, now, TAIL_MS) })
          cb.onFinal?.(t, l)
        }, onError: cb.onError, onClose: cb.onClose, onOpen: cb.onOpen }
      return new MultiStt([locale, ...extra], (l, ev) => new SttStream(key, l, keyterms, ev), { ...events, pick: cb.pick })
    },
    speak: async () => ({ firstAudioMs: 0, bytes: 0 }),
    agent: async (ctx, audio) => {
      const t = (performance.now() - t0) * pace // scene time of the request
      const r = await decide(ctx, GEMINI_TOOLS, audio)
      agentCalls.push({ t, text: ctx.heard?.[0]?.text ?? '', calls: r.calls })
      return r
    },
    send: (m) => {
      if (m.type === 'attention' && m.state === 'awake') wakes.push((performance.now() - t0) * pace)
      if (m.type === 'error') errors++
      if (m.type === 'ops') {
        const entries: { name: string; amount: number; direction: string }[] = []
        for (const op of m.ops) {
          if (op.op === 'add_customer') names.set(op.cid, op.name)
          else if (op.op === 'entry') entries.push({ name: names.get(op.cid) ?? op.cid, amount: op.paise / 100, direction: op.direction })
        }
        if (entries.length) opsSeen.push({ t: (performance.now() - t0) * pace, text: transcriptOf(m.ops), entries })
      }
    },
    sendAudio: () => {},
    log: process.env.SYNTH_DEBUG ? (await import('../../server/log.js')).log : undefined,
  })
  // a fresh hello, no tap: the session starts asleep, like a phone that just opened
  session.onClient({ type: 'hello', lang: 'en', firstRun: false, ptt: false, snapshot: { shopName: 'Shop', last: null, entries: [],
    customers: ['Ramesh', 'Suresh', 'Mahi'].map((n, i) => ({ cid: `c${i}`, name: n, aliases: [], householdId: null, remindersOptIn: false, adult: false, balancePaise: 20000, typicalPaise: null })),
    today: { creditPaise: 0, paymentPaise: 0, entries: 0 }, month: { creditPaise: 0, paymentPaise: 0, entries: 0 } } })
  const lineOf = (t: number, text: string) => {
    const f = [...finals].reverse().find((x) => text && x.text.trim() === text.trim()) ?? [...finals].reverse().find((x) => text && (x.text.includes(text) || text.includes(x.text)))
    return f ? f.line : assignToLines(meta.lines, t, TAIL_MS)
  }
  const start = performance.now()
  for (let i = 0, n = 0; i < pcm.length; i += FRAME, n++) {
    session.onAudio(pcm.subarray(i, i + FRAME))
    const wait = start + ((n + 1) * 32) / pace - performance.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  }
  // let the last turn finish (final, agent call)
  await new Promise((r) => setTimeout(r, 8000))
  session.close()
  const results: LineResult[] = scene.lines.map(() => ({ woke: false, calls: [] }))
  const woke = new Set<number>()
  for (const t of wakes) { const i = [...finals].reverse().find((f) => f.t <= t + 50)?.line ?? -1; if (i >= 0) woke.add(i) }
  for (const a of agentCalls) {
    const i = lineOf(a.t, a.text)
    if (i < 0) continue
    results[i]!.calls.push(...a.calls)
    // an addressed line handled while already awake (no wake transition) still counts as heard
    if (scene.lines[i]!.addressed) woke.add(i)
  }
  // entries on the ledger that no agent add_entries call explains (fast path): one add_entries call
  for (const o of opsSeen) {
    const i = lineOf(o.t, o.text)
    if (i < 0 || results[i]!.calls.some((c) => c.name === 'add_entries')) continue
    results[i]!.calls.push({ name: 'add_entries', args: { entries: o.entries } })
    woke.add(i)
  }
  for (const i of woke) results[i]!.woke = true
  return { results, errors }
}

/** Part 2: play eval/data/synth/*.pcm into a local Session like the phone does and score it. */
export async function runScenes(opts: { dir?: string; only?: string; pace?: number; concurrency?: number } = {}) {
  const dir = opts.dir ?? process.env.SYNTH_DATA ?? 'C:/Users/sulai/OneDrive/Desktop/hackbriven/eval/data/synth'
  const pace = opts.pace ?? 1
  const scenes = SCENES.filter((s) => !opts.only || s.id.includes(opts.only))
  const scores: SceneScore[] = []
  const detail: unknown[] = []
  let totalMs = 0
  let next = 0
  const worker = async () => {
    while (next < scenes.length) {
      const scene = scenes[next++]!
      const meta = JSON.parse(fs.readFileSync(path.join(dir, `${scene.id}.json`), 'utf8')) as Meta
      const pcm = fs.readFileSync(path.join(dir, `${scene.id}.pcm`))
      const { results, errors } = await playScene(scene, meta, pcm, pace)
      const score = scoreScene(scene, results, meta.durationMs)
      scores.push(score)
      totalMs += meta.durationMs
      detail.push({ ...score, errors, results })
      console.error(`${scene.id} done`)
    }
  }
  await Promise.all(Array.from({ length: opts.concurrency ?? 3 }, worker))
  scores.sort((a, b) => a.sceneId.localeCompare(b.sceneId))
  return { scores, total: sumScores(scores, totalMs), totalMs, detail }
}

async function main() {
  const args = process.argv.slice(2)
  const arg = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined)
  if (args.includes('--detector')) {
    // TODO(Task 14): run public/wakeword/khatabhai.onnx over the PCM with onnxruntime-node. The model
    // does not exist yet and onnxruntime-node is not installed, so the detector pass is skipped.
    console.log('--detector: skipped (no public/wakeword/khatabhai.onnx, no onnxruntime-node)')
  }
  const r = await runScenes({ only: arg('--only'), pace: Number(arg('--pace') ?? 1), concurrency: Number(arg('--concurrency') ?? 3) })
  const pad = (s: unknown, n: number) => String(s).padEnd(n)
  console.log(pad('scene', 28) + pad('addr', 6) + pad('falseW', 8) + pad('missed', 8) + pad('unaddrEntries', 15) + 'wrong')
  for (const s of r.scores) console.log(pad(s.sceneId, 28) + pad(s.addressed, 6) + pad(s.falseWakes, 8) + pad(s.missedWakes, 8) + pad(s.unaddressedEntries, 15) + s.wrong)
  const t = r.total
  console.log(`TOTAL audio ${(r.totalMs / 60000).toFixed(1)} min | false wakes ${t.falseWakes} (${t.falseWakesPerHour.toFixed(1)}/hour) | missed wakes ${t.missedWakes}/${t.addressed} | entries from un-addressed speech ${t.unaddressedEntries} | wrong tool/amount ${t.wrong}`)
  const out = `eval/results/synth_${new Date().toISOString().slice(0, 10)}.json`
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, JSON.stringify({ total: t, totalMs: r.totalMs, scenes: r.detail }, null, 1))
  console.log(`wrote ${out}`)
  process.exit(0)
}
if (process.argv[1] && /score\.ts$/.test(process.argv[1].replace(/\\/g, '/'))) void main()
