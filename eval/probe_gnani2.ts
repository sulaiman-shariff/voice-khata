/**
 * Follow-up probes: undocumented `multi_lang_codes` realtime header, and x-min-silence-ms sweep
 * on a sentence with a mid-sentence pause ("Ramesh ka ... 340 udhaar").
 * Usage: npx tsx --env-file=.env eval/probe_gnani2.ts
 */
import WebSocket from 'ws'

const KEY = process.env.GNANI_API_KEY!

function tts(text: string, language: string): Promise<Buffer> {
  return new Promise((resolve) => {
    const ws = new WebSocket('wss://api.vachana.ai/api/v1/tts', { headers: { 'X-API-Key-ID': KEY } })
    const chunks: Buffer[] = []
    const done = () => { ws.close(); resolve(Buffer.concat(chunks)) }
    ws.on('open', () => ws.send(JSON.stringify({ text, voice: 'Shivani', model: 'timbre-v3.0', language, audio_config: { sample_rate: 16000, num_channels: 1, sample_width: 2, encoding: 'linear_pcm', container: 'raw' } })))
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString())
      if (m.type === 'audio' && m.data?.audio) chunks.push(Buffer.from(m.data.audio, 'base64'))
      else if ((m.type === 'complete' && m.message) || m.type === 'error') done()
    })
    setTimeout(done, 15000)
  })
}

function run(pcm: Buffer, headers: Record<string, string>): Promise<string[]> {
  return new Promise((resolve) => {
    const ws = new WebSocket('wss://api.vachana.ai/stt/v3/stream', {
      headers: { 'x-api-key-id': KEY, model: 'prisma-v3.0', format: 'transcribe', 'x-sample-rate': '16000', 'x-partials': 'true', ...headers },
    })
    const out: string[] = []
    let t0 = 0
    let end = 0
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString())
      if (m.type === 'partial_transcript') return
      out.push(`${m.type}@${end ? Math.round(performance.now() - t0 - end) : '-'}${m.text !== undefined ? ` "${m.text}"` : ''}${m.detected_language_code ? ` [${m.detected_language_code}]` : ''}${m.message ? ` ${m.message}` : ''}${m.config ? ` ${JSON.stringify(m.config)}` : ''}`)
    })
    ws.on('close', (c) => { out.push(`close ${c}`); resolve(out) })
    ws.on('error', (e) => out.push(`ws_error ${e}`))
    ws.on('open', async () => {
      t0 = performance.now()
      const all = Buffer.concat([Buffer.alloc(8000), pcm, Buffer.alloc(64000)])
      for (let i = 0; i + 1024 <= all.length; i += 1024) {
        if (ws.readyState !== WebSocket.OPEN) break
        ws.send(all.subarray(i, i + 1024))
        if (i + 1024 >= 8000 + pcm.length && !end) end = performance.now() - t0
        await new Promise((r) => setTimeout(r, 32))
      }
      setTimeout(() => ws.close(), 2500)
    })
    setTimeout(() => resolve(out), 25000)
  })
}

const mixed = await tts('Ramesh ka three hundred forty rupees udhaar likh do', 'hi-IN')
const kn = await tts('ರಮೇಶ್‌ಗೆ ಐನೂರು ರೂಪಾಯಿ ಸಾಲ ಕೊಟ್ಟೆ', 'kn-IN')
for (const h of [
  { language_code: 'hi-IN', multi_lang_codes: 'hi-IN,en-IN' },
  { language_code: 'hi-IN', multi_lang_codes: '["hi-IN","en-IN"]' },
  { language_code: 'hi-IN', multi_lang_codes: 'hi-IN,kn-IN' },
]) {
  console.log(JSON.stringify(h), 'mixed:', (await run(mixed, h)).join(' | '))
  console.log(JSON.stringify(h), 'kannada:', (await run(kn, h)).join(' | '))
}

// a sentence with a 600 ms pause in the middle: does each silence setting split it?
const a = await tts('रमेश का', 'hi-IN')
const b = await tts('तीन सौ चालीस रुपये उधार', 'hi-IN')
const gapped = Buffer.concat([a, Buffer.alloc(16000 * 2 * 0.6), b])
for (const ms of ['300', '500', '700']) {
  console.log(`silence ${ms}:`, (await run(gapped, { language_code: 'hi-IN', 'x-min-silence-ms': ms, 'x-min-segment-ms': '100' })).join(' | '))
}
process.exit(0)
