/**
 * KhataBhai session endpoint (Vercel Function, Node, region bom1, WebSocket).
 * Phone <-> this function <-> Gnani Prisma (STT, realtime + REST second reading) / Timbre (TTS),
 * with Claude Haiku for hard turns. All dialogue logic lives in
 * server/session.ts.
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { WebSocket, WebSocketServer } from 'ws'
import type { ClientMsg, ServerMsg } from '../shared/protocol.js'
import { SttStream } from '../server/gnani/stt.js'
import { MultiStt } from '../server/gnani/multi.js'
import { transcribeSarvam } from '../server/sarvam.js'
import { TtsPool } from '../server/gnani/tts.js'
import { transcribeRest } from '../server/gnani/rest.js'
import { LLM_MODEL, readWithLlm, warmUp } from '../server/parse/llm.js'
import { hashIp, log, shortId } from '../server/log.js'
import { Session } from '../server/session.js'

const server = http.createServer((_req, res) => {
  res.writeHead(426, { 'content-type': 'text/plain' })
  res.end('WebSocket upgrade required')
})

const wss = new WebSocketServer({ server, maxPayload: 1 << 20 })
let warmed = false

/** Browsers always send Origin: only our own pages may open a session (scripts without Origin are the eval harness). */
const ALLOWED_ORIGIN = /^https:\/\/voice-khata[a-z0-9-]*\.vercel\.app$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
const perIp = new Map<string, number>()
/**
 * Abuse guard. A phone holds one session (two for a few seconds while it swaps sockets). The
 * server sees a client's close some time after it happens, so a limit of 6 refused fresh
 * sessions from a client that never had more than 4 open (measured on a preview); 12 leaves room.
 */
const MAX_PER_IP = 12
/** A socket whose client stopped answering pings is terminated, so it cannot hold an IP slot forever. */
const HEARTBEAT_MS = 15_000
/**
 * Speech buffered on the phone during a dropped connection is replayed this many times faster
 * than real time (Prisma transcribed 1x, 2x and 4x replays identically in eval/probe_gnani5.ts).
 */
const REPLAY_PACE = 3
/** at most 20 s of audio may wait in the replay queue */
const REPLAY_MAX_FRAMES = 625
const alive = new WeakSet<WebSocket>()
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.has(ws)) {
      log.warn('heartbeat_terminate', { open: wss.clients.size })
      ws.terminate()
      continue
    }
    alive.delete(ws)
    ws.ping()
  }
}, HEARTBEAT_MS)
heartbeat.unref?.()

