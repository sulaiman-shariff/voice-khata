/**
 * Third round of live probes:
 *  A. v3.0 vs v2.5 realtime on amounts in five languages (v2.5: dedicated model per language,
 *     ITN; with bias_list boosting) — which reads the rupee amount more exactly?
 *  B. REST with indic-auto / language lists + previous_text: detected language on a Kannada clip
 *     sent to a Hindi session.
 *  C. Realtime substitution_map header and x-min-speech-ms / x-max-speech-s acceptance.
 *  D. TTS: is there a cancel message? Send {"type":"cancel"} mid-stream and see what happens.
 * Usage: npx tsx --env-file=.env eval/probe_gnani3.ts
 */
import WebSocket from 'ws'
import { wav16k } from '../server/gnani/rest.js'
import { parseAmounts } from '../shared/numbers.js'

const KEY = process.env.GNANI_API_KEY!

function tts(text: string, language: string, voice = 'Shivani'): Promise<Buffer> {
  return new Promise((resolve) => {
    const ws = new WebSocket('wss://api.vachana.ai/api/v1/tts', { headers: { 'X-API-Key-ID': KEY } })
    const chunks: Buffer[] = []
    const done = () => { ws.close(); resolve(Buffer.concat(chunks)) }
    ws.on('open', () => ws.send(JSON.stringify({ text, voice, model: 'timbre-v3.0', language, audio_config: { sample_rate: 16000, num_channels: 1, sample_width: 2, encoding: 'linear_pcm', container: 'raw' } })))
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString())
      if (m.type === 'audio' && m.data?.audio) chunks.push(Buffer.from(m.data.audio, 'base64'))
      else if ((m.type === 'complete' && m.message) || m.type === 'error') done()
    })
    setTimeout(done, 15000)
  })
}

function stt(pcm: Buffer, headers: Record<string, string>): Promise<{ finals: string[]; errors: string[]; close?: number; closeReason?: string }> {
  return new Promise((resolve) => {
    const ws = new WebSocket('wss://api.vachana.ai/stt/v3/stream', {
      headers: { 'x-api-key-id': KEY, 'x-sample-rate': '16000', 'x-min-silence-ms': '500', ...headers },
    })
    const finals: string[] = []
    const errors: string[] = []
    let close: number | undefined
    let closeReason: string | undefined
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString())
      if (m.type === 'final_transcript' || m.type === 'transcript') finals.push(m.text + (m.detected_language_code ? ` [${m.detected_language_code}]` : ''))
      if (m.type === 'error') errors.push(m.message)
    })
    ws.on('close', (c, r) => { close = c; closeReason = r.toString(); resolve({ finals, errors, close, closeReason }) })
    ws.on('unexpected-response', (_req, res) => { errors.push(`http ${res.statusCode}`); resolve({ finals, errors }) })
    ws.on('error', (e) => errors.push(String(e)))
    ws.on('open', async () => {
      const all = Buffer.concat([Buffer.alloc(8000), pcm, Buffer.alloc(48000)])
      for (let i = 0; i + 1024 <= all.length; i += 1024) {
        if (ws.readyState !== WebSocket.OPEN) break
        ws.send(all.subarray(i, i + 1024))
        await new Promise((r) => setTimeout(r, 32))
      }
      setTimeout(() => ws.close(), 2000)
    })
    setTimeout(() => resolve({ finals, errors, close }), 25000)
  })
}

const amounts = (t: string) => parseAmounts(t).map((s) => s.value).join('+') || '-'

