/**
 * Round trip for the agent's per-language voices: the reply template with an amount is spoken by
 * Timbre (voiceFor(locale)), transcribed by Prisma REST (format=transcribe), and the amount must
 * come back exactly. Guards the README claim that spoken digits are read correctly.
 * Usage: npx tsx --env-file=.env eval/tts_roundtrip.ts
 */
import { transcribeRest } from '../server/gnani/rest.js'
import { TtsPool, voiceFor } from '../server/gnani/tts.js'
import { parseAmounts } from '../shared/numbers.js'
import { LANGS, LOCALE, say } from '../shared/replies.js'

const KEY = process.env.GNANI_API_KEY!
const pool = new TtsPool(KEY, 1)
await new Promise((r) => setTimeout(r, 800))
let fails = 0
for (const lang of LANGS) {
  for (const amt of [1870, 70, 17]) {
    const text = say(lang).saved('Ramesh', amt, 'credit')
    const chunks: Buffer[] = []
    await pool.speak(text, LOCALE[lang], (pcm) => chunks.push(pcm))
    let heard = ''
    try {
      heard = (await transcribeRest(KEY, Buffer.concat(chunks), LOCALE[lang])).text
    } catch (e) {
      heard = `ERR ${e}`
    }
    // REST allows one request at a time: a little gap between calls
    await new Promise((r) => setTimeout(r, 300))
    const got = parseAmounts(heard.replace(/₹/g, ' ')).map((a) => a.value)
    const ok = got.includes(amt)
    if (!ok) fails++
    console.log(`${ok ? 'OK ' : 'BAD'} ${lang} ${voiceFor(LOCALE[lang]).padEnd(8)} ${amt}: "${heard}"`)
  }
}
pool.close()
console.log(`\n${fails} failures`)
process.exit(fails ? 1 : 0)
