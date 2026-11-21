/**
 * Labels for the feature screens (counter QR, collect queue, galla, today card, plans, statement).
 * Kept apart from strings.ts so these screens can be built while that file is being reworked; the
 * same rule applies: deep for hi/en/kn/ta/te, every other language falls back to Hindi.
 */
import type { Lang } from '../../shared/replies.js'

const hi = {
  loc: 'hi-IN',
  today: 'आज', yesterday: 'बीता कल', tomorrow: 'आने वाला कल', days: 'दिन',
  // QR
  qrTitle: 'QR से भुगतान', scanCamera: 'कैमरे से स्कैन करें', scanUpi: 'किसी भी UPI ऐप से स्कैन करें', making: 'QR बन रहा है…',
  closesIn: 'बंद होगा', expired: 'QR का समय खत्म', makeAgain: 'नया QR बनाएँ', paidCash: 'नकद मिला', paidManual: 'पैसे मिल गए? ✓',
  received: 'पैसे मिल गए!', autoBooks: 'पैसे आते ही खाते में अपने-आप जुड़ेगा', manualNote: 'ऑनलाइन QR नहीं बना — पैसे आने पर खुद दबाएँ',
  noUpi: 'UPI ID नहीं जुड़ी — ☰ → दुकान की जानकारी में जोड़ें', amountFor: 'से लेना है',
  // collect
  collectTitle: 'आज किससे लेना है', collectNone: 'आज किसी से कुछ लेना नहीं', collectNoneHint: 'कोई वादा, तारीख़ या पुराना बाकी नहीं',
  remindAll: 'सबको याद दिलाओ', remindAllNote: 'सिर्फ़ उन्हें जिन्होंने याद-दिहानी के लिए हाँ कहा है', toCollect: 'कुल लेना',
  rDue: 'तारीख़ आ गई', rPromise: 'आज का वादा', rOld: '30+ दिन', sent: 'भेजा', delivered: 'पहुँचा', paid: 'मिल गया',
  // cashbook
  cashIn: 'आया', cashOut: 'गया', net: 'बचा', bank: 'बैंक', galla: 'गल्ला', fromKhata: 'खाते से', addCash: 'गल्ले में लिखें',
  cashEmpty: 'आज गल्ले में कुछ नहीं', cashEmptyHint: 'बोलिए: “बिजली 800” या “गल्ले में 2000 डाले”',
  cat: { stock: 'माल', bills: 'बिल', rent: 'किराया', wages: 'तनख़्वाह', personal: 'घर खर्च', other: 'अन्य' },
  // today card
  todaySummary: 'आज का हिसाब', creditGiven: 'उधार दिया', collected: 'जमा हुआ', newCustomers: 'नए ग्राहक', last7: 'पिछले 7 दिन',
  creditWord: 'उधार', paymentWord: 'जमा',
  // plan
  plan: 'किश्तें', parts: 'किश्त', every: 'हर', paidOf: 'जमा', of: 'में से', nextPart: 'अगली किश्त', behind: 'पीछे', planDone: 'किश्तें पूरी 🎉',
  cancelPlan: 'किश्तें बंद करें', cancelPlanQ: 'किश्तें बंद करें?', cancelPlanBody: 'बाकी वैसा ही रहेगा, बस किश्तों की याद-दिहानी रुकेगी।', keep: 'रहने दें',
  // ageing
  overdue: 'तारीख़ निकल गई',
  // promise suggestion
  promiseQ: 'वादा जोड़ें?', add: 'जोड़ें', notNow: 'नहीं', onWhatsApp: 'WhatsApp पर',
  // statement
  statement: 'हिसाब की फ़ोटो', statementFor: 'हिसाब', opening: 'पिछला बाकी', totalDue: 'कुल बाकी', advance: 'एडवांस', settled: 'हिसाब साफ़',
  colDate: 'तारीख़', colDetail: 'विवरण', colAmount: 'रकम', colBalance: 'बाकी', scanToPay: 'स्कैन करके भुगतान करें', madeWith: 'खाताभाई से बना',
  statementFailed: 'फ़ोटो नहीं बनी', statementSaved: 'फ़ोटो डाउनलोड हुई — WhatsApp में जोड़ें',
}
export type FeatureStrings = typeof hi

const en: FeatureStrings = {
  loc: 'en-IN',
  today: 'Today', yesterday: 'Yesterday', tomorrow: 'Tomorrow', days: 'days',
  qrTitle: 'Pay by QR', scanCamera: 'Scan with the camera', scanUpi: 'Scan with any UPI app', making: 'Making the QR…',
  closesIn: 'Closes in', expired: 'This QR has expired', makeAgain: 'Make a new QR', paidCash: 'Paid in cash', paidManual: 'Paid? ✓',
  received: 'Payment received!', autoBooks: 'It goes into the khata by itself when paid', manualNote: "Couldn't make an online QR — tap when the money arrives",
  noUpi: 'No UPI ID yet — add it in ☰ → Shop profile', amountFor: 'to collect from',
  collectTitle: 'Collect today', collectNone: 'Nothing to collect today', collectNoneHint: 'No promises, due dates or old dues',
  remindAll: 'Remind everyone', remindAllNote: 'Only customers who agreed to reminders', toCollect: 'To collect',
  rDue: 'Due', rPromise: 'Promised today', rOld: '30+ days', sent: 'Sent', delivered: 'Delivered', paid: 'Paid',
  cashIn: 'In', cashOut: 'Out', net: 'Net', bank: 'Bank', galla: 'Cash in hand', fromKhata: 'from khata', addCash: 'Add to cashbook',
  cashEmpty: 'Nothing in the cashbook today', cashEmptyHint: 'Say: “electricity 800” or “put 2000 in the galla”',
  cat: { stock: 'Stock', bills: 'Bills', rent: 'Rent', wages: 'Wages', personal: 'Personal', other: 'Other' },
  todaySummary: "Today's summary", creditGiven: 'Credit given', collected: 'Collected', newCustomers: 'New customers', last7: 'Last 7 days',
  creditWord: 'Credit', paymentWord: 'Paid',
  plan: 'Instalments', parts: 'parts', every: 'every', paidOf: 'paid', of: 'of', nextPart: 'Next instalment', behind: 'behind', planDone: 'Plan complete 🎉',
  cancelPlan: 'Cancel plan', cancelPlanQ: 'Cancel the plan?', cancelPlanBody: 'The balance stays; only the instalment reminders stop.', keep: 'Keep',
  overdue: 'Overdue',
  promiseQ: 'add the promise?', add: 'Add', notNow: 'No', onWhatsApp: 'on WhatsApp',
  statement: 'Statement image', statementFor: 'Statement', opening: 'Earlier balance', totalDue: 'Total due', advance: 'Advance', settled: 'All settled',
  colDate: 'Date', colDetail: 'Details', colAmount: 'Amount', colBalance: 'Balance', scanToPay: 'Scan to pay', madeWith: 'Made with KhataBhai',
  statementFailed: "Couldn't make the image", statementSaved: 'Image downloaded — attach it in WhatsApp',
}

