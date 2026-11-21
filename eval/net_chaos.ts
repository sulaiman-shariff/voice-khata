/**
 * Bad-network scenarios against the voice server, through the eval/netsim.ts proxy. The client
 * here speaks the real protocol and uses the same bad-network logic as the app (src/lib/link.ts):
 * turn tracking and re-send, the speech buffer and replay, resume, acks, heartbeat.
 *
 *   node --env-file=.env --import tsx eval/local_server.ts      (the voice server on :8787)
 *   npx tsx --env-file=.env eval/net_chaos.ts [ws://localhost:8787]
 */
import WebSocket from 'ws'
import type { LedgerOp, ServerMsg, Snapshot } from '../shared/protocol.js'
import { DEAD_AFTER_MS, NetMonitor, PING_EVERY_MS, SpeechBuffer, TurnTracker, backoffMs } from '../src/lib/link.js'
import { type Proxy, startProxy } from './netsim.js'

const KEY = process.env.GNANI_API_KEY!
const UPSTREAM = process.argv[2] ?? 'ws://localhost:8787'
const FRAME = 1024
const SPEECH_LEVEL = 0.02
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ------------------------------------------------------------------ shopkeeper speech (Timbre)
const ttsCache = new Map<string, Buffer>()
function tts(text: string): Promise<Buffer> {
  const hit = ttsCache.get(text)
  if (hit) return Promise.resolve(hit)
  return new Promise((resolve) => {
    const ws = new WebSocket('wss://api.vachana.ai/api/v1/tts', { headers: { 'X-API-Key-ID': KEY } })
    const chunks: Buffer[] = []
    const done = () => {
      ws.close()
      const pcm = Buffer.concat(chunks)
      ttsCache.set(text, pcm)
      resolve(pcm)
    }
    ws.on('open', () => ws.send(JSON.stringify({ text, voice: 'Avinash', model: 'timbre-v3.0', language: 'hi-IN', audio_config: { sample_rate: 16000, num_channels: 1, sample_width: 2, encoding: 'linear_pcm', container: 'raw' } })))
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString())
      if (m.type === 'audio' && m.data?.audio) chunks.push(Buffer.from(m.data.audio, 'base64'))
      else if ((m.type === 'complete' && m.message) || m.type === 'error') done()
    })
    setTimeout(done, 15000)
  })
}
const rms = (b: Buffer) => {
  let s = 0
  for (let i = 0; i + 1 < b.length; i += 2) s += (b.readInt16LE(i) / 32768) ** 2
  return Math.sqrt(s / (b.length / 2))
}

// ------------------------------------------------------------------ a phone, minus the browser
class Phone {
  ws: WebSocket | null = null
  msgs: { t: number; m: ServerMsg }[] = []
  said: string[] = []
  entries = new Map<string, Extract<LedgerOp, { op: 'entry' }>>()
  customers = new Map<string, string>()
  pending: string | null = null
  resume: string | undefined
  resendSent: string[] = []
  replays = 0
  connects = 0
  private turns = new TurnTracker()
  private speech = new SpeechBuffer()
  private net = new NetMonitor()
  private resend: string | null = null
  private droppedSince: number | null = null
  private running = true
  private lastPing = 0
  private tick: ReturnType<typeof setInterval>

  constructor(private url: string, customers: [string, string][]) {
    for (const [cid, name] of customers) this.customers.set(cid, name)
    this.tick = setInterval(() => this.onTick(), 250)
    this.connect()
  }

  private snapshot(): Snapshot {
    const zero = { creditPaise: 0, paymentPaise: 0, entries: 0 }
    return {
      shopName: 'Test', last: null, entries: [], today: { ...zero, entries: this.entries.size }, month: { ...zero },
      customers: [...this.customers].map(([cid, name]) => ({ cid, name, aliases: [], householdId: null, remindersOptIn: false, adult: false, balancePaise: 0, typicalPaise: null })),
    }
  }

