/**
 * Scoring for the synthetic counter sessions.
 * Part 1: the pure scoring function. Part 2 (playback through a Session) is runScenes().
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { translit } from '../../shared/names.js'
import { SCENES, type Scene, type ToolCall } from './scenes.js'

/**
 * What the system did for one line. `calls` are the effective calls (entries actually WRITTEN to the
 * ledger, plus other tools); `proposed` is what the agent proposed (add_entries it asked for);
 * `asked` is true when it read back / asked a question holding the expected name and amount.
 */
export type LineResult = { woke: boolean; calls: ToolCall[]; proposed?: ToolCall[]; asked?: boolean }

export type SceneScore = {
  sceneId: string
  falseWakes: number
  falseWakesPerHour: number
  missedWakes: number
  /** ledger writes from un-addressed lines */
  unaddressedEntries: number
  /** agent add_entries proposals from un-addressed lines (may be stopped before the ledger) */
  proposedUnaddressed: number
  askedCorrect: number
  writtenCorrect: number
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

const callsOk = (want: ToolCall[], got: ToolCall[]) => want.length === got.length && want.every((w, j) => callMatches(got[j]!, w))
const wantsEntry = (want: ToolCall[]) => want.some((w) => w.name === 'add_entries')

export function scoreScene(scene: Scene, results: LineResult[], durationMs: number): SceneScore {
  let falseWakes = 0
  let missedWakes = 0
  let unaddressedEntries = 0
  let proposedUnaddressed = 0
  let askedCorrect = 0
  let writtenCorrect = 0
  let wrong = 0
  let addressed = 0
  scene.lines.forEach((line, i) => {
    const r = results[i] ?? { woke: false, calls: [] }
    if (!line.addressed) {
      if (r.woke) falseWakes++
      unaddressedEntries += r.calls.reduce((n, c) => n + entriesOf(c).length, 0)
      proposedUnaddressed += (r.proposed ?? []).reduce((n, c) => n + entriesOf(c).length, 0)
      return
    }
    addressed++
    if (!r.woke) {
      missedWakes++
      return
    }
    const want = line.expect ?? []
    if (callsOk(want, r.calls)) {
      if (wantsEntry(want)) writtenCorrect++
    } else if (r.asked && wantsEntry(want)) askedCorrect++ // asked back with the right name and amount
    else wrong++
  })
  return {
    sceneId: scene.id,
    falseWakes,
    falseWakesPerHour: durationMs > 0 ? falseWakes / (durationMs / 3_600_000) : 0,
    missedWakes,
    unaddressedEntries,
    proposedUnaddressed,
    askedCorrect,
    writtenCorrect,
    wrong,
    addressed,
  }
}

export function sumScores(scores: SceneScore[], totalMs: number) {
  const t = { falseWakes: 0, missedWakes: 0, unaddressedEntries: 0, proposedUnaddressed: 0, askedCorrect: 0, writtenCorrect: 0, wrong: 0, addressed: 0 }
  for (const s of scores) for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += s[k]
  return { ...t, falseWakesPerHour: totalMs > 0 ? t.falseWakes / (totalMs / 3_600_000) : 0 }
}

const bigrams = (s: string) => {
  const t = translit(s).toLowerCase().replace(/[^a-z]/g, '')
  const m = new Map<string, number>()
  for (let i = 0; i < t.length - 1; i++) m.set(t.slice(i, i + 2), (m.get(t.slice(i, i + 2)) ?? 0) + 1)
  return { m, n: Math.max(0, t.length - 1) }
}
/** Transliteration-insensitive similarity of two texts (Dice over letter bigrams after translit), 0..1. */
export function textSim(a: string, b: string): number {
  const x = bigrams(a)
  const y = bigrams(b)
  if (!x.n || !y.n) return 0
  let hit = 0
  for (const [k, v] of x.m) hit += Math.min(v, y.m.get(k) ?? 0)
  return (2 * hit) / (x.n + y.n)
}

/**
 * The scene line a final belongs to. Finals arrive in order, so only the line of the previous final
 * (one line may come as two finals) and the next three are candidates, and only lines whose speech
 * has begun by `tMs`. Best text similarity wins, with a small bonus for the line that ended most
 * recently; falls back to that line when none has started.
 */
export function alignFinal(lines: { text: string; startMs: number; endMs: number }[], last: number, tMs: number, text: string): number {
  let recent = -1
  lines.forEach((l, i) => { if (l.endMs <= tMs) recent = i })
  let best = -1
  let bestScore = -1
  for (let j = Math.max(0, last); j < Math.min(lines.length, Math.max(0, last) + 4); j++) {
    if (lines[j]!.startMs > tMs) break
    const sc = textSim(text, lines[j]!.text) + (j === recent ? 0.15 : 0)
    if (sc > bestScore) { best = j; bestScore = sc }
  }
  return best >= 0 ? best : recent
}

const FRAME = 1024 // 32 ms of 16 kHz s16le
type Meta = { id: string; durationMs: number; lines: { startMs: number; endMs: number }[] }
/** every customer the scenes treat as existing (all names in scenes.ts) */
const ROSTER = ['Ramesh', 'Suresh', 'Mahi', 'Priya', 'Lakshmi', 'Manjunath']
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

type Ent = { name: string; amount: number; direction: string }
/** Everything the session did in a scene, with its scene time and the line it was attributed to (-1: none). */
export type RawEvents = {
  finals: { t: number; text: string; heard: { text: string; locale: string }[] | null; line: number }[]
  attention: { t: number; state: string; line: number }[]
  agent: { t: number; text: string; calls: ToolCall[]; line: number }[]
  speech: { t: number; text: string; line: number }[]
  ops: { t: number; entries: Ent[]; line: number }[]
  shows: { t: number; msg: unknown; line: number }[]
  pending: { t: number; pending: unknown; line: number }[]
  errors: { t: number; message: string }[]
}

const numIn = (blob: string, n: number) => new RegExp(`(^|[^0-9.])${n}([^0-9]|$)`).test(blob.replace(/(\d),(\d)/g, '$1$2'))
const mentions = (blob: string, name: string) =>
  blob.toLowerCase().includes(name.toLowerCase()) || blob.split(/\s+/).some((w) => textSim(w, name) > 0.8)
const entriesOfWant = (want: ToolCall[]) => want.flatMap((w) => (w.args.entries as Ent[] | undefined) ?? [])

/** One scene through a fresh, asleep Session with real Gnani STT and the real Gemini agent. */
async function playScene(scene: Scene, meta: Meta, pcm: Buffer, pace: number): Promise<{ results: LineResult[]; raw: RawEvents }> {
  const { Session } = await import('../../server/session.js')
  const { SttStream } = await import('../../server/gnani/stt.js')
  const { MultiStt } = await import('../../server/gnani/multi.js')
  const { decide } = await import('../../server/agent/agent.js')
  const { GEMINI_TOOLS } = await import('../../server/agent/tools.js')
  const key = process.env.GNANI_API_KEY ?? ''
  const extra = (process.env.LISTEN_LANGS ?? 'en-IN,hi-IN,kn-IN').split(',').map((x) => x.trim()).filter((x) => x && x !== 'off')
  const t0 = performance.now()
  const now = () => (performance.now() - t0) * pace
  const lines = scene.lines.map((l, i) => ({ text: l.text, startMs: meta.lines[i]!.startMs, endMs: meta.lines[i]!.endMs }))
  const raw: RawEvents = { finals: [], attention: [], agent: [], speech: [], ops: [], shows: [], pending: [], errors: [] }
  const names = new Map<string, string>(ROSTER.map((n, i) => [`c${i}`, n]))
  // finals and turns both happen in order: turn k (the k-th 'final' message) ends with the k-th 'turn_done'
  let lastAligned = -1
  let lastHeard: { text: string; locale: string }[] | null = null
  const turnLines: number[] = []
  let turnsDone = 0
  const cur = () => turnLines[turnsDone] ?? -1
  const session = new Session({
    openStt: (locale, keyterms, cb) => {
      const events = { onSpeechStart: cb.onSpeechStart, onSpeechEnd: cb.onSpeechEnd, onPartial: cb.onPartial,
        onFinal: (t: string, l?: string) => {
          const at = now()
          const line = alignFinal(lines, lastAligned, at, t)
          if (line >= 0) lastAligned = line
          raw.finals.push({ t: at, text: t, heard: lastHeard, line })
          lastHeard = null
          cb.onFinal?.(t, l)
        }, onError: cb.onError, onClose: cb.onClose, onOpen: cb.onOpen }
      return new MultiStt([locale, ...extra], (l, ev) => new SttStream(key, l, keyterms, ev), {
        ...events, pick: (heard) => { lastHeard = heard; return cb.pick ? cb.pick(heard) : 0 },
      })
    },
    speak: async (text) => {
      raw.speech.push({ t: now(), text, line: cur() })
      return { firstAudioMs: 0, bytes: 0 }
    },
    agent: async (ctx, audio) => {
      const t = now()
      const r = await decide(ctx, GEMINI_TOOLS, audio).catch((e) => {
        raw.errors.push({ t: now(), message: `agent: ${String(e).slice(0, 120)}` }) // counted: a failed agent call is a harness/API problem, not a verdict
        throw e
      })
      raw.agent.push({ t, text: ctx.heard?.[0]?.text ?? '', calls: r.calls, line: cur() })
      return r
    },
    send: (m) => {
      const t = now()
      if (m.type === 'attention') raw.attention.push({ t, state: m.state, line: raw.finals.at(-1)?.line ?? -1 })
      else if (m.type === 'error') raw.errors.push({ t, message: m.message })
      else if (m.type === 'final') {
        // the final that carries this turn: the latest raw final that reads like it
        const f = [...raw.finals].reverse().find((x) => textSim(x.text, m.text) > 0.6)
        turnLines.push(f ? f.line : alignFinal(lines, lastAligned, t, m.text))
      } else if (m.type === 'turn_done') turnsDone++
      else if (m.type === 'ops') {
        const entries: Ent[] = []
        for (const op of m.ops) {
          if (op.op === 'add_customer') names.set(op.cid, op.name)
          else if (op.op === 'entry') entries.push({ name: names.get(op.cid) ?? op.cid, amount: op.paise / 100, direction: op.direction })
        }
        if (entries.length) raw.ops.push({ t, entries, line: cur() })
      } else if (m.type === 'show' || m.type === 'ready') raw.shows.push({ t, msg: m, line: cur() })
      else if (m.type === 'pending' && m.pending) raw.pending.push({ t, pending: m.pending, line: cur() })
    },
    sendAudio: () => {},
    log: process.env.SYNTH_DEBUG ? (await import('../../server/log.js')).log : undefined,
  })
  // a fresh hello, no tap: the session starts asleep, like a phone that just opened
  session.onClient({ type: 'hello', lang: 'en', firstRun: false, ptt: false, snapshot: { shopName: 'Shop', last: null, entries: [],
    customers: ROSTER.map((n, i) => ({ cid: `c${i}`, name: n, aliases: [], householdId: null, remindersOptIn: false, adult: false, balancePaise: 20000, typicalPaise: null })),
    today: { creditPaise: 0, paymentPaise: 0, entries: 0 }, month: { creditPaise: 0, paymentPaise: 0, entries: 0 } } })
  const start = performance.now()
  for (let i = 0, n = 0; i < pcm.length; i += FRAME, n++) {
    session.onAudio(pcm.subarray(i, i + FRAME))
    const wait = start + ((n + 1) * 32) / pace - performance.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  }
  // let the last turn finish (final, agent call): 8 s of scene time, so 8 s / pace of wall time
  await new Promise((r) => setTimeout(r, 8000 / pace))
  session.close()

  const results: LineResult[] = scene.lines.map((line, i) => {
    const woke = raw.attention.some((a) => a.state === 'awake' && a.line === i)
    const agent = raw.agent.filter((a) => a.line === i)
    const proposed = agent.flatMap((a) => a.calls).filter((c) => c.name === 'add_entries')
    const written = raw.ops.filter((o) => o.line === i).flatMap((o) => o.entries)
    const calls: ToolCall[] = []
    if (written.length) calls.push({ name: 'add_entries', args: { entries: written } })
    calls.push(...agent.flatMap((a) => a.calls).filter((c) => c.name !== 'add_entries'))
    const spoken = raw.speech.filter((x) => x.line === i).map((x) => x.text).join(' ')
    const pend = raw.pending.filter((x) => x.line === i).map((x) => x.pending as { paise?: number })
    const handled = turnLines.includes(i)
    const want = line.expect ?? []
    if (!agent.length) {
      // fast-path turns never call the agent: read the tool off what the session sent
      const sh = raw.shows.find((x) => x.line === i && (x.msg as { type: string; view?: string }).view === 'customer')
      const w = want[0]
      if (sh) calls.push({ name: 'show_customer', args: { name: names.get((sh.msg as { cid: string }).cid) ?? '' } })
      else if (!written.length && handled && w?.name === 'query_balance' && mentions(spoken, String(w.args.name))) {
        calls.push({ name: 'query_balance', args: { name: String(w.args.name) } }) // a balance read-out names the customer and writes nothing
      }
      if (w?.name === 'settle' && written.length && written.every((e) => e.direction === 'payment' && norm(e.name) === norm(w.args.name))) {
        calls.splice(0, calls.length, { name: 'settle', args: { name: String(w.args.name) } }) // settling writes the balance as a payment
      }
    }
    const blob = `${spoken} ${JSON.stringify(pend)} ${pend.map((p) => (p.paise ? p.paise / 100 : '')).join(' ')}`
    const asked = wantsEntry(want) && entriesOfWant(want).every((e) => numIn(blob, Number(e.amount)) && mentions(blob, String(e.name)))
    return { woke: woke || (line.addressed && handled), calls, proposed, asked }
  })
  return { results, raw }
}

/** Part 2: play eval/data/synth/*.pcm into a local Session like the phone does and score it. */
export async function runScenes(opts: { dir?: string; only?: string; pace?: number; concurrency?: number } = {}) {
  const dir = opts.dir ?? process.env.SYNTH_DATA ?? path.join(REPO, 'eval/data/synth')
  const pace = opts.pace ?? 1
  const scenes = SCENES.filter((s) => !opts.only || s.id.includes(opts.only))
  const scores: SceneScore[] = []
  const detail: { sceneId: string; raw: RawEvents; results: LineResult[] }[] = []
  const failures: Record<string, unknown>[] = []
  let totalMs = 0
  let errors = 0
  let next = 0
  const worker = async () => {
    while (next < scenes.length) {
      const scene = scenes[next++]!
      const meta = JSON.parse(fs.readFileSync(path.join(dir, `${scene.id}.json`), 'utf8')) as Meta
      const pcm = fs.readFileSync(path.join(dir, `${scene.id}.pcm`))
      const { results, raw } = await playScene(scene, meta, pcm, pace)
      scores.push(scoreScene(scene, results, meta.durationMs))
      totalMs += meta.durationMs
      errors += raw.errors.length
      detail.push({ sceneId: scene.id, raw, results })
      scene.lines.forEach((line, i) => {
        const r = results[i]!
        const kinds: string[] = []
        if (!line.addressed) {
          if (r.woke) kinds.push('false wake')
          if (r.calls.some((c) => entriesOf(c).length)) kinds.push('un-addressed write')
        } else if (!r.woke) kinds.push('missed wake')
        else if (!callsOk(line.expect ?? [], r.calls) && !(r.asked && wantsEntry(line.expect ?? []))) kinds.push('wrong')
        for (const kind of kinds) {
          failures.push({ scene: scene.id, line: i, kind, said: line.text,
            heard: raw.finals.filter((f) => f.line === i).map((f) => f.text),
            did: { calls: r.calls, proposed: r.proposed, replies: raw.speech.filter((x) => x.line === i).map((x) => x.text) } })
        }
      })
      console.error(`${scene.id} done`)
    }
  }
  await Promise.all(Array.from({ length: opts.concurrency ?? 3 }, worker))
  scores.sort((a, b) => a.sceneId.localeCompare(b.sceneId))
  failures.sort((a, b) => String(a.scene).localeCompare(String(b.scene)) || Number(a.line) - Number(b.line))
  return { scores, total: sumScores(scores, totalMs), totalMs, detail, failures, errors }
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
  console.log(pad('scene', 30) + pad('addr', 6) + pad('falseW', 8) + pad('missed', 8) + pad('unaddrWrote', 12) + pad('unaddrProp', 11) + pad('wroteOk', 9) + pad('askedOk', 9) + 'wrong')
  for (const s of r.scores) console.log(pad(s.sceneId, 30) + pad(s.addressed, 6) + pad(s.falseWakes, 8) + pad(s.missedWakes, 8) + pad(s.unaddressedEntries, 12) + pad(s.proposedUnaddressed, 11) + pad(s.writtenCorrect, 9) + pad(s.askedCorrect, 9) + s.wrong)
  const t = r.total
  console.log(`TOTAL audio ${(r.totalMs / 60000).toFixed(1)} min | false wakes ${t.falseWakes} (${t.falseWakesPerHour.toFixed(1)}/hour) | missed wakes ${t.missedWakes}/${t.addressed} | entries WRITTEN from un-addressed speech ${t.unaddressedEntries} (proposed ${t.proposedUnaddressed}) | correct written ${t.writtenCorrect}, correct asked ${t.askedCorrect} | wrong tool/amount ${t.wrong} | session errors ${r.errors}`)
  const out = path.join(REPO, `eval/results/synth_${new Date().toISOString().slice(0, 10)}.json`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, JSON.stringify({ total: t, totalMs: r.totalMs, errors: r.errors, failures: r.failures, scenes: r.scores.map((sc) => ({ ...sc, ...r.detail.find((d) => d.sceneId === sc.sceneId) })) }, null, 1))
  console.log(`wrote ${out}`)
  for (const f of r.failures) console.log(`FAIL ${f.scene}#${f.line} ${f.kind} said=${JSON.stringify(f.said)} heard=${JSON.stringify(f.heard)} did=${JSON.stringify(f.did)}`)
  process.exitCode = r.errors ? 1 : 0
  process.exit() // open STT sockets would keep the process alive; the exit code is already set
}
if (process.argv[1] && /score\.ts$/.test(process.argv[1].replace(/\\/g, '/'))) void main()