wss.on('connection', (ws, req) => {
  const opened = Date.now()
  const origin = req.headers.origin
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim()
  const sid = shortId()
  const L = log.child({ sid, ip: hashIp(ip) })
  if (origin && !ALLOWED_ORIGIN.test(origin)) {
    L.warn('conn_rejected', { reason: 'origin', origin })
    ws.close(1008, 'origin not allowed')
    return
  }
  const n = (perIp.get(ip) ?? 0) + 1
  if (n > MAX_PER_IP) {
    L.warn('conn_rejected', { reason: 'too_many_sessions', open: n - 1, limit: MAX_PER_IP })
    ws.close(1013, 'too many sessions')
    return
  }
  L.info('conn_open', { origin: origin ?? null, ipSessions: n, instanceSessions: wss.clients.size, ua: String(req.headers['user-agent'] ?? '').slice(0, 120), coldInstance: !warmed })
  perIp.set(ip, n)
  let released = false
  const release = () => {
    if (released) return
    released = true
    const left = (perIp.get(ip) ?? 1) - 1
    if (left <= 0) perIp.delete(ip)
    else perIp.set(ip, left)
  }
  ws.on('close', release)
  ws.on('error', (e) => {
    L.error('ws_error', { error: e })
    release()
  })
  alive.add(ws)
  ws.on('pong', () => alive.add(ws))
  const key = process.env.GNANI_API_KEY ?? ''
  if (!warmed) {
    warmed = true
    void warmUp() // prime the Haiku prompt cache + TLS for this instance
  }
  const tts = new TtsPool(key, 2, L.child({ part: 'tts' }))
  const send = (m: ServerMsg) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m))
  const session = new Session({
    // Listen in the session's language plus LISTEN_LANGS (default English, Hindi, Kannada) at once,
    // so any of them works in any session; LISTEN_LANGS=off listens in the session's language only.
    openStt: (locale, keyterms, cb) => {
      const extra = (process.env.LISTEN_LANGS ?? 'en-IN,hi-IN,kn-IN').split(',').map((x) => x.trim()).filter((x) => x && x !== 'off')
      const events = {
        onSpeechStart: cb.onSpeechStart,
        onSpeechEnd: cb.onSpeechEnd,
        onPartial: cb.onPartial,
        onFinal: (t: string, l?: string) => cb.onFinal?.(t, l),
        onError: cb.onError,
        onClose: cb.onClose,
        onOpen: cb.onOpen,
      }
      if (!extra.length) return new SttStream(key, locale, keyterms, events)
      return new MultiStt([locale, ...extra], (l, ev) => new SttStream(key, l, keyterms, ev), { ...events, pick: cb.pick })
    },
    speak: (text, locale, onAudio, signal, speed) => tts.speak(text, locale, onAudio, signal, speed),
    warm: (texts, locale, speed) => void tts.warm(texts, locale, speed).catch((e) => L.warn('tts_warm_failed', { error: e })),
    llm: async (text, ctx) => {
      const r = await readWithLlm(text, ctx)
      L.info('llm_call', { model: LLM_MODEL, ms: r.ms, cachedTokens: r.cachedTokens })
      return r.reading
    },
    // Prisma REST reading of the turn audio: language rescue always; the noisy-turn amount
    // cross-check only with SECOND_READING=on (it agreed 57/65 times in the e2e suite, caught no
    // error, and cost 0.4-0.65 s per noisy turn). SECOND_READING=off disables both.
    transcribe2: process.env.SECOND_READING === 'off' ? undefined : (pcm, locale, keyterms, prev) => transcribeRest(key, pcm, locale, keyterms, prev),
    secondReading: process.env.SECOND_READING === 'on',
    send,
    sendAudio: (pcm) => ws.readyState === WebSocket.OPEN && ws.send(pcm),
    log: L,
    record: process.env.KB_RECORD_DIR ? recorder(process.env.KB_RECORD_DIR, sid) : undefined,
    // second opinion on unclear turns, when a Sarvam key is configured
    verify: process.env.SARVAM_API_KEY ? (pcm, terms) => transcribeSarvam(process.env.SARVAM_API_KEY!, pcm, terms) : undefined,
  })
  let audioFrames = 0
  // replayed speech (and live audio that arrives meanwhile) goes through a paced queue, in order
  let replaying = false
  const backlog: Buffer[] = []
  let pump: ReturnType<typeof setInterval> | null = null
  let replay = { frames: 0, started: 0 }
  const feed = (b: Buffer) => {
    try {
      session.onAudio(b)
    } catch (e) {
      L.error('audio_failed', { error: e })
    }
  }
  const startPump = () => {
    if (pump) return
    pump = setInterval(() => {
      for (let i = 0; i < REPLAY_PACE && backlog.length; i++) feed(backlog.shift()!)
      if (!backlog.length && !replaying) {
        clearInterval(pump!)
        pump = null
        L.info('replay_done', { frames: replay.frames, audioMs: replay.frames * 32, ms: Date.now() - replay.started, pace: REPLAY_PACE })
      }
    }, 32)
  }
  send({ type: 'ready', region: process.env.VERCEL_REGION ?? 'local' })

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      audioFrames++
      const b = data as Buffer
      if (replaying || backlog.length) {
        if (replaying) replay.frames++
        if (backlog.length < REPLAY_MAX_FRAMES) backlog.push(b)
        startPump()
      } else feed(b)
      return
    }
    let msg: ClientMsg
    try {
      msg = JSON.parse(data.toString())
    } catch {
      L.warn('bad_message', { reason: 'not json', bytes: (data as Buffer).length })
      return
    }
    if (msg && (msg as { type?: string }).type === 'ping') {
      send({ type: 'pong', t: Number((msg as { t?: unknown }).t) || 0 })
      return
    }
    if (msg && (msg as { type?: string }).type === 'replay_start') {
      replaying = true
      replay = { frames: 0, started: Date.now() }
      L.info('replay_start')
      return
    }
    if (msg && (msg as { type?: string }).type === 'replay_end') {
      replaying = false
      startPump()
      return
    }
    if (!validMsg(msg)) {
      L.warn('bad_message', { reason: 'invalid shape', type: (msg as { type?: unknown })?.type ?? null })
      return
    }
    try {
      session.onClient(msg)
    } catch (e) {
      L.error('client_message_failed', { type: msg.type, error: e })
      send({ type: 'error', message: `bad message: ${String(e).slice(0, 120)}` })
    }
  })
  ws.on('close', (code, reason) => {
    if (pump) clearInterval(pump)
    L.info('conn_close', { code, reason: reason.toString().slice(0, 120), durationMs: Date.now() - opened, audioFrames })
    session.close()
    tts.close()
  })
})

