/**
 * Importing an old paper khata: "name amount" lines, typed or read aloud.
 *
 *   "Ramesh 500"                       -> Ramesh 500 credit (an opening balance he owes)
 *   "Suresh - ₹1,200 jama"             -> Suresh 1200 payment (an advance the shop holds)
 *   "Ramesh paanch sau Suresh teen sau" -> two rows (read aloud, number words)
 *   "500 Geeta"                        -> Geeta 500 credit
 *
 * Rows are only proposals: the app shows them for review before anything is written.
 */
import type { Direction } from './ledger.js'
import { parseAmounts, tokenize } from './numbers.js'

export interface ImportRow {
  name: string
  /** rupees */
  amount: number
  direction: Direction
}

/** Words that say the customer paid / the shop holds their money (default is credit: they owe). */
const PAID = new Set(['jama', 'जमा', 'paid', 'payment', 'advance', 'adv', 'अग्रिम', 'ಜಮಾ', 'வரவு', 'జమ', 'ജമ', 'জমা', 'જમા', 'ਜਮ੍ਹਾ', 'cr'])
/** Words that are neither name nor amount. */
const SKIP = new Set([
  'rs', 'inr', '₹', 'rupees', 'rupee', 'rupaye', 'rupay', 'रुपये', 'रुपए', 'रुपया', 'ರೂಪಾಯಿ', 'ರೂ', 'ரூபாய்', 'ரூ', 'రూపాయలు', 'రూ', 'രൂപ', 'টাকা', 'રૂપિયા', 'ਰੁਪਏ',
  'ka', 'ki', 'ke', 'का', 'की', 'के', 'ne', 'ko', 'ने', 'को', 'aur', 'और', 'and', 'phir', 'फिर', 'next', 'agla', 'अगला',
  'udhaar', 'udhar', 'उधार', 'baaki', 'baki', 'बाकी', 'credit', 'dr', 'due', 'dues', 'owes', 'ಸಾಲ', 'ಬಾಕಿ', 'கடன்', 'பாக்கி', 'అప్పు', 'బాకీ', 'കടം', 'বাকি', 'ઉધાર', 'ਉਧਾਰ',
  'hai', 'है', 'h', 'tha', 'था', 'likho', 'लिखो', 'naam', 'नाम', 'name', 'amount', 'total', 'kul', 'कुल',
  // page furniture in a book: "page 2", "date 12", "sr no 4"
  'page', 'pg', 'पेज', 'पृष्ठ', 'date', 'tarikh', 'तारीख', 'sr', 'sno', 'no', 'serial', 'kram', 'क्रम',
])

const title = (w: string) => (/^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w)

export function parseImport(text: string): ImportRow[] {
  const rows: ImportRow[] = []
  for (const line of text.split(/\n+/)) {
    const toks = tokenize(line)
    if (!toks.length) continue
    const spans = parseAmounts(line).filter((s) => s.value > 0)
    let from = 0
    spans.forEach((sp, i) => {
      const nextStart = spans[i + 1]?.start ?? toks.length
      // a paid word right after the amount belongs to this row ("Suresh 1200 jama Geeta 300")
      let end = sp.end
      let direction: Direction = 'credit'
      while (end < nextStart && (PAID.has(toks[end]) || SKIP.has(toks[end]))) {
        if (PAID.has(toks[end])) direction = 'payment'
        end++
      }
      let name = toks.slice(from, sp.start).filter((w) => !SKIP.has(w) && !PAID.has(w))
      if (toks.slice(from, sp.start).some((w) => PAID.has(w))) direction = 'payment'
      // "500 Geeta": the amount came first, so the name follows it
      if (!name.length && spans.length === 1) name = toks.slice(end).filter((w) => !SKIP.has(w) && !PAID.has(w))
      from = end
      if (!name.length) return
      rows.push({ name: name.slice(0, 4).map(title).join(' '), amount: sp.value, direction })
    })
  }
  return rows
}
