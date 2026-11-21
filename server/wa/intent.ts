/**
 * What a customer's WhatsApp reply asks for. Deterministic on purpose: digits, button payloads and
 * a short word list per language. Anything else gets the menu again; no model guesses at money.
 */
export type WaIntent = 'pay' | 'balance' | 'dispute' | 'stop' | 'other'

const STOP = ['stop', 'unsubscribe', 'band', 'bandh', 'बंद', 'ನಿಲ್ಲಿಸಿ', 'நிறுத்து', 'ఆపండి', 'നിർത്തൂ', 'বন্ধ', 'બંધ', 'ਬੰਦ']
const PAY = ['pay', 'pay now', 'payment', 'paisa', 'paise', 'पैसे', 'भुगतान', 'ಪಾವತಿ', 'செலுத்து', 'చెల్లించు', 'അടയ്ക്കുക', 'पैसे भरा', 'টাকা দিন', 'ચૂકવો', 'ਭੁਗਤਾਨ']
const BALANCE = ['balance', 'hisab', 'hisaab', 'baki', 'baaki', 'हिसाब', 'बाकी', 'ಲೆಕ್ಕ', 'ಬಾಕಿ', 'கணக்கு', 'பாக்கி', 'లెక్క', 'బాకీ', 'കണക്ക്', 'ബാക്കി', 'हिशोब', 'হিসাব', 'বাকি', 'હિસાબ', 'બાકી', 'ਹਿਸਾਬ', 'ਬਾਕੀ']
const DISPUTE = ['wrong', 'not mine', 'galat', 'गलत', 'ग़लत', 'ತಪ್ಪು', 'தவறு', 'తప్పు', 'തെറ്റ്', 'चुकीचा', 'ভুল', 'ખોટો', 'ખોટું', 'ਗਲਤ']

const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/[.!?,।"'“”*_~]/g, ' ').replace(/\s+/g, ' ').trim()

/** `payload` is a quick-reply button's id when the customer tapped one (WABA mode). */
export function waIntent(text: string | undefined, payload?: string): WaIntent {
  const p = (payload ?? '').toUpperCase()
  if (p === 'PAY') return 'pay'
  if (p === 'BALANCE') return 'balance'
  if (p === 'DISPUTE') return 'dispute'
  if (p === 'STOP') return 'stop'
  const t = norm(text ?? '')
  if (!t) return 'other'
  if (t === '1') return 'pay'
  if (t === '2') return 'balance'
  if (t === '3') return 'dispute'
  const has = (words: string[]) => words.some((w) => t === w || t.startsWith(`${w} `) || t.endsWith(` ${w}`) || t.includes(` ${w} `))
  // STOP first: "band karo" must never be read as anything else
  if (has(STOP)) return 'stop'
  if (has(DISPUTE)) return 'dispute'
  if (has(PAY)) return 'pay'
  if (has(BALANCE)) return 'balance'
  return 'other'
}
