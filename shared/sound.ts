/**
 * English words written in an Indian script, for the parser's vocabularies.
 *
 * Shopkeepers mix English into every language, and Prisma writes each stream in its own script:
 * the Hindi stream writes "two hundred credit" as "टू हंड्रेड क्रेडिट", the Kannada one "300 paid" as
 * "300 ಪೇಡ್". Those words are matched to the English vocabulary by sound (names.ts phonetic key).
 *
 * Sound-alikes between two Indian languages are NOT matched: on recorded turns they turned
 * "ಖಾತಾ" (khata) into "काट" (undo) and "अरे" into "ಅರೆ" (half). Every sound match is counted in
 * `crossScript.hits`, and the parser reads such a line back before writing it.
 */
import { phoneticKey } from './names.js'

/** How English words that Indian scripts write by sound are pronounced (for their sound key). */
const EN_SOUND: Record<string, string> = {
  credit: 'kredit', paid: 'ped', pay: 'pe', payment: 'pement', clear: 'kliyar', cleared: 'kliyard', settle: 'setal',
  rupees: 'rupij', rupee: 'rupi', rs: 'rupij', total: 'total', balance: 'balens', cash: 'kesh', okay: 'oke', ok: 'oke',
  yes: 'yes', write: 'rait', note: 'not', account: 'akaunt', name: 'nem', change: 'chenj', wrong: 'rong', cancel: 'kensal',
  one: 'van', two: 'tu', three: 'thri', four: 'for', five: 'faiv', six: 'siks', seven: 'seven', eight: 'et', nine: 'nain',
  ten: 'ten', eleven: 'ileven', twelve: 'twelv', thirteen: 'thartin', fourteen: 'fortin', fifteen: 'fiftin',
  sixteen: 'sikstin', seventeen: 'seventin', eighteen: 'etin', nineteen: 'naintin', twenty: 'tventi', thirty: 'tharti',
  forty: 'forti', fifty: 'fifti', sixty: 'siksti', seventy: 'seventi', eighty: 'eti', ninety: 'nainti',
  hundred: 'handred', thousand: 'thaujend', lakh: 'lakh', half: 'haf',
}

const BLOCKS = [0x0900, 0x0980, 0x0a00, 0x0a80, 0x0b00, 0x0b80, 0x0c00, 0x0c80, 0x0d00]

/** -1 for Latin (or anything else), otherwise the index of the Brahmic block. */
export function scriptOf(w: string): number {
  for (const ch of w) {
    const cp = ch.codePointAt(0)!
    const i = BLOCKS.findIndex((b) => cp >= b && cp < b + 0x80)
    if (i >= 0) return i
  }
  return -1
}

/** Sound key of a word in any script (English words by how they are said). */
export function soundKey(w: string): string {
  return phoneticKey(EN_SOUND[w.toLowerCase()] ?? w)
}

/** Cross-script sound matches since the last reset (the parser resets it per sentence). */
export const crossScript = { hits: 0 }

/**
 * Index of words by sound. A word written in an Indian script matches an English vocabulary word
 * that sounds the same ("क्रेडिट" = credit, "टू हंड्रेड" = two hundred). Nothing else matches by sound.
 */
export class SoundIndex<V> {
  private keys = new Map<string, { script: number; en: boolean; v: V }[]>()
  add(word: string, v: V) {
    if (/^\d/.test(word)) return
    const k = soundKey(word)
    if (k.length < 2) return
    const list = this.keys.get(k) ?? []
    list.push({ script: scriptOf(word), en: word.toLowerCase() in EN_SOUND, v })
    this.keys.set(k, list)
  }
  /** A value whose word sounds like `t` but is written in another script (counted as a cross-script hit). */
  find(t: string): V | undefined {
    if (/^\d/.test(t)) return undefined
    const k = soundKey(t)
    if (k.length < 2) return undefined
    const s = scriptOf(t)
    // only an English word written in an Indian script ("क्रेडिट", "ಪೇಡ್", "टू"): sound-alikes between two
    // Indian languages proved unsafe ("ಖಾತಾ" khata ~ "काट" cut, "अरे" hey ~ "ಅರೆ" half)
    const hit = this.keys.get(k)?.find((x) => x.en && s >= 0)
    if (hit) crossScript.hits++
    return hit?.v
  }
}

/** A word set that also matches the same word written in another script (see SoundIndex). */
export class SoundSet extends Set<string> {
  private sound = new SoundIndex<true>()
  addWord(w: string) {
    super.add(w)
    this.sound.add(w, true)
    return this
  }
  override has(t: string): boolean {
    return super.has(t) || (this.sound?.find(t) ?? false)
  }
}
