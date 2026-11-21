/**
 * How fast can buffered speech be replayed into Prisma realtime STT? Streams the same clips at
 * 1x, 2x and 4x the real-time frame cadence and compares transcripts (the docs say "do not burst").
 * Usage: npx tsx --env-file=.env eval/probe_gnani5.ts
 */
import WebSocket from 'ws'
import { parseAmounts } from '../shared/numbers.js'

const KEY = process.env.GNANI_API_KEY!

function tts(text: string, language: string, voice: string): Promise<Buffer> {
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

function stt(pcm: Buffer, lang: string, speed: number): Promise<{ text: string; errors: string[]; ms: number }> {
  return new Promise((resolve) => {
    const ws = new WebSocket('wss://api.vachana.ai/stt/v3/stream', {
      headers: { 'x-api-key-id': KEY, model: 'prisma-v3.0', language_code: lang, format: 'transcribe', 'x-sample-rate': '16000', 'x-partials': 'true' },
    })
    const finals: string[] = []
    const errors: string[] = []
    let t0 = 0
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString())
      if (m.type === 'final_transcript' || m.type === 'transcript') finals.push(m.text)
      if (m.type === 'error') errors.push(m.message)
    })
    ws.on('close', () => resolve({ text: finals.join(' '), errors, ms: performance.now() - t0 }))
    ws.on('open', async () => {
      t0 = performance.now()
      // the replayed part fast, then live-like trailing silence at 1x so VAD can close the turn
      const fast = Buffer.concat([Buffer.alloc(8000), pcm])
      for (let i = 0; i + 1024 <= fast.length; i += 1024) {
        ws.send(fast.subarray(i, i + 1024))
        await new Promise((r) => setTimeout(r, 32 / speed))
      }
      const tail = Buffer.alloc(48000)
      for (let i = 0; i + 1024 <= tail.length; i += 1024) {
        ws.send(tail.subarray(i, i + 1024))
        await new Promise((r) => setTimeout(r, 32))
      }
      setTimeout(() => ws.close(), 2500)
    })
    setTimeout(() => resolve({ text: finals.join(' '), errors, ms: performance.now() - t0 }), 30000)
  })
}

const CLIPS: [string, string, string, number[]][] = [
  ['hi-IN', 'Shivani', 'सुरेश ने एक हज़ार आठ सौ सत्तर रुपये दिए, और रमेश का तीन सौ चालीस रुपये उधार लिख दो।', [1870, 340]],
  ['kn-IN', 'Sneha', 'ಮೋಹನ್ ಅವರ ಏಳುನೂರ ಐವತ್ತು ರೂಪಾಯಿ ಸಾಲ, ಸುರೇಶ್ ಅರವತ್ತು ರೂಪಾಯಿ ಕೊಟ್ಟರು.', [750, 60]],
  ['en-IN', 'Sunaina', 'Suleman gave me three hundred, and Mahi gave me four hundred and seventy.', [300, 470]],
]
for (const [lang, voice, text, want] of CLIPS) {
  const pcm = await tts(text, lang, voice)
  for (const speed of [1, 2, 4]) {
    const r = await stt(pcm, lang, speed)
    const got = parseAmounts(r.text).map((a) => a.value)
    const ok = JSON.stringify(got) === JSON.stringify(want)
    console.log(`${ok ? 'OK ' : 'BAD'} ${lang} ${speed}x (${(pcm.length / 32000).toFixed(1)} s clip): ${JSON.stringify(got)} "${r.text}" ${r.errors.join(';')}`)
  }
}
process.exit(0)
