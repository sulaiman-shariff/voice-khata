/**
 * The wake word "KhataBhai" in a transcript, in any script, and the words that put the app to
 * sleep. Matching is phonetic (phoneticKey), so "खाता भाई", "ಖಾತಾ ಭಾಯ್" and "Khata Bhai" all hit.
 */
import { phoneticKey } from './names.js'

const KHATA = phoneticKey('khata')
const BHAI = phoneticKey('bhai')
const KHATABHAI = phoneticKey('khatabhai')

const SEP = /[\s,.।!?"'“”]/

/** Where the wake word is in `text` (a span of words), or null. */
function find(text: string): { start: number; end: number } | null {
  const toks = [...text.matchAll(/[^\s,.।!?"'“”]+/gu)].map((m) => ({ key: phoneticKey(m[0]), start: m.index!, end: m.index! + m[0].length }))
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].key === KHATABHAI) return { start: toks[i].start, end: toks[i].end }
    if (toks[i].key === KHATA && toks[i + 1]?.key === BHAI) return { start: toks[i].start, end: toks[i + 1].end }
  }
  return null
}

/** Is the wake word in `text`, and what is left of the text without it. */
export function spotWake(text: string): { found: boolean; rest: string } {
  const at = find(text)
  if (!at) return { found: false, rest: text.trim() }
  const before = text.slice(0, at.start).replace(/[\s,]+$/, '')
  const after = text.slice(at.end)
  const rest = before
    ? `${before}${/^\s*[,।.]/.test(after) ? '' : ' '}${after.trimStart()}`
    : after.replace(new RegExp(`^(?:${SEP.source})+`), '')
  return { found: true, rest: rest.trim() }
}

const SLEEP_KEYS = new Set([
  'bas', 'basbas', 'basa', 'hogaya', 'bashogaya', 'hogayabas', 'baskaro', 'theekhaibas', 'thikhaibas',
  'baskarobhai', 'basbhai', 'bashogayabhai',
  'thatsall', 'thatisall', 'enough', 'stoplistening', 'gotosleep', 'sleep',
  'saku', 'basu', 'aitu', 'sakubidi', 'sakaayitu',
].map((k) => phoneticKey(k)))

/** The whole utterance is a "that's all" (bas / ho gaya / theek hai bas, in hi/kn/en spellings). */
export function isSleepWord(text: string): boolean {
  const key = phoneticKey(text)
  return key.length > 0 && SLEEP_KEYS.has(key)
}
