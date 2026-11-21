/** Probe: does Prisma realtime accept an auto/multi language code? Usage: npx tsx --env-file=.env eval/probe_gnani6.ts */
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
    setTimeout(() => resolve(out), 60000)
  })
}

const clips: [string, Buffer][] = [
  ['kn', await tts('ರಮೇಶ್‌ಗೆ ಐನೂರು ರೂಪಾಯಿ ಸಾಲ ಕೊಟ್ಟೆ', 'kn-IN')],
  ['kn2', await tts('ಸುರೇಶ್ ಮುನ್ನೂರು ರೂಪಾಯಿ ಕೊಟ್ಟರು', 'kn-IN')],
  ['ta', await tts('ரமேஷுக்கு ஐநூறு ரூபாய் கடன் கொடுத்தேன்', 'ta-IN')],
  ['te', await tts('రమేష్ కి ఐదు వందల రూపాయలు అప్పు ఇచ్చాను', 'te-IN')],
  ['ml', await tts('രമേഷിന് അഞ്ഞൂറ് രൂപ കടം കൊടുത്തു', 'ml-IN')],
  ['mr', await tts('रमेशला पाचशे रुपये उधार दिले', 'mr-IN')],
  ['bn', await tts('রমেশকে পাঁচশো টাকা বাকি দিলাম', 'bn-IN')],
  ['gu', await tts('રમેશને પાંચસો રૂપિયા ઉધાર આપ્યા', 'gu-IN')],
  ['pa', await tts('ਰਮੇਸ਼ ਨੂੰ ਪੰਜ ਸੌ ਰੁਪਏ ਉਧਾਰ ਦਿੱਤੇ', 'pa-IN')],
  ['en', await tts('I gave five hundred rupees to Ramesh on credit', 'en-IN')],
  ['hi', await tts('रमेश का तीन सौ चालीस रुपये उधार लिख दो', 'hi-IN')],
  ['hinglish', await tts('Ramesh ka three hundred forty rupees udhaar likh do', 'hi-IN')],
]
for (const code of process.argv.slice(2).filter((a) => !a.startsWith('--')).length ? process.argv.slice(2).filter((a) => !a.startsWith('--')) : process.argv.includes('--stream') ? [] : ['indic-auto']) {
  for (const [l, pcm] of clips) {
    const r = await run(pcm, { language_code: code })
    console.log(`${code} / ${l}:`, r.filter((x) => x.startsWith('final') || x.startsWith('error')).join(' | ').slice(0, 300))
  }
}

// one stream, several languages in a row (how the app uses it): does indic-auto stay on the first language?
if (process.argv.includes('--stream')) {
  const order = ['hi', 'kn2', 'ta', 'en', 'te', 'hi']
  const pcm = Buffer.concat(order.flatMap((l) => [clips.find((c) => c[0] === l)![1], Buffer.alloc(48000)]))
  const r = await run(pcm, { language_code: 'indic-auto' })
  console.log('ONE STREAM', order.join(' > '), '\n ', r.filter((x) => x.startsWith('final')).join('\n  '))
}

// which app header pulls indic-auto to Hindi: topic, keyterms (Devanagari names), or both?
if (process.argv.includes('--headers')) {
  const esc = (s: string) => s.replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
  const topic = 'kirana shop credit ledger: customer names, rupee amounts, udhaar and payments'
  const keyterms = esc(JSON.stringify(['रमेश', 'Ramesh', 'सुरेश', 'Suresh']))
  const order = ['kn2', 'ta', 'en', 'te']
  const pcm = Buffer.concat(order.flatMap((l) => [clips.find((c) => c[0] === l)![1], Buffer.alloc(48000)]))
  for (const [label, h] of (process.argv.includes('--latin') ? (x: [string, Record<string, string>][]) => x.slice(-1) : (x: [string, Record<string, string>][]) => x)([
    ['none', {}], ['topic', { topic }], ['keyterms', { keyterms }], ['both', { topic, keyterms }],
    ['latin keyterms', { topic, keyterms: JSON.stringify(['Ramesh', 'Suresh']) }],
  ])) {
    const r = await run(pcm, { language_code: 'indic-auto', ...h })
    console.log(`${label}:`, r.filter((x) => x.startsWith('final')).map((x) => x.replace(/^final_transcript@\S+ /, '')).join(' | '))
  }
}
