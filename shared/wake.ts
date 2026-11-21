/**
 * The wake word "KhataBhai" in a transcript, in any script, and the words that put the app to
 * sleep. Matching is phonetic (phoneticKey), so "खाता भाई", "ಖಾತಾ ಭಾಯ್" and "Khata Bhai" all hit.
 */
import { phoneticKey } from './names.js'

const FIRST = new Set(['khata', 'khate', 'kate'].map((k) => phoneticKey(k)))
const SECOND = new Set(['bhai', 'bayi', 'bye', 'bai'].map((k) => phoneticKey(k)))
/**
 * How speech recognisers mishear "khata" ("Hata bhai", "ata bhai", "Khadha bhai"). These are also
 * everyday words ("hata do" = remove it, "aata" = flour), so they count only while asleep (never
 * stripped from what an awake app is told), only as the first word of the utterance and only
 * before "bhai" itself: "isko hata bhai" or "aata hai" never wake. "aata" counts only to confirm
 * the phone's own detector: on its own, "aata bhai, 300 ka hua" is a kirana sentence.
 */
const WEAK_FIRST = new Set(['hata', 'khadha', 'gaata'].map((k) => phoneticKey(k)))
const WEAK_FIRST_PHONE = new Set([...WEAK_FIRST, phoneticKey('aata')])
const BHAI = phoneticKey('bhai')
const joined = (keys: Set<string>) => new Set([...keys].map((k) => k + 'a' + BHAI))
const WEAK_JOINED = joined(WEAK_FIRST)
const WEAK_JOINED_PHONE = joined(WEAK_FIRST_PHONE)
/** joined keys the phone's own detector may have heard (compared at edit distance 1) */
const KHATABHAI = phoneticKey('khatabhai')
const JOINED = [phoneticKey('khata') + phoneticKey('bhai'), KHATABHAI]

const SEP = /[\s,.।!?"'“”]/

/** Equal, or one letter inserted, dropped or changed. */
function lev1(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1)
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1)
}

/** Where the wake word is in `text` (a span of words), or null. */
function find(text: string, fuzzy: boolean, weak: boolean): { start: number; end: number } | null {
  const weakFirst = fuzzy ? WEAK_FIRST_PHONE : WEAK_FIRST
  const weakJoined = fuzzy ? WEAK_JOINED_PHONE : WEAK_JOINED
  const toks = [...text.matchAll(/[^\s,.।!?"'“”]+/gu)].map((m) => ({ key: phoneticKey(m[0]), start: m.index!, end: m.index! + m[0].length }))
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].key === KHATABHAI) return { start: toks[i].start, end: toks[i].end }
    if (FIRST.has(toks[i].key) && toks[i + 1] && SECOND.has(toks[i + 1].key)) return { start: toks[i].start, end: toks[i + 1].end }
    if (weak && i === 0 && weakFirst.has(toks[0].key) && toks[1]?.key === BHAI) return { start: toks[0].start, end: toks[1].end }
    if (weak && i === 0 && weakJoined.has(toks[0].key)) return { start: toks[0].start, end: toks[0].end }
    if (fuzzy) {
      if (toks[i].key.length >= 4 && JOINED.some((j) => lev1(toks[i].key, j))) return { start: toks[i].start, end: toks[i].end }
      const next = toks[i + 1]
      if (next && JOINED.some((j) => lev1(toks[i].key + next.key, j))) return { start: toks[i].start, end: next.end }
    }
  }
  return null
}

/**
 * Is the wake word in `text`, and what is left of the text without it.
 *  - `weak`: the app is asleep, so the misheard forms ("Hata bhai") count too. Never set while
 *    awake: there "hata bhai" means "remove it" and must reach the dialogue whole.
 *  - `fuzzy`: the phone's detector already heard it, so a one-letter slip in the spelling (and
 *    "aata bhai") is accepted.
 */
export function spotWake(text: string, opts: { fuzzy?: boolean; weak?: boolean } = {}): { found: boolean; rest: string } {
  const at = find(text, !!opts.fuzzy, !!opts.weak)
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
  'saku', 'aitu', 'sakubidi', 'sakaayitu',
].map((k) => phoneticKey(k)))

/** The whole utterance is a "that's all" (bas / ho gaya / theek hai bas, in hi/kn/en spellings). */
export function isSleepWord(text: string): boolean {
  const key = phoneticKey(text)
  return key.length > 0 && SLEEP_KEYS.has(key)
}
