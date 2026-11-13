/**
 * Voice Khata session endpoint (Vercel Function, Node, region bom1, WebSocket).
 * Phone <-> this function <-> Gnani Prisma (STT) / Timbre (TTS), with Claude Haiku as the
 * fallback parser. All dialogue logic lives in server/session.ts.
 */
import http from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import type { ClientMsg, ServerMsg } from '../shared/protocol.js'
import { SttStream } from '../server/gnani/stt.js'
import { TtsPool } from '../server/gnani/tts.js'
import { readWithLlm, warmUp } from '../server/parse/llm.js'
import { Session } from '../server/session.js'

const server = http.createServer((_req, res) => {
  res.writeHead(426, { 'content-type': 'text/plain' })
  res.end('WebSocket upgrade required')
})

const wss = new WebSocketServer({ server, maxPayload: 1 << 20 })
let warmed = false

wss.on('connection', (ws) => {
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
        onFinal: (t) => cb.onFinal?.(t),
        onError: cb.onError,
      }),
    speak: (text, locale, onAudio, signal) => tts.speak(text, locale, onAudio, signal),
    llm: async (text, ctx) => (await readWithLlm(text, ctx)).reading,
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
    session.onClient(msg)
  })
  ws.on('close', () => {
    session.close()
    tts.close()
  })
})

export default server
