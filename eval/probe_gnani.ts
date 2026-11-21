/**
 * Live probes for Gnani features we are about to rely on. Each prints OK/BAD with details.
 * Usage: npx tsx --env-file=.env eval/probe_gnani.ts
 */
import WebSocket from 'ws'

const KEY = process.env.GNANI_API_KEY!
const fails: string[] = []
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'OK ' : 'BAD'} ${what}`)
  if (!ok) fails.push(what)
}

/** One TTS request on a fresh socket; returns raw 16 kHz PCM. */
function tts(text: string, voice: string, language: string, extra: Record<string, unknown> = {}): Promise<{ pcm: Buffer; firstMs: number | null; error?: string }> {
  return new Promise((resolve) => {
    const ws = new WebSocket('wss://api.vachana.ai/api/v1/tts', { headers: { 'X-API-Key-ID': KEY } })
    const chunks: Buffer[] = []
    let t0 = 0
    let first: number | null = null
    const done = (error?: string) => {
      ws.close()
      resolve({ pcm: Buffer.concat(chunks), firstMs: first, error })
    }
    ws.on('open', () => {
      t0 = performance.now()
      ws.send(JSON.stringify({
        text, voice, model: 'timbre-v3.0', language, ...extra,
        audio_config: { sample_rate: 16000, num_channels: 1, sample_width: 2, encoding: 'linear_pcm', container: 'raw' },
      }))
    })
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString())
      if (m.type === 'audio' && m.data?.audio) {
        first ??= performance.now() - t0
        chunks.push(Buffer.from(m.data.audio, 'base64'))
      } else if (m.type === 'complete' && m.message) done()
      else if (m.type === 'error') done(m.message)
    })
    ws.on('error', (e) => done(String(e)))
    setTimeout(() => done('timeout'), 15000)
  })
}

/** Stream PCM at real-time cadence into realtime STT with given headers; collect events. */
function sttStream(pcm: Buffer, headers: Record<string, string>): Promise<{ events: { type: string; at: number; text?: string; lang?: string; msg?: string }[]; closeCode?: number; audioEndAt: number }> {
  return new Promise((resolve) => {
    const ws = new WebSocket('wss://api.vachana.ai/stt/v3/stream', {
      headers: { 'x-api-key-id': KEY, model: 'prisma-v3.0', format: 'transcribe', 'x-sample-rate': '16000', 'x-partials': 'true', ...headers },
    })
    const events: { type: string; at: number; text?: string; lang?: string; msg?: string }[] = []
    let t0 = 0
    let audioEndAt = 0
    let closeCode: number | undefined
    const finish = () => resolve({ events, closeCode, audioEndAt })
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString())
      events.push({ type: m.type, at: performance.now() - t0, text: m.text, lang: m.detected_language_code, msg: m.message })
      if (m.type === 'final_transcript' || m.type === 'transcript') setTimeout(() => ws.close(), 200)
    })
    ws.on('close', (c) => {
      closeCode = c
      finish()
    })
    ws.on('error', (e) => events.push({ type: 'ws_error', at: 0, msg: String(e) }))
    ws.on('open', async () => {
      t0 = performance.now()
      const silence = Buffer.alloc(16000 * 2 * 2) // 2 s trailing silence so VAD closes
      const all = Buffer.concat([Buffer.alloc(8000), pcm, silence])
      for (let i = 0; i + 1024 <= all.length; i += 1024) {
        if (ws.readyState !== WebSocket.OPEN) break
        ws.send(all.subarray(i, i + 1024))
        if (i + 1024 >= 8000 + pcm.length && !audioEndAt) audioEndAt = performance.now() - t0
        await new Promise((r) => setTimeout(r, 32))
      }
      setTimeout(() => ws.close(), 3000)
    })
    setTimeout(finish, 20000)
  })
}

const wav = (pcm: Buffer) => {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12)
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24)
  h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}

// ---- test audio
const mixed = await tts('Ramesh ka three hundred forty rupees udhaar likh do', 'Shivani', 'hi-IN')
const hindi = await tts('रमेश का तीन सौ चालीस रुपये उधार लिख दो।', 'Shivani', 'hi-IN')
check(!hindi.error && hindi.pcm.length > 32000, `test audio: hindi ${(hindi.pcm.length / 32000).toFixed(1)} s, mixed ${(mixed.pcm.length / 32000).toFixed(1)} s`)

// ---- 1. language list
for (const lc of ['hi-IN,en-IN', 'hi-IN']) {
  const r = await sttStream(mixed.pcm, { language_code: lc })
  const fin = r.events.find((e) => e.type === 'final_transcript' || e.type === 'transcript')
  const partials = r.events.filter((e) => e.type === 'partial_transcript').length
  const err = r.events.find((e) => e.type === 'error' || e.type === 'ws_error')
  check(!!fin && !err, `STT language_code=${lc}: final="${fin?.text}" lang=${fin?.lang} partials=${partials} ${err ? `err=${err.msg}` : ''} close=${r.closeCode}`)
}

// ---- 2. VAD headers: speech_end delay after audio end
for (const vad of [{}, { 'x-min-silence-ms': '300', 'x-min-segment-ms': '100' }] as Record<string, string>[]) {
  const r = await sttStream(hindi.pcm, { language_code: 'hi-IN', ...vad })
  const se = r.events.find((e) => e.type === 'speech_end')
  const fin = r.events.find((e) => e.type === 'final_transcript' || e.type === 'transcript')
  const err = r.events.find((e) => e.type === 'error' || e.type === 'ws_error')
  check(!!fin && !err, `VAD ${JSON.stringify(vad)}: speech_end +${se ? (se.at - r.audioEndAt).toFixed(0) : '?'} ms, final +${fin ? (fin.at - r.audioEndAt).toFixed(0) : '?'} ms after audio end, "${fin?.text}" ${err ? err.msg : ''}`)
}

// ---- 3. REST STT verbatim
{
  const fd = new FormData()
  fd.append('audio_file', new Blob([wav(hindi.pcm)], { type: 'audio/wav' }), 'a.wav')
  fd.append('model', 'prisma-v3.0')
  fd.append('language_code', 'hi-IN')
  fd.append('format', 'verbatim')
  const t0 = performance.now()
  const res = await fetch('https://api.vachana.ai/stt/v3', { method: 'POST', headers: { 'X-API-Key-ID': KEY }, body: fd })
  const body = await res.text()
  check(res.ok, `REST verbatim ${res.status} in ${(performance.now() - t0).toFixed(0)} ms: ${body.slice(0, 200)}`)
}

// ---- 5. TTS: pauses, speed, voices
{
  const plain = await tts('रमेश 340, सुरेश 200', 'Shivani', 'hi-IN')
  const paused = await tts('रमेश 340, <pauses> सुरेश 200', 'Shivani', 'hi-IN')
  check(!paused.error && paused.pcm.length > plain.pcm.length, `<pauses>: ${(plain.pcm.length / 32000).toFixed(2)} s -> ${(paused.pcm.length / 32000).toFixed(2)} s ${paused.error ?? ''}`)
  const fast = await tts('रमेश, तीन सौ चालीस रुपये उधार लिख दिया।', 'Shivani', 'hi-IN', { speed: 1.2 })
  check(!fast.error && fast.pcm.length > 0, `speed 1.2: ${(fast.pcm.length / 32000).toFixed(2)} s vs ${(hindi.pcm.length / 32000).toFixed(2)} s ${fast.error ?? ''}`)
  const VOICES: [string, string, string][] = [
    ['Sunaina', 'en-IN', 'Ramesh, 340 rupees credit saved.'], ['Sneha', 'kn-IN', 'ರಮೇಶ್, 340 ರೂಪಾಯಿ ಸಾಲ.'],
    ['Kalpana', 'ta-IN', 'ரமேஷ், 340 ரூபாய் கடன்.'], ['Kalpana', 'te-IN', 'రమేష్, 340 రూపాయలు అప్పు.'],
    ['Tarika', 'ml-IN', 'രമേശ്, 340 രൂപ കടം.'], ['Kalpana', 'pa-IN', 'ਰਮੇਸ਼, 340 ਰੁਪਏ ਉਧਾਰ।'],
  ]
  for (const [v, l, t] of VOICES) {
    const r = await tts(t, v, l)
    check(!r.error && r.pcm.length > 16000, `voice ${v} ${l}: ${r.error ?? `first ${r.firstMs?.toFixed(0)} ms, ${(r.pcm.length / 32000).toFixed(2)} s`}`)
  }
}

console.log(`\n${fails.length} failures`)
process.exit(fails.length ? 1 : 0)
