// Renders extra wake-word positives and non-wake clips with Gnani Timbre.
// Run from repo root: npx tsx --env-file=.env wakeword/render_gnani.ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { TtsPool, type TtsSpeed } from '../server/gnani/tts.js'

const POS = ['KhataBhai', 'Khata Bhai', 'खाताभाई', 'ಖಾತಾಭಾಯ್', 'Khata Bhai!', 'खाता भाई', 'ಖಾತಾ ಭಾಯ್']
const NEG: Record<string, string[]> = {
  'en-IN': ['Please show my account', 'Hello brother how are you', 'What is the weather today', 'Book a ticket for me'],
  'hi-IN': ['खाता दिखाओ', 'भाई कैसे हो', 'आज का हिसाब बताओ', 'चाय दो'],
  'kn-IN': ['ಖಾತೆ ತೋರಿಸು', 'ಅಣ್ಣ ಹೇಗಿದ್ದೀರಿ', 'ಇವತ್ತು ಎಷ್ಟು ಆಯ್ತು', 'ನೀರು ಕೊಡಿ'],
}
const LANGS = ['hi-IN', 'kn-IN', 'en-IN']
const SPEEDS: TtsSpeed[] = [0.8, 1, 1.2]
const out = 'wakeword/data'
mkdirSync(`${out}/pos`, { recursive: true })
mkdirSync(`${out}/neg`, { recursive: true })
const pool = new TtsPool(process.env.GNANI_API_KEY!, 4)
const jobs: { path: string; text: string; lang: string; speed: TtsSpeed }[] = []
for (const lang of LANGS) for (const speed of SPEEDS) {
  POS.forEach((t, i) => jobs.push({ path: `${out}/pos/${lang}_${speed}_${i}.pcm`, text: t, lang, speed }))
  NEG[lang].forEach((t, i) => jobs.push({ path: `${out}/neg/${lang}_${speed}_${i}.pcm`, text: t, lang, speed }))
}
let ok = 0, fail = 0, next = 0
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < jobs.length) {
    const j = jobs[next++]
    const chunks: Buffer[] = []
    const r = await pool.speak(j.text, j.lang, (b) => chunks.push(b), undefined, j.speed)
    if (r.error || !chunks.length) { fail++; console.error('fail', j.path, r.error); continue }
    writeFileSync(j.path, Buffer.concat(chunks)); ok++
  }
}))
console.log({ ok, fail })
pool.close()
