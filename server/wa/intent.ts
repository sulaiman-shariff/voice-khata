/**
 * What a customer's WhatsApp reply asks for. Deterministic on purpose: digits, button payloads and
 * a short word list per language. Anything else gets the menu again; no model guesses at money.
 */
import { parseAmounts } from '../../shared/numbers.js'

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

// ------------------------------------------------------------------ "kal de dunga": a promise to pay
/** "I will pay / give / send" in the languages the shops use (romanised Hindi first) */
const WILL_PAY = [
  'dunga', 'dungi', 'dunge', 'denge', 'de dunga', 'de dungi', 'bhej dunga', 'bhej dungi', 'kar dunga', 'kar dungi', 'chuka dunga',
  'will pay', 'will give', 'will send', 'i ll pay', 'pay you', 'will clear',
  'दूंगा', 'दूँगा', 'दूंगी', 'दूँगी', 'देंगे', 'भेज दूंगा', 'चुका दूंगा', 'कर दूंगा',
  'ಕೊಡುತ್ತೇನೆ', 'ಕೊಡ್ತೀನಿ', 'ಕಳುಹಿಸುತ್ತೇನೆ', 'தருகிறேன்', 'தரேன்', 'கொடுக்கிறேன்', 'ఇస్తాను', 'ఇస్తా', 'పంపిస్తా',
  'തരാം', 'തരും', 'देतो', 'देते', 'देईन', 'दिईन', 'দেব', 'দিয়ে দেব', 'দেবো', 'આપીશ', 'આપી દઈશ', 'ਦੇ ਦਿਆਂਗਾ', 'ਦੇਵਾਂਗਾ', 'ਦੇ ਦੇਵਾਂਗਾ',
]
const DAY_WORDS: [string[], number][] = [
  [['aaj', 'today', 'आज', 'ಇವತ್ತು', 'ಇಂದು', 'இன்று', 'இன்னைக்கு', 'ఈరోజు', 'ഇന്ന്', 'আজ', 'આજે', 'ਅੱਜ'], 0],
  [['kal', 'tomorrow', 'कल', 'ನಾಳೆ', 'நாளை', 'நாளைக்கு', 'రేపు', 'നാളെ', 'उद्या', 'কাল', 'আগামীকাল', 'કાલે', 'આવતીકાલે', 'ਕੱਲ੍ਹ', 'ਕੱਲ'], 1],
  [['parso', 'parson', 'परसों', 'परसो', 'পরশু', 'ਪਰਸੋਂ', 'day after tomorrow'], 2],
  [['agle hafte', 'next week', 'अगले हफ्ते', 'अगले हफ़्ते'], 7],
]
/** Monday = 1 ... Sunday = 0, as Date.getUTCDay() */
const WEEKDAYS: [string[], number][] = [
  [['monday', 'somvar', 'somvaar', 'सोमवार'], 1], [['tuesday', 'mangalvar', 'mangalvaar', 'मंगलवार'], 2],
  [['wednesday', 'budhvar', 'budhvaar', 'बुधवार'], 3], [['thursday', 'guruvar', 'guruvaar', 'गुरुवार'], 4],
  [['friday', 'shukravar', 'shukravaar', 'शुक्रवार'], 5], [['saturday', 'shanivar', 'shanivaar', 'शनिवार'], 6],
  [['sunday', 'ravivar', 'ravivaar', 'रविवार', 'itvaar', 'इतवार'], 0],
]

export interface WaPromise {
  /** days from today (India): 0 today, 1 tomorrow */
  dayOffset: number
  /** the one amount said, if any */
  paise?: number
}

/**
 * A customer's reply that promises a payment on a day: "kal de dunga", "somvaar ko 500 bhej dunga",
 * "will pay tomorrow". Needs both a will-pay word and a day; anything else is not a promise.
 * `todayDow`: today's weekday in India (0 Sunday).
 */
export function waPromise(text: string | undefined, todayDow: number): WaPromise | null {
  const t = ` ${norm(text ?? '')} `
  if (t.trim().length < 3) return null
  const has = (w: string) => t.includes(` ${w} `)
  if (!WILL_PAY.some(has)) return null
  let dayOffset: number | null = null
  for (const [words, off] of DAY_WORDS) if (words.some(has)) { dayOffset = off; break }
  if (dayOffset === null) {
    for (const [words, dow] of WEEKDAYS) if (words.some(has)) { dayOffset = ((dow - todayDow + 7) % 7) || 7; break }
  }
  if (dayOffset === null) return null
  const amounts = [...new Set(parseAmounts(text ?? '').map((a) => a.value).filter((v) => v > 0))]
  return { dayOffset, ...(amounts.length === 1 ? { paise: Math.round(amounts[0] * 100) } : {}) }
}
