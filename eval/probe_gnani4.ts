/**
 * Does `update_settings` with `language_code` switch a live realtime stream (used by the
 * language rescue)? Hindi session, Kannada speech, switch to kn-IN, Kannada speech again.
 * Usage: npx tsx --env-file=.env eval/probe_gnani4.ts
 */
import WebSocket from 'ws'

const KEY = process.env.GNANI_API_KEY!

function tts(text: string, language: string): Promise<Buffer> {
  return new Promise((resolve) => {
    const ws = new WebSocket('wss://api.vachana.ai/api/v1/tts', { headers: { 'X-API-Key-ID': KEY } })
    const chunks: Buffer[] = []
    const done = () => { ws.close(); resolve(Buffer.concat(chunks)) }
    ws.on('open', () => ws.send(JSON.stringify({ text, voice: 'Sneha', model: 'timbre-v3.0', language, audio_config: { sample_rate: 16000, num_channels: 1, sample_width: 2, encoding: 'linear_pcm', container: 'raw' } })))
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString())
      if (m.type === 'audio' && m.data?.audio) chunks.push(Buffer.from(m.data.audio, 'base64'))
      else if ((m.type === 'complete' && m.message) || m.type === 'error') done()
    })
    setTimeout(done, 15000)
  })
}

const kn = await tts('ರಮೇಶ್‌ಗೆ ಐನೂರು ರೂಪಾಯಿ ಸಾಲ ಕೊಟ್ಟೆ', 'kn-IN')
const ws = new WebSocket('wss://api.vachana.ai/stt/v3/stream', {
  headers: { 'x-api-key-id': KEY, model: 'prisma-v3.0', language_code: 'hi-IN', format: 'transcribe', 'x-sample-rate': '16000', 'x-partials': 'true', 'x-min-silence-ms': '500' },
})
const send = async (pcm: Buffer) => {
  const all = Buffer.concat([pcm, Buffer.alloc(40000)])
  for (let i = 0; i + 1024 <= all.length; i += 1024) {
    ws.send(all.subarray(i, i + 1024))
    await new Promise((r) => setTimeout(r, 32))
  }
}
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString())
  if (m.type === 'partial_transcript') return
  console.log(m.type, m.text ?? '', m.detected_language_code ?? '', m.config ? JSON.stringify(m.config) : '', m.message ?? '')
})
await new Promise((r) => ws.once('open', r))
await send(kn)
await new Promise((r) => setTimeout(r, 1500))
ws.send(JSON.stringify({ type: 'update_settings', language_code: 'kn-IN' }))
await new Promise((r) => setTimeout(r, 500))
await send(kn)
await new Promise((r) => setTimeout(r, 2500))
ws.close()
process.exit(0)
