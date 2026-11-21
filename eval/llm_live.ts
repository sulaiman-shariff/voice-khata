/**
 * Live check of the Haiku slow path: accuracy on hard utterances, latency, cache hits.
 * Usage: npx tsx --env-file=.env eval/llm_live.ts
 */
import { readWithLlm, validate } from '../server/parse/llm.js'

type Exp = { type: string; amounts?: number[]; dirs?: (string | null)[]; low?: boolean }
const CASES: [string, Exp][] = [
  // ones the fast path cannot settle
  ['Ramesh 340', { type: 'entries', amounts: [340], low: true }],
  ['Deepak ne saath rupaye diye', { type: 'entries', amounts: [60], dirs: ['payment'], low: true }],
  ['Sharma ji wale ka hisaab mein do sau aur jod do', { type: 'entries', amounts: [200], dirs: ['credit'] }],
  ['Pinky ki mummy aayi thi, paanch sau de gayi', { type: 'entries', amounts: [500], dirs: ['payment'] }],
  // last entry is Ramesh 340, so this is a correction of it
  ['Ramesh ka 340 nahi 430 tha udhaar', { type: 'correct' }],
  ['Suresh ka jo 200 tha wo usne chuka diya', { type: 'entries', amounts: [200], dirs: ['payment'] }],
  ['Geeta next week paanch sau dene ka bol rahi thi', { type: 'entries', amounts: [500], dirs: ['payment'] }],
  ['मोहन का पानी 200 धान ले', { type: 'entries', low: true }],
  ['Sunitu dobar 1,000 rupees on credit', { type: 'entries', amounts: [1000], low: true }],
  ['भैया दो किलो चीनी देना', { type: 'unknown' }],
  ['और सड़क पर बहुत सारे लोग बैठे हुए हैं।', { type: 'unknown' }],
  ['Ramesh pe kitna baaki hai abhi', { type: 'query' }],
  ['pichli entry galat thi, use mita do', { type: 'undo' }],
  ['nahi nahi, wo Suresh tha Ramesh nahi', { type: 'correct' }],
  ['ರಮೇಶ್‌ಗೆ ಐನೂರು ಸಾಲ ಕೊಟ್ಟೆ', { type: 'entries', amounts: [500], dirs: ['credit'] }],
  ['ரமேஷ் நாளைக்கு ஐநூறு தருவார்', { type: 'entries', amounts: [500], dirs: ['payment'] }],
]

let ok = 0
const lat: number[] = []
for (const [text, exp] of CASES) {
  const { reading, ms, cachedTokens } = await readWithLlm(text, {
    lang: 'hi-IN', customers: ['Ramesh', 'Suresh', 'Geeta', 'Sharma ji', 'Sunita', 'Mohan', 'Deepak'],
    lastEntry: 'Ramesh credit 340 today',
  })
  lat.push(ms)
  const intent = validate(text, reading)
  let pass = intent.type === exp.type
  if (pass && intent.type === 'entries') {
    if (exp.amounts) pass &&= JSON.stringify(intent.entries.map((e) => e.amount.value)) === JSON.stringify(exp.amounts)
    if (exp.dirs) pass &&= JSON.stringify(intent.entries.map((e) => e.direction)) === JSON.stringify(exp.dirs)
    if (exp.low) pass &&= intent.entries.some((e) => e.confidence === 'low')
  }
  if (pass) ok++
  console.log(`${pass ? 'OK ' : 'BAD'} ${ms.toFixed(0).padStart(5)}ms cache=${cachedTokens} | ${text}\n      ${JSON.stringify(reading)}`)
}
lat.sort((a, b) => a - b)
console.log(`\n${ok}/${CASES.length} correct; p50 ${lat[Math.floor(lat.length / 2)].toFixed(0)}ms p90 ${lat[Math.floor(lat.length * 0.9)].toFixed(0)}ms`)
