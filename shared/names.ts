/**
 * Cross-script name matching. The same customer arrives as "Ramesh", "रमेश", "ರಮೇಶ್", "ரமேஷ்"
 * depending on which language the STT heard. We transliterate every Brahmic script to a rough
 * Latin form, reduce it to a phonetic key, and compare keys.
 *
 * Trick: the Unicode Brahmic blocks (Devanagari 0900, Bengali 0980, Gurmukhi 0A00, Gujarati 0A80,
 * Odia 0B00, Tamil 0B80, Telugu 0C00, Kannada 0C80, Malayalam 0D00) share one layout, so a
 * character's offset inside its block maps it to the Devanagari equivalent.
 */

const BLOCKS = [0x0900, 0x0980, 0x0a00, 0x0a80, 0x0b00, 0x0b80, 0x0c00, 0x0c80, 0x0d00]

// Devanagari offset -> Latin. Consonants carry an inherent 'a' that a matra or virama replaces.
const CONS: Record<number, string> = {
  0x15: 'k', 0x16: 'kh', 0x17: 'g', 0x18: 'gh', 0x19: 'n', 0x1a: 'ch', 0x1b: 'chh', 0x1c: 'j', 0x1d: 'jh',
  0x1e: 'n', 0x1f: 't', 0x20: 'th', 0x21: 'd', 0x22: 'dh', 0x23: 'n', 0x24: 't', 0x25: 'th', 0x26: 'd',
  0x27: 'dh', 0x28: 'n', 0x29: 'n', 0x2a: 'p', 0x2b: 'ph', 0x2c: 'b', 0x2d: 'bh', 0x2e: 'm', 0x2f: 'y',
  0x30: 'r', 0x31: 'r', 0x32: 'l', 0x33: 'l', 0x34: 'zh', 0x35: 'v', 0x36: 'sh', 0x37: 'sh', 0x38: 's',
  0x39: 'h', 0x58: 'q', 0x59: 'kh', 0x5a: 'g', 0x5b: 'z', 0x5c: 'd', 0x5d: 'rh', 0x5e: 'f', 0x5f: 'y',
}
const VOWEL: Record<number, string> = {
  0x05: 'a', 0x06: 'aa', 0x07: 'i', 0x08: 'ee', 0x09: 'u', 0x0a: 'oo', 0x0b: 'ri', 0x0e: 'e', 0x0f: 'e',
  0x10: 'ai', 0x12: 'o', 0x13: 'o', 0x14: 'au',
}
const MATRA: Record<number, string> = {
  0x3e: 'aa', 0x3f: 'i', 0x40: 'ee', 0x41: 'u', 0x42: 'oo', 0x43: 'ri', 0x46: 'e', 0x47: 'e', 0x48: 'ai',
  0x4a: 'o', 0x4b: 'o', 0x4c: 'au', 0x57: 'au',
}
const VIRAMA = 0x4d
const NASAL = new Set([0x01, 0x02]) // chandrabindu, anusvara
const NUKTA = 0x3c

/** Transliterate any Brahmic-script text to rough lowercase Latin; Latin passes through. */
export function translit(s: string): string {
  let out = ''
  let pendingA = false
  let schwaScript = false // Hindi/Bengali/Gurmukhi/Gujarati drop a word-final inherent 'a'
  for (const ch of s.normalize('NFC')) {
    const cp = ch.codePointAt(0)!
    const base = BLOCKS.find((b) => cp >= b && cp < b + 0x80)
    if (base === undefined) {
      if (pendingA && !schwaScript) out += 'a'
      pendingA = false
      if (cp === 0x200c || cp === 0x200d) continue
      out += ch.toLowerCase()
      continue
    }
    const off = cp - base
    schwaScript = base <= 0x0a80
    if (CONS[off] !== undefined) {
      if (pendingA) out += 'a'
      out += CONS[off]
      pendingA = true
    } else if (MATRA[off] !== undefined) {
      out += MATRA[off]
      pendingA = false
    } else if (off === VIRAMA) {
      pendingA = false
    } else if (VOWEL[off] !== undefined) {
      if (pendingA) out += 'a'
      out += VOWEL[off]
      pendingA = false
    } else if (NASAL.has(off)) {
      if (pendingA) out += 'a'
      out += 'n'
      pendingA = false
    } else if (off === NUKTA) {
      continue
    } else {
      if (pendingA) out += 'a'
      pendingA = false
    }
  }
  if (pendingA && !schwaScript) out += 'a'
  return out
}

/** Phonetic key: collapses spelling variation between scripts and romanisations. */
export function phoneticKey(name: string): string {
  let s = translit(name).replace(/[^a-z]/g, '')
  s = s
    .replace(/chh|ch|c/g, 'c')
    .replace(/sh|s|z/g, 's')
    .replace(/ph|f/g, 'p')
    .replace(/w|v/g, 'v')
    .replace(/q/g, 'k')
    .replace(/([kgcjtdpb])h/g, '$1')
    .replace(/aa|a/g, 'a')
    .replace(/ee|ii|i|y(?=[^aeiou]|$)/g, 'i')
    .replace(/oo|uu|u/g, 'u')
    .replace(/au|ou/g, 'o')
    .replace(/ai/g, 'e')
    .replace(/(.)\1+/g, '$1')
  // inherent-vowel noise at the end: "ramesha" ~ "ramesh", "lakshmi" ~ "lakshmee"
  s = s.replace(/a$/, '')
  return s
}

/** Jaro-Winkler similarity in [0, 1]. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1
  if (!a.length || !b.length) return 0
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1)
  const am = new Array(a.length).fill(false)
  const bm = new Array(b.length).fill(false)
  let m = 0
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (bm[j] || a[i] !== b[j]) continue
      am[i] = bm[j] = true
      m++
      break
    }
  }
  if (!m) return 0
  let t = 0
  let k = 0
  for (let i = 0; i < a.length; i++) {
    if (!am[i]) continue
    while (!bm[k]) k++
    if (a[i] !== b[k]) t++
    k++
  }
  const jaro = (m / a.length + m / b.length + (m - t / 2) / m) / 3
  let p = 0
  while (p < 4 && a[p] === b[p]) p++
  return jaro + p * 0.1 * (1 - jaro)
}

export interface NameCandidate {
  id: string
  names: string[] // display name + aliases ("Ramesh", "Ramesh doodhwale", "flat 302 wale")
}

export interface NameMatch {
  id: string
  score: number
  matched: string
}

/** Score every known customer against a heard name; best first. */
export function matchName(heard: string, people: NameCandidate[]): NameMatch[] {
  const hk = phoneticKey(heard)
  const hFirst = phoneticKey(heard.split(/\s+/)[0] ?? heard)
  if (!hk) return []
  const out: NameMatch[] = []
  for (const p of people) {
    let best = 0
    let matched = ''
    for (const n of p.names) {
      const nk = phoneticKey(n)
      const nFirst = phoneticKey(n.split(/\s+/)[0] ?? n)
      // full-name match, or the heard first name against their first name
      const sc = Math.max(jaroWinkler(hk, nk), hk === hFirst ? jaroWinkler(hFirst, nFirst) * 0.97 : 0)
      if (sc > best) {
        best = sc
        matched = n
      }
    }
    out.push({ id: p.id, score: best, matched })
  }
  return out.sort((a, b) => b.score - a.score)
}

/** Thresholds tuned on the name tests: >= SURE is the same person; between NEAR and SURE ask. */
export const NAME_SURE = 0.93
export const NAME_NEAR = 0.84
