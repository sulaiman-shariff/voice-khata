/**
 * End-to-end conversation test against a running voice function (local or deployed).
 * Speaks scripted shopkeeper lines (Timbre stock voice, not the agent's), streams them in
 * real time like the phone does, and checks ledger ops, replies and latency.
 *
 * Usage: npx tsx --env-file=.env eval/e2e.ts [ws-url]   (default ws://localhost:8787)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import WebSocket from 'ws'
import type { LedgerOp, ServerMsg, Snapshot } from '../shared/protocol.js'

const TARGET = process.argv[2] ?? 'ws://localhost:8787'
const KEY = process.env.GNANI_API_KEY!
const VOICE = 'Avinash'
const CACHE = 'eval/data/e2e'
mkdirSync(CACHE, { recursive: true })

async function synth(text: string, lang: string): Promise<Buffer> {
  const f = `${CACHE}/${Buffer.from(VOICE + lang + text).toString('base64url').slice(0, 80)}.pcm`
  if (existsSync(f)) return readFileSync(f)
  const parts: Buffer[] = []
  await new Promise<void>((res, rej) => {
    const ws = new WebSocket('wss://api.vachana.ai/api/v1/tts', { headers: { 'X-API-Key-ID': KEY } })
    ws.on('open', () =>
      ws.send(JSON.stringify({
        text, voice: VOICE, model: 'timbre-v3.0', language: lang,
        audio_config: { sample_rate: 16000, num_channels: 1, sample_width: 2, encoding: 'linear_pcm', container: 'raw' },
      })))
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString())
      if (m.type === 'audio' && m.data?.audio) parts.push(Buffer.from(m.data.audio, 'base64'))
      if (m.type === 'complete' && m.message) {
        ws.close()
        res()
      }
    })
    ws.on('error', rej)
  })
  const pcm = Buffer.concat(parts)
  writeFileSync(f, pcm)
  return pcm
}

/** Trim the clip's own leading/trailing silence so "speech end" is exact. */
function trim(pcm: Buffer): Buffer {
  const n = pcm.length / 2
  const amp = (i: number) => Math.abs(pcm.readInt16LE(i * 2))
  let a = 0
  let b = n - 1
  while (a < n && amp(a) < 500) a++
  while (b > a && amp(b) < 500) b--
  return pcm.subarray(a * 2, (b + 1) * 2)
}

type Check = (ops: LedgerOp[], said: string[], pending: { kind?: string } | null) => string | null
interface Step { say: string; check: Check }

const SNAP: Snapshot = {
  shopName: 'Sharma Kirana',
  customers: [
    { cid: 'r', name: 'रमेश', aliases: ['Ramesh'], householdId: null, remindersOptIn: false, adult: true, balancePaise: 0, typicalPaise: null },
    { cid: 's', name: 'सुरेश', aliases: ['Suresh'], householdId: null, remindersOptIn: false, adult: true, balancePaise: 50000, typicalPaise: null },
  ],
  last: null, entries: [],
  today: { creditPaise: 0, paymentPaise: 0, entries: 0 },
  month: { creditPaise: 0, paymentPaise: 0, entries: 0 },
}

const entry = (ops: LedgerOp[]) => ops.find((o): o is Extract<LedgerOp, { op: 'entry' }> => o.op === 'entry')
const show = (o: unknown) => JSON.stringify(o)
const STEPS: Step[] = [
  { say: 'रमेश का 340 रुपये उधार लिख दो।', check: (o) => { const e = entry(o); return e?.cid === 'r' && e.paise === 34000 && e.direction === 'credit' ? null : `want Ramesh 340 credit, got ${show(o)}` } },
  { say: 'सुरेश ने 200 रुपये जमा किए।', check: (o) => { const e = entry(o); return e?.cid === 's' && e.paise === 20000 && e.direction === 'payment' ? null : `want Suresh 200 payment, got ${show(o)}` } },
  { say: 'नहीं, 250।', check: (o) => (o.some((x) => x.op === 'amend' && x.paise === 25000) ? null : `want amend to 250, got ${show(o)}`) },
  { say: 'सुरेश का कुल कितना है?', check: (_o, s) => (s.join(' ').includes('250') ? null : `want balance 250, said ${s.join(' | ')}`) },
  { say: 'गीता का डेढ़ सौ उधार।', check: (o) => (o.some((x) => x.op === 'add_customer') && entry(o)?.paise === 15000 ? null : `want new Geeta 150, got ${show(o)}`) },
  { say: 'रमेश तीन सौ।', check: (o, _s, p) => (!entry(o) && p?.kind === 'direction' ? null : `want direction question, pending ${show(p)} ops ${show(o)}`) },
  { say: 'उधार।', check: (o) => (entry(o)?.paise === 30000 && entry(o)?.direction === 'credit' ? null : `want Ramesh 300 credit, got ${show(o)}`) },
]

