/**
 * Voice Khata session endpoint (Vercel Function, Node, region bom1, WebSocket).
 * Phone <-> this function <-> Gnani Prisma (STT, realtime + REST second reading) / Timbre (TTS),
 * with Gnani Evon (Claude Haiku as fallback) for hard turns. All dialogue logic lives in
 * server/session.ts.
 */
import http from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import type { ClientMsg, ServerMsg } from '../shared/protocol.js'
import { SttStream } from '../server/gnani/stt.js'
import { TtsPool } from '../server/gnani/tts.js'
import { transcribeRest } from '../server/gnani/rest.js'
import { readHard, warmUp } from '../server/parse/llm.js'
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
const MAX_PER_IP = 6

wss.on('connection', (ws, req) => {
  const origin = req.headers.origin
  if (origin && !ALLOWED_ORIGIN.test(origin)) {
    ws.close(1008, 'origin not allowed')
    return
  }
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim()
  const n = (perIp.get(ip) ?? 0) + 1
  if (n > MAX_PER_IP) {
    ws.close(1013, 'too many sessions')
    return
  }
  perIp.set(ip, n)
  ws.on('close', () => {
    const left = (perIp.get(ip) ?? 1) - 1
    if (left <= 0) perIp.delete(ip)
    else perIp.set(ip, left)
  })
  const key = process.env.GNANI_API_KEY ?? ''
  if (!warmed) {
    warmed = true
    void warmUp() // prime the Haiku prompt cache + TLS for this instance
  }
  const tts = new TtsPool(key, 2)
  const send = (m: ServerMsg) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m))
  const session = new Session({
    openStt: (locale, keyterms, cb) =>
      new SttStream(key, locale, keyterms, {
        onSpeechStart: cb.onSpeechStart,
        onSpeechEnd: cb.onSpeechEnd,
        onPartial: cb.onPartial,
        onFinal: (t, l) => cb.onFinal?.(t, l),
        onError: cb.onError,
        onClose: cb.onClose,
      }),
    speak: (text, locale, onAudio, signal, speed) => tts.speak(text, locale, onAudio, signal, speed),
    llm: async (text, ctx) => {
      const r = await readHard(text, ctx)
      if (process.env.VK_DEBUG) console.log('[llm-model]', r.model, Math.round(r.ms), r.fallback ?? '')
      return r.reading
    },
    // Prisma REST reading of the turn audio: language rescue always; the noisy-turn amount
    // cross-check only with SECOND_READING=on (it agreed 57/65 times in the e2e suite, caught no
    // error, and cost 0.4-0.65 s per noisy turn). SECOND_READING=off disables both.
    transcribe2: process.env.SECOND_READING === 'off' ? undefined : (pcm, locale, keyterms, prev) => transcribeRest(key, pcm, locale, keyterms, prev),
    secondReading: process.env.SECOND_READING === 'on',
    send,
    sendAudio: (pcm) => ws.readyState === WebSocket.OPEN && ws.send(pcm),
  })
  send({ type: 'ready', region: process.env.VERCEL_REGION ?? 'local' })

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      session.onAudio(data as Buffer)
      return
    }
    let msg: ClientMsg
    try {
      msg = JSON.parse(data.toString())
    } catch {
      return
    }
    if (!validMsg(msg)) return
    try {
      session.onClient(msg)
    } catch (e) {
      send({ type: 'error', message: `bad message: ${String(e).slice(0, 120)}` })
    }
  })
  ws.on('close', () => {
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
        typeof s.today === 'object' && typeof s.month === 'object'
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
    case 'ptt_start':
    case 'ptt_end':
    case 'playback_done':
    case 'barge':
      return true
    default:
      return false
  }
}