export default server

const LANGS = new Set(['hi', 'en', 'kn', 'ta', 'te', 'ml', 'mr', 'bn', 'gu', 'pa'])
/** Shape check before anything reaches the session: one bad frame must not take down the instance. */
function validMsg(m: unknown): m is ClientMsg {
  if (!m || typeof m !== 'object') return false
  const x = m as Record<string, unknown>
  switch (x.type) {
    case 'hello': {
      const s = x.snapshot as Record<string, unknown> | undefined
      return typeof x.lang === 'string' && LANGS.has(x.lang) && !!s && Array.isArray(s.customers) && s.customers.length <= 5000 &&
        typeof s.today === 'object' && typeof s.month === 'object' &&
        (x.resume === undefined || typeof x.resume === 'string') && (x.resend === undefined || typeof x.resend === 'string')
    }
    case 'snapshot': {
      const s = x.snapshot as Record<string, unknown> | undefined
      return !!s && Array.isArray(s.customers) && s.customers.length <= 5000 && typeof s.today === 'object' && typeof s.month === 'object'
    }
    case 'answer':
    case 'text':
      return typeof x.text === 'string'
    case 'tap':
      return x.action === 'yes' || x.action === 'no' || x.action === 'undo'
    case 'speed':
      return x.speed === 0.8 || x.speed === 1 || x.speed === 1.2
    case 'readback':
      return typeof x.on === 'boolean'
    case 'ack':
      return Number.isInteger(x.seq)
    case 'ptt_start':
    case 'ptt_end':
    case 'playback_done':
    case 'barge':
      return true
    default:
      return false
  }
}

/** 16 kHz mono s16le PCM as a WAV file. */
function wav(pcm: Buffer): Buffer {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12)
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24)
  h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}

/** Local test runs: every turn's audio and what the session made of it, for later analysis. Never set on Vercel. */
function recorder(root: string, sid: string) {
  const dir = path.join(root, `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}_${sid}`)
  fs.mkdirSync(dir, { recursive: true })
  return (turn: Record<string, unknown>, pcm?: Buffer) => {
    try {
      const n = String(turn.turn).padStart(3, '0')
      if (pcm?.length) fs.writeFileSync(path.join(dir, `${n}.wav`), wav(pcm))
      fs.appendFileSync(path.join(dir, 'turns.jsonl'), JSON.stringify({ ...turn, audio: pcm?.length ? `${n}.wav` : null, at: new Date().toISOString() }) + '\n')
    } catch (e) {
      log.warn('record_failed', { error: e })
    }
  }
}
