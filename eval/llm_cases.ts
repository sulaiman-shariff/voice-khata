/** Hard utterances for the slow path, shared by eval/llm_live.ts (Haiku) and eval/llm_gemini.ts. */
import type { LlmContext, LlmReading } from '../server/parse/llm.js'
import { validate } from '../server/parse/llm.js'

export type Exp = { type: string; amounts?: number[]; dirs?: (string | null)[]; low?: boolean }
export const CASES: [string, Exp][] = [
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

export const CTX: LlmContext = {
  lang: 'hi-IN', customers: ['Ramesh', 'Suresh', 'Geeta', 'Sharma ji', 'Sunita', 'Mohan', 'Deepak'],
  lastEntry: 'Ramesh credit 340 today',
}

/** Does the model's reading, after the same validation the app applies, match what was meant? */
export function score(text: string, reading: Partial<LlmReading>, exp: Exp): boolean {
  const intent = validate(text, reading)
  let pass = intent.type === exp.type
  if (pass && intent.type === 'entries') {
    if (exp.amounts) pass &&= JSON.stringify(intent.entries.map((e) => e.amount.value)) === JSON.stringify(exp.amounts)
    if (exp.dirs) pass &&= JSON.stringify(intent.entries.map((e) => e.direction)) === JSON.stringify(exp.dirs)
    if (exp.low) pass &&= intent.entries.some((e) => e.confidence === 'low')
  }
  return pass
}

export const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]
