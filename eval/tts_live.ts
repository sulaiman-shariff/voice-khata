/**
 * Live test of the TTS pool: warm latency, back-to-back reuse, barge-in, and every language.
 * Usage: npx tsx --env-file=.env eval/tts_live.ts
 */
import { TtsPool } from '../server/gnani/tts.js'

const pool = new TtsPool(process.env.GNANI_API_KEY!, 2)
await new Promise((r) => setTimeout(r, 800)) // let the pool connect, as it would at session start
const fails: string[] = []
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'OK ' : 'BAD'} ${what}`)
  if (!ok) fails.push(what)
}

// 1. warm latency, sequential reuse of the same sockets
const firsts: number[] = []
for (let i = 0; i < 4; i++) {
  const r = await pool.speak('रमेश, तीन सौ चालीस रुपये उधार लिख दिया।', 'hi-IN', () => {})
  firsts.push(r.firstAudioMs ?? NaN)
  check(!r.error && r.bytes > 32000, `hi-IN reply ${i + 1}: first audio ${r.firstAudioMs?.toFixed(0)} ms, ${(r.bytes / 32000).toFixed(2)} s audio`)
}

// 2. barge-in: abort after the first chunk, then the next reply must still be clean and quick
const ac = new AbortController()
let afterAbort = 0
const cut = await pool.speak('सुरेश, आपका कुल बकाया एक हज़ार आठ सौ सत्तर रुपये है, और कल का वादा पाँच सौ रुपये का है।', 'hi-IN', (pcm) => {
  if (ac.signal.aborted) afterAbort += pcm.length
  else ac.abort()
}, ac.signal)
check(cut.cancelled && afterAbort === 0, `barge-in stops delivery at once (bytes after abort: ${afterAbort})`)
const next = await pool.speak('ठीक है।', 'hi-IN', () => {})
check(!next.error && (next.firstAudioMs ?? 9e9) < 800, `reply after barge-in: first audio ${next.firstAudioMs?.toFixed(0)} ms`)

// 3. every language Voice Khata supports, with the agent voice
const LANGS: [string, string][] = [
  ['hi-IN', 'नमस्ते, मैं वॉइस खाता हूँ।'], ['en-IN', 'Hello, I am Voice Khata.'], ['kn-IN', 'ನಮಸ್ಕಾರ, ನಾನು ವಾಯ್ಸ್ ಖಾತಾ.'],
  ['ta-IN', 'வணக்கம், நான் வாய்ஸ் கட்டா.'], ['te-IN', 'నమస్కారం, నేను వాయిస్ ఖాతా.'], ['ml-IN', 'നമസ്കാരം, ഞാൻ വോയ്സ് ഖാത.'],
  ['mr-IN', 'नमस्कार, मी व्हॉइस खाता.'], ['bn-IN', 'নমস্কার, আমি ভয়েস খাতা।'], ['gu-IN', 'નમસ્તે, હું વૉઇસ ખાતા છું.'],
  ['pa-IN', 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਮੈਂ ਵੌਇਸ ਖਾਤਾ ਹਾਂ।'],
]
for (const [lang, text] of LANGS) {
  const r = await pool.speak(text, lang, () => {})
  check(!r.error && r.bytes > 16000, `${lang}: ${r.error ?? `first ${r.firstAudioMs?.toFixed(0)} ms, ${(r.bytes / 32000).toFixed(2)} s`}`)
}
firsts.sort((a, b) => a - b)
console.log(`\nwarm first-audio median ${firsts[1].toFixed(0)}-${firsts[2].toFixed(0)} ms; ${fails.length} failures`)
pool.close()
process.exit(fails.length ? 1 : 0)