/** Partial overrides on top of Hindi for the other deep languages (the rest reads in Hindi). */
const kn: Partial<FeatureStrings> = {
  loc: 'kn-IN', today: 'ಇಂದು', yesterday: 'ನಿನ್ನೆ', tomorrow: 'ನಾಳೆ', days: 'ದಿನ',
  qrTitle: 'QR ಪಾವತಿ', scanCamera: 'ಕ್ಯಾಮೆರಾದಿಂದ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ', scanUpi: 'ಯಾವುದೇ UPI ಆ್ಯಪ್‌ನಿಂದ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ', paidCash: 'ನಗದು ಸಿಕ್ಕಿತು', received: 'ಹಣ ಸಿಕ್ಕಿತು!',
  collectTitle: 'ಇಂದು ಯಾರಿಂದ ಪಡೆಯಬೇಕು', remindAll: 'ಎಲ್ಲರಿಗೂ ನೆನಪಿಸಿ', todaySummary: 'ಇಂದಿನ ಲೆಕ್ಕ', creditGiven: 'ಸಾಲ ಕೊಟ್ಟಿದ್ದು', collected: 'ಜಮಾ ಆಯಿತು',
  creditWord: 'ಸಾಲ', paymentWord: 'ಜಮಾ', galla: 'ಗಲ್ಲಾ', overdue: 'ದಿನಾಂಕ ಮೀರಿದೆ', add: 'ಸೇರಿಸಿ', notNow: 'ಬೇಡ',
}
const ta: Partial<FeatureStrings> = {
  loc: 'ta-IN', today: 'இன்று', yesterday: 'நேற்று', tomorrow: 'நாளை', days: 'நாள்',
  qrTitle: 'QR கட்டணம்', scanCamera: 'கேமராவில் ஸ்கேன் செய்யுங்கள்', scanUpi: 'எந்த UPI ஆப்பிலும் ஸ்கேன் செய்யுங்கள்', paidCash: 'ரொக்கம் கிடைத்தது', received: 'பணம் வந்தது!',
  collectTitle: 'இன்று யாரிடம் வாங்க வேண்டும்', remindAll: 'எல்லோருக்கும் நினைவூட்டு', todaySummary: 'இன்றைய கணக்கு', creditGiven: 'கொடுத்த கடன்', collected: 'வரவு',
  creditWord: 'கடன்', paymentWord: 'வரவு', galla: 'கல்லா', overdue: 'தேதி கடந்தது', add: 'சேர்', notNow: 'வேண்டாம்',
}
const te: Partial<FeatureStrings> = {
  loc: 'te-IN', today: 'ఈరోజు', yesterday: 'నిన్న', tomorrow: 'రేపు', days: 'రోజులు',
  qrTitle: 'QR చెల్లింపు', scanCamera: 'కెమెరాతో స్కాన్ చేయండి', scanUpi: 'ఏ UPI యాప్‌తోనైనా స్కాన్ చేయండి', paidCash: 'నగదు వచ్చింది', received: 'డబ్బు వచ్చింది!',
  collectTitle: 'ఈరోజు ఎవరి నుండి తీసుకోవాలి', remindAll: 'అందరికీ గుర్తు చేయి', todaySummary: 'ఈరోజు లెక్క', creditGiven: 'ఇచ్చిన అప్పు', collected: 'జమ అయింది',
  creditWord: 'అప్పు', paymentWord: 'జమ', galla: 'గల్లా', overdue: 'గడువు దాటింది', add: 'చేర్చు', notNow: 'వద్దు',
}

const T: Record<string, FeatureStrings> = { hi, en, kn: { ...hi, ...kn }, ta: { ...hi, ...ta }, te: { ...hi, ...te } }

/** Feature-screen labels for a language (Hindi when the language has none of its own). */
export const fx = (l: Lang | null | undefined): FeatureStrings => (l && T[l]) || hi

/** "Today" / "Tomorrow" / "Yesterday" / "Mon, 24 Nov" for a YYYY-MM-DD day. */
export function dayWord(day: string, f: FeatureStrings, now = new Date()): string {
  const d = new Date(`${day}T00:00:00`)
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const n = Math.round((d.getTime() - t0.getTime()) / 86_400_000)
  if (n === 0) return f.today
  if (n === 1) return f.tomorrow
  if (n === -1) return f.yesterday
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString(f.loc, { weekday: 'short', day: 'numeric', month: 'short' }) : day
}