const ws = new WebSocket(TARGET)
type Rec = { t: number; m: ServerMsg | { type: 'audio'; bytes: number } }
const msgs: Rec[] = []
const t0 = performance.now()
ws.on('message', (d, bin) => msgs.push({ t: performance.now(), m: bin ? { type: 'audio', bytes: (d as Buffer).length } : JSON.parse(d.toString()) }))
await new Promise((r) => ws.on('open', r))
ws.send(JSON.stringify({ type: 'hello', lang: 'hi', snapshot: SNAP, firstRun: false, ptt: false }))

const FRAME = 1024
async function stream(pcm: Buffer) {
  const start = performance.now() // pace against an absolute clock (Windows timers drift)
  for (let i = 0; i * FRAME < pcm.length; i++) {
    const wait = start + i * 32 - performance.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    const f = pcm.subarray(i * FRAME, (i + 1) * FRAME)
    ws.send(f.length === FRAME ? f : Buffer.concat([f, Buffer.alloc(FRAME - f.length)]))
  }
}
const silence = (ms: number) => stream(Buffer.alloc(Math.ceil(ms / 32) * FRAME))

let fails = 0
const lat: number[] = []
await silence(800)
for (const step of STEPS) {
  const pcm = trim(await synth(step.say, 'hi-IN'))
  const from = msgs.length
  await stream(pcm)
  const speechEnd = performance.now()
  // an open mic keeps sending room tone until the reply is done
  while (performance.now() < speechEnd + 6000) {
    await silence(160)
    const got = msgs.slice(from)
    if (got.some((x) => x.m.type === 'audio_end')) break
  }
  await silence(400)
  const got = msgs.slice(from)
  const ops = got.flatMap((x) => (x.m.type === 'ops' ? x.m.ops : []))
  const said = got.flatMap((x) => (x.m.type === 'say' ? [x.m.text] : []))
  const pend = got.filter((x) => x.m.type === 'pending').at(-1)?.m as Extract<ServerMsg, { type: 'pending' }> | undefined
  const final = got.find((x) => x.m.type === 'final')?.m as Extract<ServerMsg, { type: 'final' }> | undefined
  const firstAudio = got.find((x) => x.m.type === 'audio')
  const metrics = got.find((x) => x.m.type === 'metrics')?.m as Extract<ServerMsg, { type: 'metrics' }> | undefined
  const ms = firstAudio ? firstAudio.t - speechEnd : null
  if (ms !== null) lat.push(ms)
  const err = step.check(ops, said, (pend?.pending as { kind?: string } | null) ?? null)
  if (err) fails++
  const mt = metrics?.turn
  console.log(
    `${err ? 'BAD' : 'OK '} "${step.say}"\n     heard: ${final?.text}\n     said:  ${said.join(' ')}\n` +
      `     speech end -> first reply audio: ${ms?.toFixed(0) ?? '-'} ms` +
      (mt ? ` | server: commit +${mt.commitAt?.toFixed(0) ?? '-'} (early ${mt.earlyCommit}), final +${mt.finalAt.toFixed(0)}, ${mt.path}${mt.llmMs ? ` llm ${mt.llmMs.toFixed(0)}` : ''}, first audio +${mt.firstAudioAt?.toFixed(0) ?? '-'}, snr ${mt.snrDb?.toFixed(1)}` : '') +
      (err ? `\n     ${err}` : ''),
  )
}
lat.sort((a, b) => a - b)
console.log(`\n${STEPS.length - fails}/${STEPS.length} steps correct; reply latency p50 ${lat[Math.floor(lat.length / 2)]?.toFixed(0)} ms, max ${lat.at(-1)?.toFixed(0)} ms; ${((performance.now() - t0) / 1000).toFixed(0)} s total`)
ws.close()
process.exit(fails ? 1 : 0)