  private connect() {
    const ws = new WebSocket(this.url)
    this.ws = ws
    ws.on('open', () => {
      if (ws !== this.ws) return
      this.connects++
      this.net.onOpen(performance.now())
      const again = this.resend
      this.resend = null
      if (again) {
        this.resendSent.push(again)
        this.turns.onFinal(again, performance.now()) // in flight until its result arrives
      }
      ws.send(JSON.stringify({ type: 'hello', lang: 'hi', snapshot: this.snapshot(), firstRun: false, ptt: false, resume: this.resume, ...(again ? { resend: again } : {}) }))
      if (this.droppedSince !== null) {
        const frames = this.speech.replayWindow(Math.max(this.droppedSince - 1500, this.turns.lastFinalAt, this.turns.lastTurnDoneAt), performance.now(), SPEECH_LEVEL)
        this.droppedSince = null
        if (frames.length) {
          this.replays++
          ws.send(JSON.stringify({ type: 'replay_start' }))
          for (const f of frames) ws.send(Buffer.from(f))
          ws.send(JSON.stringify({ type: 'replay_end' }))
        }
      }
    })
    ws.on('message', (d, bin) => {
      if (ws !== this.ws || bin) return
      const m = JSON.parse(d.toString()) as ServerMsg
      const now = performance.now()
      this.net.onMessage(now)
      this.msgs.push({ t: now, m })
      switch (m.type) {
        case 'pong': this.net.onPong(m.t, now); break
        case 'final': this.turns.onFinal(m.text, now); break
        case 'ops':
          this.turns.onOps()
          for (const o of m.ops) {
            if (o.op === 'add_customer' && !this.customers.has(o.cid)) this.customers.set(o.cid, o.name)
            if (o.op === 'entry' && !this.entries.has(o.eid)) this.entries.set(o.eid, o)
          }
          if (m.seq !== undefined) ws.send(JSON.stringify({ type: 'ack', seq: m.seq }))
          break
        case 'say': this.said.push(m.text); break
        case 'pending': this.pending = m.pending?.kind ?? null; break
        case 'turn_done':
          this.turns.onTurnDone(now)
          if (m.resume) this.resume = m.resume
          break
      }
    })
    const dropped = () => {
      if (ws !== this.ws) return
      this.ws = null
      this.net.onClose()
      this.resend = this.turns.onDrop() ?? this.resend
      this.droppedSince ??= this.net.lastMessageAt
      if (this.running) setTimeout(() => this.running && this.connect(), backoffMs(0))
    }
    ws.on('close', dropped)
    ws.on('error', dropped)
  }

  private onTick() {
    const ws = this.ws
    const now = performance.now()
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    if (now - this.lastPing >= PING_EVERY_MS) {
      this.lastPing = now
      ws.send(JSON.stringify({ type: 'ping', t: now }))
    }
    if (this.net.isDead(now)) {
      ws.removeAllListeners()
      ws.terminate()
      this.ws = null
      this.net.onClose()
      this.resend = this.turns.onDrop() ?? this.resend
      this.droppedSince ??= this.net.lastMessageAt
      setTimeout(() => this.running && this.connect(), backoffMs(0))
    }
  }

  /** One 32 ms mic frame: buffered always, sent when the link is up (like the app). */
  frame(b: Buffer) {
    const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.length) as ArrayBuffer
    this.speech.push(ab, rms(b), performance.now())
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(b)
  }

  /** Speak `pcm` at real time, then keep a quiet room going for `tailMs`. */
  async say_(pcm: Buffer, tailMs = 1500) {
    const all = Buffer.concat([pcm, Buffer.alloc(Math.round((tailMs / 1000) * 32000))])
    const t0 = performance.now()
    for (let i = 0, n = 0; i + FRAME <= all.length; i += FRAME, n++) {
      const wait = t0 + n * 32 - performance.now()
      if (wait > 0) await sleep(wait)
      this.frame(all.subarray(i, i + FRAME))
    }
  }

  async silence(ms: number) {
    await this.say_(Buffer.alloc(0), ms)
  }

  async waitFor(pred: () => boolean, ms: number) {
    const end = performance.now() + ms
    while (performance.now() < end) {
      if (pred()) return true
      await this.silence(160)
    }
    return pred()
  }

  close() {
    this.running = false
    clearInterval(this.tick)
    this.ws?.close()
  }
}

// ------------------------------------------------------------------ scenarios
type Result = { name: string; ok: boolean; detail: string }
const results: Result[] = []
const CUSTOMERS: [string, string][] = [['c_ramesh', 'Ramesh'], ['c_suresh', 'Suresh']]

async function scenario(name: string, proxy: Proxy, run: (p: Phone) => Promise<{ ok: boolean; detail: string }>) {
  proxy.link.latency = 0
  proxy.link.jitter = 0
  proxy.link.stallUp = false
  proxy.link.stallDown = false
  proxy.link.onDown = undefined
  const p = new Phone(proxy.url, CUSTOMERS)
  await p.silence(900)
  let r: { ok: boolean; detail: string }
  try {
    r = await run(p)
  } catch (e) {
    r = { ok: false, detail: `error: ${String(e)}` }
  }
  p.close()
  proxy.killAll()
  results.push({ name, ...r })
  console.log(`${r.ok ? 'OK ' : 'BAD'} ${name}: ${r.detail}`)
  await sleep(500)
}

const entriesOf = (p: Phone) => [...p.entries.values()].map((e) => `${p.customers.get(e.cid) ?? e.cid} ${e.paise / 100} ${e.direction}`)