// ---- A. v3.0 vs v2.5 on amounts
const CLIPS: [string, string, number, string[]][] = [
  ['hi-IN', 'सुरेश ने सत्तर रुपये जमा किए', 70, ['सुरेश']],
  ['hi-IN', 'गीता का एक हज़ार आठ सौ सत्तर रुपये उधार', 1870, ['गीता']],
  ['kn-IN', 'ರಮೇಶ್‌ಗೆ ಏಳುನೂರ ಐವತ್ತು ರೂಪಾಯಿ ಸಾಲ ಕೊಟ್ಟೆ', 750, ['ರಮೇಶ್']],
  ['ta-IN', 'சுரேஷ் அறுபது ரூபாய் கொடுத்தார்', 60, ['சுரேஷ்']],
  ['te-IN', 'రమేష్ కి పదిహేడు వందల రూపాయలు అప్పు', 1700, ['రమేష్']],
  ['en-IN', 'Geeta paid fifteen hundred rupees', 1500, ['Geeta']],
  ['mr-IN', 'सुनीताला साडेतीनशे रुपये उधार', 350, ['सुनीता']],
]
const VOICE: Record<string, string> = { 'hi-IN': 'Shivani', 'kn-IN': 'Sneha', 'ta-IN': 'Kalpana', 'te-IN': 'Kalpana', 'en-IN': 'Sunaina', 'mr-IN': 'Shivani' }
const score: Record<string, number> = {}
const audio: Buffer[] = []
for (const [lang, text, want, names] of CLIPS) {
  const pcm = await tts(text, lang, VOICE[lang])
  audio.push(pcm)
  const configs: [string, Record<string, string>][] = [
    ['v3.0 transcribe', { model: 'prisma-v3.0', language_code: lang, format: 'transcribe', keyterms: JSON.stringify(names).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`) }],
    ['v2.5 transcribe', { model: 'prisma-v2.5', language_code: lang, format: 'transcribe' }],
    ['v2.5 verbatim', { model: 'prisma-v2.5', language_code: lang, format: 'verbatim' }],
  ]
  for (const [label, h] of configs) {
    const r = await stt(pcm, h)
    const text = r.finals.join(' ')
    const got = amounts(text)
    const ok = got === String(want)
    score[label] = (score[label] ?? 0) + (ok ? 1 : 0)
    console.log(`${ok ? 'OK ' : 'BAD'} A ${lang} ${label}: "${text}" -> ${got} (want ${want}) ${r.errors.join(';')}`)
  }
}
console.log('A scores:', JSON.stringify(score), `of ${CLIPS.length}`)

// ---- B. REST language detection with lists / indic-auto, and previous_text
async function rest(pcm: Buffer, fields: Record<string, string>) {
  const fd = new FormData()
  fd.append('audio_file', new Blob([new Uint8Array(wav16k(pcm))], { type: 'audio/wav' }), 'a.wav')
  fd.append('model', 'prisma-v3.0')
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  const t0 = performance.now()
  const res = await fetch('https://api.vachana.ai/stt/v3', { method: 'POST', headers: { 'X-API-Key-ID': KEY }, body: fd })
  const b = (await res.json()) as { transcript?: string; detected_language_code?: string; error?: unknown; detail?: unknown }
  return `${res.status} ${(performance.now() - t0).toFixed(0)}ms "${b.transcript}" [${b.detected_language_code}] ${b.error || b.detail ? JSON.stringify(b.error ?? b.detail).slice(0, 150) : ''}`
}
const kn = audio[2]
for (const lc of ['hi-IN', 'hi-IN,en-IN,kn-IN,ta-IN', 'indic-auto']) {
  console.log(`B kn clip, REST language_code=${lc} verbatim:`, await rest(kn, { language_code: lc, format: 'verbatim' }))
  console.log(`B kn clip, REST language_code=${lc} transcribe:`, await rest(kn, { language_code: lc, format: 'transcribe' }))
}
const haan = await tts('हाँ', 'hi-IN')
console.log('B short "haan", no context:', await rest(haan, { language_code: 'hi-IN', format: 'verbatim' }))
console.log('B short "haan", previous_text:', await rest(haan, { language_code: 'hi-IN', format: 'verbatim', previous_text: 'रमेश, 340 रुपये उधार, सही है?' }))
console.log('B REST transliterate:', await rest(audio[1], { format: 'transliterate' }))
console.log('B REST codemix:', await rest(audio[1], { language_code: 'hi-IN', format: 'codemix' }))

// ---- C. realtime substitution + VAD extras
{
  const sub = JSON.stringify([{ patterns: ['उधार'], replacement: 'UDHAAR' }]).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
  const r = await stt(audio[1], { model: 'prisma-v3.0', language_code: 'hi-IN', format: 'transcribe', enable_substitution: 'true', substitution_map: sub })
  console.log('C substitution:', r.finals, r.errors, r.close, r.closeReason)
  const r2 = await stt(audio[1], { model: 'prisma-v3.0', language_code: 'hi-IN', format: 'transcribe', 'x-min-speech-ms': '200', 'x-max-speech-s': '20' })
  console.log('C min-speech 200 / max-speech 20:', r2.finals, r2.errors, r2.close)
}

// ---- D. TTS cancel
{
  const ws = new WebSocket('wss://api.vachana.ai/api/v1/tts', { headers: { 'X-API-Key-ID': KEY } })
  const log: string[] = []
  let chunks = 0
  let after = 0
  let sent = false
  await new Promise<void>((resolve) => {
    ws.on('open', () => ws.send(JSON.stringify({ text: 'सुरेश, आपका कुल बकाया एक हज़ार आठ सौ सत्तर रुपये है, और कल का वादा पाँच सौ रुपये का है। गीता का बकाया तीन सौ रुपये है।', voice: 'Shivani', model: 'timbre-v3.0', language: 'hi-IN', audio_config: { sample_rate: 16000, num_channels: 1, sample_width: 2, encoding: 'linear_pcm', container: 'raw' } })))
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString())
      if (m.type === 'audio') {
        chunks++
        if (sent) after++
        if (chunks === 2 && !sent) { sent = true; ws.send(JSON.stringify({ type: 'cancel' })) }
      } else log.push(`${m.type}:${m.message ?? ''}`)
      if (m.type === 'complete' && m.message === 'Streaming completed') resolve()
    })
    ws.on('close', (c) => { log.push(`close ${c}`); resolve() })
    setTimeout(resolve, 10000)
  })
  console.log(`D TTS cancel: chunks ${chunks}, after cancel ${after}, events ${log.join(' | ')}`)
  ws.close()
}
process.exit(0)
