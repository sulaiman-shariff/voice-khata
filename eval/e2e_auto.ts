/**
 * Auto-language end-to-end test: one conversation switching Hindi, Kannada, Tamil, English, Telugu.
 * Speaks scripted shopkeeper lines (Timbre stock voice, not the agent's), streams them in
 * real time like the phone does, and checks ledger ops, replies and latency.
 *
 * Checks each line is saved right AND answered in the language it was spoken in, with latency.
 * Usage: npx tsx --env-file=.env eval/e2e_auto.ts [ws-url] [--locked]   (--locked: old fixed-Hindi mode, for comparison)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import WebSocket from 'ws'
import type { LedgerOp, ServerMsg, Snapshot } from '../shared/protocol.js'

const TARGET = process.argv.slice(2).find((a) => a.startsWith('ws')) ?? 'ws://localhost:8787'
const LOCKED = process.argv.includes('--locked')
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

type Check = (ops: LedgerOp[], said: string[]) => string | null
interface Step { say: string; tts: string; script: RegExp; check: Check }

const SNAP: Snapshot = {
  shopName: 'Sharma Kirana',
  customers: [
    { cid: 'r', name: 'रमेश', aliases: ['Ramesh'], householdId: null, remindersOptIn: false, adult: true, balancePaise: 0, typicalPaise: null },
    { cid: 's', name: 'सुरेश', aliases: ['Suresh'], householdId: null, remindersOptIn: false, adult: true, balancePaise: 50000, typicalPaise: null },
  ],
  last: null,
  today: { creditPaise: 0, paymentPaise: 0, entries: 0 },
  month: { creditPaise: 0, paymentPaise: 0, entries: 0 },
}

const entry = (ops: LedgerOp[]) => ops.find((o): o is Extract<LedgerOp, { op: 'entry' }> => o.op === 'entry')
const want = (cid: string, rs: number, dir: string): Check => (o) => {
  const e = entry(o)
  return e?.cid === cid && e.paise === rs * 100 && e.direction === dir ? null : `want ${cid} ${rs} ${dir}, got ${JSON.stringify(o)}`
}
const DEV = /[\u0900-\u097F]/
const STEPS: Step[] = [
  { say: 'रमेश का 340 रुपये उधार लिख दो।', tts: 'hi-IN', script: DEV, check: want('r', 340, 'credit') },
  { say: 'ಸುರೇಶ್ 300 ರೂಪಾಯಿ ಕೊಟ್ಟರು.', tts: 'kn-IN', script: /[\u0C80-\u0CFF]/, check: want('s', 300, 'payment') },
  { say: 'ரமேஷுக்கு 500 ரூபாய் கடன் கொடுத்தேன்.', tts: 'ta-IN', script: /[\u0B80-\u0BFF]/, check: want('r', 500, 'credit') },
  { say: 'Suresh paid 200 rupees.', tts: 'en-IN', script: /^[\x00-\x7F₹]*$/, check: want('s', 200, 'payment') },
  { say: 'రమేష్ కి 150 రూపాయలు అప్పు ఇచ్చాను.', tts: 'te-IN', script: /[\u0C00-\u0C7F]/, check: want('r', 150, 'credit') },
  { say: 'सुरेश ने 100 रुपये जमा किए।', tts: 'hi-IN', script: DEV, check: want('s', 100, 'payment') },
]

const ws = new WebSocket(TARGET)
type Rec = { t: number; m: ServerMsg | { type: 'audio'; bytes: number } }
const msgs: Rec[] = []
const t0 = performance.now()
ws.on('message', (d, bin) => msgs.push({ t: performance.now(), m: bin ? { type: 'audio', bytes: (d as Buffer).length } : JSON.parse(d.toString()) }))
await new Promise((r) => ws.on('open', r))
ws.send(JSON.stringify({ type: 'hello', lang: 'hi', auto: !LOCKED, snapshot: SNAP, firstRun: false, ptt: false }))

const FRAME = 1024
async function stream(pcm: Buffer) {
  const start = performance.now()
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
  const pcm = trim(await synth(step.say, step.tts))
  const from = msgs.length
  await stream(pcm)
  const speechEnd = performance.now()
  while (performance.now() < speechEnd + 7000) {
    await silence(160)
    if (msgs.slice(from).some((x) => x.m.type === 'audio_end')) break
  }
  await silence(400)
  const got = msgs.slice(from)
  const ops = got.flatMap((x) => (x.m.type === 'ops' ? x.m.ops : []))
  const said = got.flatMap((x) => (x.m.type === 'say' ? [x.m.text] : []))
  const final = got.find((x) => x.m.type === 'final')?.m as Extract<ServerMsg, { type: 'final' }> | undefined
  const switched = got.filter((x) => x.m.type === 'lang').map((x) => (x.m as Extract<ServerMsg, { type: 'lang' }>).lang)
  const firstAudio = got.find((x) => x.m.type === 'audio')
  const metrics = got.find((x) => x.m.type === 'metrics')?.m as Extract<ServerMsg, { type: 'metrics' }> | undefined
  const ms = firstAudio ? firstAudio.t - speechEnd : null
  if (ms !== null) lat.push(ms)
  let err = step.check(ops, said)
  if (!err && !step.script.test(said.join(' '))) err = `reply not in the spoken language: ${said.join(' ')}`
  if (err) fails++
  const mt = metrics?.turn
  console.log(
    `${err ? 'BAD' : 'OK '} [${step.tts}] "${step.say}"\n     heard: ${final?.text}${switched.length ? `   (switched to ${switched.join(',')})` : ''}\n     said:  ${said.join(' ')}\n` +
      `     speech end -> first reply audio: ${ms?.toFixed(0) ?? '-'} ms` +
      (mt ? ` | final +${mt.finalAt.toFixed(0)}, ${mt.path}${mt.llmMs ? ` llm ${mt.llmMs.toFixed(0)}` : ''}, first audio +${mt.firstAudioAt?.toFixed(0) ?? '-'}` : '') +
      (err ? `\n     ${err}` : ''),
  )
}
lat.sort((a, b) => a - b)
console.log(`\n${LOCKED ? 'LOCKED hi-IN' : 'AUTO'}: ${STEPS.length - fails}/${STEPS.length} lines saved right and answered in their language; reply latency p50 ${lat[Math.floor(lat.length / 2)]?.toFixed(0)} ms, max ${lat.at(-1)?.toFixed(0)} ms; ${((performance.now() - t0) / 1000).toFixed(0)} s total`)
ws.close()
process.exit(fails ? 1 : 0)