const proxy = await startProxy(8788, UPSTREAM)
const credit340 = await tts('रमेश का तीन सौ चालीस रुपये उधार लिख दो।')
const pay500 = await tts('सुरेश ने पाँच सौ रुपये दिए।')
const big = await tts('रमेश का पंद्रह हज़ार रुपये उधार।')
const haan = await tts('हाँ।')

await scenario('1. connection killed after the transcript, before the entry arrives', proxy, async (p) => {
  // swallow everything after the transcript, then kill: the server saved it, the phone never heard
  let cut = false
  proxy.link.onDown = (m) => {
    if (cut) return 'drop'
    if (m.type === 'final') {
      cut = true
      setTimeout(() => {
        proxy.killAll()
        proxy.link.onDown = undefined // only the first connection loses its messages
      }, 300)
    }
  }
  await p.say_(credit340)
  await p.waitFor(() => p.entries.size > 0, 12000)
  const e = entriesOf(p)
  const ok = e.length === 1 && e[0] === 'Ramesh 340 credit' && p.resendSent.length === 1 && p.said.some((s) => s.includes('नेटवर्क'))
  return { ok, detail: `entries ${JSON.stringify(e)}, resent ${p.resendSent.length}, said ${JSON.stringify(p.said.slice(-1))}, connects ${p.connects}` }
})

await scenario('2. uplink stalls mid-sentence, then the link dies', proxy, async (p) => {
  const half = Math.floor(pay500.length / 3 / FRAME) * FRAME
  await p.say_(pay500.subarray(0, half), 0)
  proxy.link.stallUp = true // the rest of the sentence never reaches the server
  await p.say_(pay500.subarray(half), 1200)
  proxy.killAll()
  proxy.link.stallUp = false
  await p.waitFor(() => p.entries.size > 0, 15000)
  const e = entriesOf(p)
  const ok = e.length === 1 && e[0] === 'Suresh 500 payment' && p.replays >= 1
  return { ok, detail: `entries ${JSON.stringify(e)}, replays ${p.replays}, connects ${p.connects}` }
})

await scenario('3. link dies while a read-back question is open; "haan" after reconnect saves it', proxy, async (p) => {
  await p.say_(big)
  const asked = await p.waitFor(() => p.pending === 'confirm' && p.msgs.some((x) => x.m.type === 'turn_done'), 10000)
  proxy.killAll()
  await p.waitFor(() => p.connects >= 2, 5000)
  await p.silence(800)
  await p.say_(haan)
  await p.waitFor(() => p.entries.size > 0, 10000)
  const e = entriesOf(p)
  const ok = asked && e.length === 1 && e[0] === 'Ramesh 15000 credit'
  return { ok, detail: `asked ${asked}, entries ${JSON.stringify(e)}, connects ${p.connects}` }
})

await scenario('4. 400 ms ± 150 ms latency each way', proxy, async (p) => {
  proxy.link.latency = 400
  proxy.link.jitter = 150
  const t0 = performance.now()
  await p.say_(credit340)
  await p.waitFor(() => p.entries.size >= 1, 12000)
  await p.say_(pay500)
  await p.waitFor(() => p.entries.size >= 2, 12000)
  const e = entriesOf(p).sort()
  const ok = e.length === 2 && e.includes('Ramesh 340 credit') && e.includes('Suresh 500 payment')
  return { ok, detail: `entries ${JSON.stringify(e)} in ${Math.round(performance.now() - t0)} ms, connects ${p.connects}` }
})

await scenario('5. connection killed after the entry arrived: no re-send, no duplicate', proxy, async (p) => {
  let cut = false
  proxy.link.onDown = (m) => {
    if (cut) return 'drop'
    if (m.type === 'ops') {
      cut = true
      setTimeout(() => {
        proxy.killAll()
        proxy.link.onDown = undefined
      }, 50)
    }
  }
  await p.say_(credit340)
  await p.waitFor(() => p.connects >= 2, 8000)
  await p.silence(2500)
  const e = entriesOf(p)
  const ok = e.length === 1 && p.resendSent.length === 0
  return { ok, detail: `entries ${JSON.stringify(e)}, resent ${p.resendSent.length}, connects ${p.connects}` }
})

await scenario('6. server goes silent (downlink blackholed): watchdog reconnects within ~10 s', proxy, async (p) => {
  proxy.link.stallDown = true
  const t0 = performance.now()
  const reconnected = await p.waitFor(() => p.connects >= 2, DEAD_AFTER_MS + 6000)
  proxy.link.stallDown = false
  return { ok: reconnected, detail: `reconnected after ${Math.round(performance.now() - t0)} ms (watchdog ${DEAD_AFTER_MS} ms)` }
})

await proxy.close()
const bad = results.filter((r) => !r.ok)
console.log(`\n${results.length - bad.length}/${results.length} scenarios passed`)
process.exit(bad.length ? 1 : 0)
