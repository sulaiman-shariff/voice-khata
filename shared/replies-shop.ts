/**
 * What the agent says about the shop's day and its collection: the daily summary and morning
 * briefing, dues ageing and the collect-today list, instalment plans, the galla (cashbook),
 * supplier accounts, due dates, and customers who share a name (nicknames, sound-alikes).
 * Ten languages, the same rules as shared/replies.ts: amounts as digits with Indian grouping,
 * nothing that judges or pressures a customer (every template passes guardReply).
 */
import type { CashCategory } from './ledger.js'
import { formatINR } from './numbers.js'
import type { Lang } from './replies.js'

type Dir = 'credit' | 'payment'
const r = (rupees: number) => formatINR(rupees)

export interface DailySummaryInput {
  credit: number
  paid: number
  newCustomers: number
  /** the largest dues (customers only), rupees */
  top: { name: string; amt: number }[]
  /** names of customers who promised to pay today */
  promises: string[]
  /** galla, rupees; omitted when nothing moved */
  cashIn?: number
  cashOut?: number
}

export interface ShopReplies {
  /** "aaj ka hisaab": credit, collected, new customers, top dues, today's promises, galla */
  dailySummary: (d: DailySummaryInput) => string
  /** offered once on the first wake of a day */
  morningBriefing: (b: { promises: number; due: number; old: number; total: number }) => string
  /** dues older than `days` (ageing): how many, the total, the first few names */
  overdueList: (count: number, days: number, total: number, names: string[]) => string
  noOverdue: (days: number) => string
  /** the collect-today list is on screen */
  collectToday: (count: number, total: number, names: string[]) => string
  nothingToCollect: () => string
  /** read back before setting an instalment plan */
  planAsk: (name: string, total: number, parts: number, part: number, everyDays: number) => string
  planSet: (name: string, part: number, everyDays: number) => string
  planCancelAsk: (name: string) => string
  planCancelled: (name: string) => string
  noPlan: (name: string) => string
  /** galla rows */
  cashSaved: (amt: number, dir: 'in' | 'out', cat: CashCategory) => string
  cashAsk: (amt: number, dir: 'in' | 'out', cat: CashCategory) => string
  /** a supplier entry saved: `owed` > 0 is what the shop owes the supplier now */
  supplierSaved: (name: string, amt: number, dir: Dir, owed: number) => string
  supplierBalance: (name: string, owed: number) => string
  /** suppliers never get reminders, statements or a QR */
  noSupplierReminder: (name: string) => string
  /** appended to a save: the pay-by date (day of the month) */
  dueNoted: (dayOfMonth: number) => string
  /** WhatsApp instalment line, under the balance line; `amount` is formatted ("₹500") */
  instalmentLine: (amount: string) => string
  /** a second customer with this name was just opened: ask once how to tell them apart (skipping is fine) */
  nicknameAsk: (name: string) => string
  /** a name not in the ledger: offer to open their khata (a yes or a tap opens it) */
  notFoundOffer: (name: string) => string
  /** the nickname question was skipped: the automatic label stays */
  tagSkipped: (label: string) => string
  /** a nickname (tag) saved */
  tagSet: (name: string, tag: string) => string
  /** the heard name only sounds like a customer: that customer, or a new account with the same entry? */
  soundAlikeAsk: (known: string, heard: string, amt: number, dir: Dir) => string
  /** the cashbook category, spoken */
  category: (c: CashCategory) => string
}

const ord = (n: number) => {
  const t = n % 100
  return `${n}${t >= 11 && t <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`
}
const names = (xs: string[], and: string) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${and} ${xs[xs.length - 1]}`)
const every = (d: number, day: string, week: string, month: string, n: (x: number) => string) => (d === 1 ? day : d === 7 ? week : d === 30 ? month : n(d))

const CAT: Record<Lang, Record<CashCategory, string>> = {
  hi: { stock: 'माल', bills: 'बिल', rent: 'किराया', wages: 'मज़दूरी', personal: 'घर खर्च', other: 'दूसरा खर्च' },
  en: { stock: 'stock', bills: 'bills', rent: 'rent', wages: 'wages', personal: 'personal', other: 'other' },
  kn: { stock: 'ಸರಕು', bills: 'ಬಿಲ್', rent: 'ಬಾಡಿಗೆ', wages: 'ಕೂಲಿ', personal: 'ಮನೆ ಖರ್ಚು', other: 'ಇತರೆ' },
  ta: { stock: 'சரக்கு', bills: 'பில்', rent: 'வாடகை', wages: 'கூலி', personal: 'வீட்டுச் செலவு', other: 'மற்றவை' },
  te: { stock: 'సరుకు', bills: 'బిల్లు', rent: 'అద్దె', wages: 'కూలి', personal: 'ఇంటి ఖర్చు', other: 'ఇతర' },
  ml: { stock: 'സ്റ്റോക്ക്', bills: 'ബിൽ', rent: 'വാടക', wages: 'കൂലി', personal: 'വീട്ടുചെലവ്', other: 'മറ്റുള്ളവ' },
  mr: { stock: 'माल', bills: 'बिल', rent: 'भाडे', wages: 'मजुरी', personal: 'घरखर्च', other: 'इतर' },
  bn: { stock: 'মাল', bills: 'বিল', rent: 'ভাড়া', wages: 'মজুরি', personal: 'সংসার খরচ', other: 'অন্যান্য' },
  gu: { stock: 'માલ', bills: 'બિલ', rent: 'ભાડું', wages: 'મજૂરી', personal: 'ઘર ખર્ચ', other: 'અન્ય' },
  pa: { stock: 'ਮਾਲ', bills: 'ਬਿੱਲ', rent: 'ਕਿਰਾਇਆ', wages: 'ਮਜ਼ਦੂਰੀ', personal: 'ਘਰ ਖਰਚ', other: 'ਹੋਰ' },
}

const HI: ShopReplies = {
  tagSkipped: (l) => `ठीक है, अभी ${l} नाम से दिखेंगे।`,
  dailySummary: (d) => [
    `आज ${r(d.credit)} रुपये उधार गया, ${r(d.paid)} रुपये जमा आए।`,
    d.newCustomers ? `${d.newCustomers} नए ग्राहक।` : '',
    d.top.length ? `सबसे ज़्यादा बाकी: ${d.top.map((t) => `${t.name} ${r(t.amt)}`).join(', ')}।` : '',
    d.promises.length ? `आज ${names(d.promises, 'और')} ने देने का वादा किया है।` : '',
    d.cashIn || d.cashOut ? `गल्ला: ${r(d.cashIn ?? 0)} रुपये आए, ${r(d.cashOut ?? 0)} रुपये गए।` : '',
  ].filter(Boolean).join(' '),
  morningBriefing: (b) => [
    'सुप्रभात!',
    b.promises ? `आज ${b.promises} वादे हैं।` : '',
    b.due ? `${b.due} लोगों की तारीख आ गई है।` : '',
    b.old ? `${b.old} लोगों का हिसाब 30 दिन से पुराना है।` : '',
    `कुल ${r(b.total)} रुपये लेने हैं। सूची देखनी है?`,
  ].filter(Boolean).join(' '),
  overdueList: (n, d, t, ns) => `${n} लोगों का हिसाब ${d} दिन से पुराना है, कुल ${r(t)} रुपये${ns.length ? `: ${ns.join(', ')}` : ''}। सूची स्क्रीन पर है।`,
  noOverdue: (d) => `${d} दिन से पुराना कोई हिसाब नहीं है।`,
  collectToday: (n, t, ns) => `आज ${n} लोगों से ${r(t)} रुपये लेने हैं${ns.length ? `: ${ns.join(', ')}` : ''}। सूची स्क्रीन पर है।`,
  nothingToCollect: () => 'आज किसी से लेना बाकी नहीं है।',
  planAsk: (n, t, p, a, e) => `${n} के ${r(t)} रुपये, ${p} किस्तों में, ${every(e, 'हर दिन', 'हर हफ़्ते', 'हर महीने', (x) => `हर ${x} दिन`)} ${r(a)} रुपये। सही है?`,
  planSet: (n, a, e) => `ठीक है, ${n} की किस्त ${every(e, 'हर दिन', 'हर हफ़्ते', 'हर महीने', (x) => `हर ${x} दिन`)} ${r(a)} रुपये।`,
  planCancelAsk: (n) => `${n} की किस्त योजना बंद कर दूँ?`,
  planCancelled: (n) => `${n} की किस्त योजना बंद कर दी।`,
  noPlan: (n) => `${n} की कोई किस्त योजना नहीं है।`,
  cashSaved: (a, d, c) => (d === 'in' ? `गल्ले में ${r(a)} रुपये आए, ${CAT.hi[c]}।` : `गल्ले से ${r(a)} रुपये गए, ${CAT.hi[c]}।`),
  cashAsk: (a, d, c) => (d === 'in' ? `गल्ले में ${r(a)} रुपये आए, ${CAT.hi[c]}, सही है?` : `गल्ले से ${r(a)} रुपये, ${CAT.hi[c]}, सही है?`),
  supplierSaved: (n, a, d, o) => `${n}, ${r(a)} रुपये ${d === 'credit' ? 'का माल लिया' : 'दिए'}। ${o > 0 ? `अब ${n} को ${r(o)} रुपये देने हैं।` : o < 0 ? `${n} के पास आपके ${r(-o)} रुपये पहले से हैं।` : 'हिसाब बराबर।'}`,
  supplierBalance: (n, o) => (o > 0 ? `${n} को ${r(o)} रुपये देने हैं।` : o < 0 ? `${n} के पास आपके ${r(-o)} रुपये पहले से हैं।` : `${n} का हिसाब बराबर है।`),
  noSupplierReminder: (n) => `${n} सप्लायर हैं, उन्हें याद-दिहानी नहीं भेजी जाती।`,
  dueNoted: (d) => `${d} तारीख तक देने हैं।`,
  instalmentLine: (a) => `इस किस्त के लिए: *${a}*`,
  nicknameAsk: (n) => `एक ${n} पहले से हैं। इनको कैसे पहचानें, जैसे दूधवाला या गली 3?`,
  notFoundOffer: (n) => `${n} का खाता अभी नहीं है। नया खाता खोलूँ?`,
  tagSet: (n, t) => `ठीक है, ये ${t} वाले ${n} हैं।`,
  soundAlikeAsk: (k, h, a, d) => `${r(a)} रुपये ${d === 'credit' ? 'उधार' : 'जमा'}: ${k} या नए ग्राहक ${h}?`,
  category: (c) => CAT.hi[c],
}

const EN: ShopReplies = {
  tagSkipped: (l) => `Okay, they will show as ${l} for now.`,
  dailySummary: (d) => [
    `Today ${r(d.credit)} rupees went on credit and ${r(d.paid)} rupees came in.`,
    d.newCustomers ? `${d.newCustomers} new customer${d.newCustomers === 1 ? '' : 's'}.` : '',
    d.top.length ? `Largest balances: ${d.top.map((t) => `${t.name} ${r(t.amt)}`).join(', ')}.` : '',
    d.promises.length ? `${names(d.promises, 'and')} said they would pay today.` : '',
    d.cashIn || d.cashOut ? `Cash box: ${r(d.cashIn ?? 0)} rupees in, ${r(d.cashOut ?? 0)} rupees out.` : '',
  ].filter(Boolean).join(' '),
  morningBriefing: (b) => [
    'Good morning!',
    b.promises ? `${b.promises} promise${b.promises === 1 ? '' : 's'} for today.` : '',
    b.due ? `${b.due} pay-by date${b.due === 1 ? ' has' : 's have'} come.` : '',
    b.old ? `${b.old} balance${b.old === 1 ? ' is' : 's are'} older than 30 days.` : '',
    `${r(b.total)} rupees to collect in all. See the list?`,
  ].filter(Boolean).join(' '),
  overdueList: (n, d, t, ns) => `${n} balance${n === 1 ? ' is' : 's are'} older than ${d} days, ${r(t)} rupees in all${ns.length ? `: ${ns.join(', ')}` : ''}. The list is on screen.`,
  noOverdue: (d) => `No balance is older than ${d} days.`,
  collectToday: (n, t, ns) => `Collect ${r(t)} rupees from ${n} customer${n === 1 ? '' : 's'} today${ns.length ? `: ${ns.join(', ')}` : ''}. The list is on screen.`,
  nothingToCollect: () => 'Nothing to collect today.',
  planAsk: (n, t, p, a, e) => `${n}'s ${r(t)} rupees in ${p} parts, ${r(a)} rupees ${every(e, 'every day', 'every week', 'every month', (x) => `every ${x} days`)}. Correct?`,
  planSet: (n, a, e) => `Done: ${n} pays ${r(a)} rupees ${every(e, 'every day', 'every week', 'every month', (x) => `every ${x} days`)}.`,
  planCancelAsk: (n) => `End ${n}'s instalment plan?`,
  planCancelled: (n) => `Ended ${n}'s instalment plan.`,
  noPlan: (n) => `${n} has no instalment plan.`,
  cashSaved: (a, d, c) => (d === 'in' ? `${r(a)} rupees into the cash box, ${CAT.en[c]}.` : `${r(a)} rupees out of the cash box, ${CAT.en[c]}.`),
  cashAsk: (a, d, c) => `${r(a)} rupees ${d === 'in' ? 'into' : 'out of'} the cash box, ${CAT.en[c]}, correct?`,
  supplierSaved: (n, a, d, o) => `${n}, ${r(a)} rupees ${d === 'credit' ? 'of goods taken' : 'paid'}. ${o > 0 ? `You now owe ${n} ${r(o)} rupees.` : o < 0 ? `${n} holds ${r(-o)} rupees of yours.` : 'All square.'}`,
  supplierBalance: (n, o) => (o > 0 ? `You owe ${n} ${r(o)} rupees.` : o < 0 ? `${n} holds ${r(-o)} rupees of yours.` : `You and ${n} are all square.`),
  noSupplierReminder: (n) => `${n} is a supplier; suppliers get no reminders.`,
  dueNoted: (d) => `To be paid by the ${ord(d)}.`,
  instalmentLine: (a) => `This instalment: *${a}*`,
  nicknameAsk: (n) => `There is already a ${n}. How should I tell them apart, like milkman or lane 3?`,
  notFoundOffer: (n) => `There is no account for ${n} yet. Shall I open a new one?`,
  tagSet: (n, t) => `Okay, this is ${n}, ${t}.`,
  soundAlikeAsk: (k, h, a, d) => `${r(a)} rupees ${d === 'credit' ? 'on credit' : 'paid'}: ${k}, or a new customer ${h}?`,
  category: (c) => CAT.en[c],
}

const KN: ShopReplies = {
  tagSkipped: (l) => `ಸರಿ, ಸದ್ಯಕ್ಕೆ ${l} ಎಂದು ತೋರಿಸುತ್ತೇನೆ.`,
  dailySummary: (d) => [
    `ಇಂದು ${r(d.credit)} ರೂಪಾಯಿ ಸಾಲ ಹೋಯಿತು, ${r(d.paid)} ರೂಪಾಯಿ ಜಮಾ ಬಂತು.`,
    d.newCustomers ? `${d.newCustomers} ಹೊಸ ಗ್ರಾಹಕರು.` : '',
    d.top.length ? `ಹೆಚ್ಚು ಬಾಕಿ: ${d.top.map((t) => `${t.name} ${r(t.amt)}`).join(', ')}.` : '',
    d.promises.length ? `ಇಂದು ${names(d.promises, 'ಮತ್ತು')} ಕೊಡುತ್ತೇನೆ ಎಂದಿದ್ದಾರೆ.` : '',
    d.cashIn || d.cashOut ? `ಗಲ್ಲಾ: ${r(d.cashIn ?? 0)} ರೂಪಾಯಿ ಬಂತು, ${r(d.cashOut ?? 0)} ರೂಪಾಯಿ ಹೋಯಿತು.` : '',
  ].filter(Boolean).join(' '),
  morningBriefing: (b) => [
    'ಶುಭೋದಯ!',
    b.promises ? `ಇಂದು ${b.promises} ಮಾತುಕೊಟ್ಟ ಪಾವತಿಗಳಿವೆ.` : '',
    b.due ? `${b.due} ಜನರ ದಿನಾಂಕ ಬಂದಿದೆ.` : '',
    b.old ? `${b.old} ಜನರ ಬಾಕಿ 30 ದಿನಕ್ಕಿಂತ ಹಳೆಯದು.` : '',
    `ಒಟ್ಟು ${r(b.total)} ರೂಪಾಯಿ ಬರಬೇಕಿದೆ. ಪಟ್ಟಿ ನೋಡೋಣವಾ?`,
  ].filter(Boolean).join(' '),
  overdueList: (n, d, t, ns) => `${n} ಜನರ ಬಾಕಿ ${d} ದಿನಕ್ಕಿಂತ ಹಳೆಯದು, ಒಟ್ಟು ${r(t)} ರೂಪಾಯಿ${ns.length ? `: ${ns.join(', ')}` : ''}. ಪಟ್ಟಿ ಪರದೆಯ ಮೇಲಿದೆ.`,
  noOverdue: (d) => `${d} ದಿನಕ್ಕಿಂತ ಹಳೆಯ ಬಾಕಿ ಏನೂ ಇಲ್ಲ.`,
  collectToday: (n, t, ns) => `ಇಂದು ${n} ಜನರಿಂದ ${r(t)} ರೂಪಾಯಿ ಬರಬೇಕು${ns.length ? `: ${ns.join(', ')}` : ''}. ಪಟ್ಟಿ ಪರದೆಯ ಮೇಲಿದೆ.`,
  nothingToCollect: () => 'ಇಂದು ಯಾರಿಂದಲೂ ಬರಬೇಕಾದದ್ದಿಲ್ಲ.',
  planAsk: (n, t, p, a, e) => `${n} ಅವರ ${r(t)} ರೂಪಾಯಿ, ${p} ಕಂತುಗಳಲ್ಲಿ, ${every(e, 'ಪ್ರತಿದಿನ', 'ಪ್ರತಿ ವಾರ', 'ಪ್ರತಿ ತಿಂಗಳು', (x) => `ಪ್ರತಿ ${x} ದಿನಕ್ಕೆ`)} ${r(a)} ರೂಪಾಯಿ. ಸರಿನಾ?`,
  planSet: (n, a, e) => `ಸರಿ, ${n} ಅವರ ಕಂತು ${every(e, 'ಪ್ರತಿದಿನ', 'ಪ್ರತಿ ವಾರ', 'ಪ್ರತಿ ತಿಂಗಳು', (x) => `ಪ್ರತಿ ${x} ದಿನಕ್ಕೆ`)} ${r(a)} ರೂಪಾಯಿ.`,
  planCancelAsk: (n) => `${n} ಅವರ ಕಂತು ಯೋಜನೆ ನಿಲ್ಲಿಸಲಾ?`,
  planCancelled: (n) => `${n} ಅವರ ಕಂತು ಯೋಜನೆ ನಿಲ್ಲಿಸಿದೆ.`,
  noPlan: (n) => `${n} ಅವರಿಗೆ ಕಂತು ಯೋಜನೆ ಇಲ್ಲ.`,
  cashSaved: (a, d, c) => (d === 'in' ? `ಗಲ್ಲಾಕ್ಕೆ ${r(a)} ರೂಪಾಯಿ ಬಂತು, ${CAT.kn[c]}.` : `ಗಲ್ಲಾದಿಂದ ${r(a)} ರೂಪಾಯಿ ಹೋಯಿತು, ${CAT.kn[c]}.`),
  cashAsk: (a, d, c) => `${d === 'in' ? 'ಗಲ್ಲಾಕ್ಕೆ' : 'ಗಲ್ಲಾದಿಂದ'} ${r(a)} ರೂಪಾಯಿ, ${CAT.kn[c]}, ಸರಿನಾ?`,
  supplierSaved: (n, a, d, o) => `${n}, ${r(a)} ರೂಪಾಯಿ ${d === 'credit' ? 'ಸರಕು ತಗೊಂಡಿದ್ದು' : 'ಕೊಟ್ಟಿದ್ದು'}. ${o > 0 ? `ಈಗ ${n} ಅವರಿಗೆ ${r(o)} ರೂಪಾಯಿ ಕೊಡಬೇಕು.` : o < 0 ? `${n} ಅವರ ಬಳಿ ನಿಮ್ಮ ${r(-o)} ರೂಪಾಯಿ ಇದೆ.` : 'ಲೆಕ್ಕ ಸಮ.'}`,
  supplierBalance: (n, o) => (o > 0 ? `${n} ಅವರಿಗೆ ${r(o)} ರೂಪಾಯಿ ಕೊಡಬೇಕು.` : o < 0 ? `${n} ಅವರ ಬಳಿ ನಿಮ್ಮ ${r(-o)} ರೂಪಾಯಿ ಇದೆ.` : `${n} ಅವರ ಲೆಕ್ಕ ಸಮ.`),
  noSupplierReminder: (n) => `${n} ಸರಬರಾಜುದಾರರು, ಅವರಿಗೆ ನೆನಪಿನ ಸಂದೇಶ ಹೋಗುವುದಿಲ್ಲ.`,
  dueNoted: (d) => `${d} ನೇ ತಾರೀಖಿನೊಳಗೆ ಕೊಡಬೇಕು.`,
  instalmentLine: (a) => `ಈ ಕಂತಿಗೆ: *${a}*`,
  nicknameAsk: (n) => `ಈಗಾಗಲೇ ಒಬ್ಬ ${n} ಇದ್ದಾರೆ. ಇವರನ್ನು ಹೇಗೆ ಗುರುತಿಸಲಿ, ಹಾಲಿನವರು ಅಥವಾ ಗಲ್ಲಿ 3 ಹಾಗೆ?`,
  notFoundOffer: (n) => `${n} ಅವರ ಖಾತೆ ಇನ್ನೂ ಇಲ್ಲ. ಹೊಸ ಖಾತೆ ತೆರೆಯಲೇ?`,
  tagSet: (n, t) => `ಸರಿ, ಇವರು ${t} ${n}.`,
  soundAlikeAsk: (k, h, a, d) => `${r(a)} ರೂಪಾಯಿ ${d === 'credit' ? 'ಸಾಲ' : 'ಜಮಾ'}: ${k} ಅವರಾ, ಅಥವಾ ಹೊಸ ಗ್ರಾಹಕ ${h}?`,
  category: (c) => CAT.kn[c],
}

const TA: ShopReplies = {
  tagSkipped: (l) => `சரி, இப்போதைக்கு ${l} என்று காட்டுவேன்.`,
  dailySummary: (d) => [
    `இன்று ${r(d.credit)} ரூபாய் கடன் போனது, ${r(d.paid)} ரூபாய் வரவு வந்தது.`,
    d.newCustomers ? `${d.newCustomers} புதிய வாடிக்கையாளர்கள்.` : '',
    d.top.length ? `அதிக பாக்கி: ${d.top.map((t) => `${t.name} ${r(t.amt)}`).join(', ')}.` : '',
    d.promises.length ? `இன்று ${names(d.promises, 'மற்றும்')} தருவதாகச் சொல்லியிருக்கிறார்கள்.` : '',
    d.cashIn || d.cashOut ? `கல்லா: ${r(d.cashIn ?? 0)} ரூபாய் வந்தது, ${r(d.cashOut ?? 0)} ரூபாய் போனது.` : '',
  ].filter(Boolean).join(' '),
  morningBriefing: (b) => [
    'காலை வணக்கம்!',
    b.promises ? `இன்று ${b.promises} வாக்குறுதிகள் உள்ளன.` : '',
    b.due ? `${b.due} பேரின் தேதி வந்துவிட்டது.` : '',
    b.old ? `${b.old} பேரின் பாக்கி 30 நாளுக்கு மேல் பழையது.` : '',
    `மொத்தம் ${r(b.total)} ரூபாய் வர வேண்டும். பட்டியலைப் பார்க்கலாமா?`,
  ].filter(Boolean).join(' '),
  overdueList: (n, d, t, ns) => `${n} பேரின் பாக்கி ${d} நாளுக்கு மேல் பழையது, மொத்தம் ${r(t)} ரூபாய்${ns.length ? `: ${ns.join(', ')}` : ''}. பட்டியல் திரையில் உள்ளது.`,
  noOverdue: (d) => `${d} நாளுக்கு மேல் பழைய பாக்கி இல்லை.`,
  collectToday: (n, t, ns) => `இன்று ${n} பேரிடம் ${r(t)} ரூபாய் வர வேண்டும்${ns.length ? `: ${ns.join(', ')}` : ''}. பட்டியல் திரையில் உள்ளது.`,
  nothingToCollect: () => 'இன்று யாரிடமும் வர வேண்டியது இல்லை.',
  planAsk: (n, t, p, a, e) => `${n} அவர்களின் ${r(t)} ரூபாய், ${p} தவணைகளில், ${every(e, 'தினமும்', 'வாரம் ஒருமுறை', 'மாதம் ஒருமுறை', (x) => `${x} நாளுக்கு ஒருமுறை`)} ${r(a)} ரூபாய். சரியா?`,
  planSet: (n, a, e) => `சரி, ${n} அவர்களின் தவணை ${every(e, 'தினமும்', 'வாரம் ஒருமுறை', 'மாதம் ஒருமுறை', (x) => `${x} நாளுக்கு ஒருமுறை`)} ${r(a)} ரூபாய்.`,
  planCancelAsk: (n) => `${n} அவர்களின் தவணைத் திட்டத்தை நிறுத்தவா?`,
  planCancelled: (n) => `${n} அவர்களின் தவணைத் திட்டத்தை நிறுத்தினேன்.`,
  noPlan: (n) => `${n} அவர்களுக்குத் தவணைத் திட்டம் இல்லை.`,
  cashSaved: (a, d, c) => (d === 'in' ? `கல்லாவில் ${r(a)} ரூபாய் வந்தது, ${CAT.ta[c]}.` : `கல்லாவிலிருந்து ${r(a)} ரூபாய் போனது, ${CAT.ta[c]}.`),
  cashAsk: (a, d, c) => `${d === 'in' ? 'கல்லாவில்' : 'கல்லாவிலிருந்து'} ${r(a)} ரூபாய், ${CAT.ta[c]}, சரியா?`,
  supplierSaved: (n, a, d, o) => `${n}, ${r(a)} ரூபாய் ${d === 'credit' ? 'சரக்கு வாங்கியது' : 'கொடுத்தது'}. ${o > 0 ? `இப்போது ${n} அவர்களுக்கு ${r(o)} ரூபாய் தர வேண்டும்.` : o < 0 ? `${n} அவர்களிடம் உங்கள் ${r(-o)} ரூபாய் உள்ளது.` : 'கணக்கு சமம்.'}`,
  supplierBalance: (n, o) => (o > 0 ? `${n} அவர்களுக்கு ${r(o)} ரூபாய் தர வேண்டும்.` : o < 0 ? `${n} அவர்களிடம் உங்கள் ${r(-o)} ரூபாய் உள்ளது.` : `${n} அவர்களுடன் கணக்கு சமம்.`),
  noSupplierReminder: (n) => `${n} சப்ளையர், அவர்களுக்கு நினைவூட்டல் அனுப்பப்படாது.`,
  dueNoted: (d) => `${d} ஆம் தேதிக்குள் தர வேண்டும்.`,
  instalmentLine: (a) => `இந்தத் தவணைக்கு: *${a}*`,
  nicknameAsk: (n) => `ஏற்கனவே ஒரு ${n} இருக்கிறார். இவரை எப்படி அடையாளம் காண்பது, பால்காரர் அல்லது தெரு 3 போல?`,
  notFoundOffer: (n) => `${n} கணக்கு இன்னும் இல்லை. புதிய கணக்கு திறக்கட்டுமா?`,
  tagSet: (n, t) => `சரி, இவர் ${t} ${n}.`,
  soundAlikeAsk: (k, h, a, d) => `${r(a)} ரூபாய் ${d === 'credit' ? 'கடன்' : 'வரவு'}: ${k} அவர்களா, அல்லது புதிய வாடிக்கையாளர் ${h}?`,
  category: (c) => CAT.ta[c],
}

const TE: ShopReplies = {
  tagSkipped: (l) => `సరే, ప్రస్తుతానికి ${l} అని చూపిస్తాను.`,
  dailySummary: (d) => [
    `ఈరోజు ${r(d.credit)} రూపాయలు అప్పు వెళ్ళింది, ${r(d.paid)} రూపాయలు జమ వచ్చింది.`,
    d.newCustomers ? `${d.newCustomers} కొత్త కస్టమర్లు.` : '',
    d.top.length ? `ఎక్కువ బాకీ: ${d.top.map((t) => `${t.name} ${r(t.amt)}`).join(', ')}.` : '',
    d.promises.length ? `ఈరోజు ${names(d.promises, 'మరియు')} ఇస్తామన్నారు.` : '',
    d.cashIn || d.cashOut ? `గల్లా: ${r(d.cashIn ?? 0)} రూపాయలు వచ్చాయి, ${r(d.cashOut ?? 0)} రూపాయలు వెళ్ళాయి.` : '',
  ].filter(Boolean).join(' '),
  morningBriefing: (b) => [
    'శుభోదయం!',
    b.promises ? `ఈరోజు ${b.promises} మాటిచ్చిన చెల్లింపులు ఉన్నాయి.` : '',
    b.due ? `${b.due} మంది తేదీ వచ్చింది.` : '',
    b.old ? `${b.old} మంది బాకీ 30 రోజుల కంటే పాతది.` : '',
    `మొత్తం ${r(b.total)} రూపాయలు రావాలి. జాబితా చూద్దామా?`,
  ].filter(Boolean).join(' '),
  overdueList: (n, d, t, ns) => `${n} మంది బాకీ ${d} రోజుల కంటే పాతది, మొత్తం ${r(t)} రూపాయలు${ns.length ? `: ${ns.join(', ')}` : ''}. జాబితా తెరపై ఉంది.`,
  noOverdue: (d) => `${d} రోజుల కంటే పాత బాకీ ఏదీ లేదు.`,
  collectToday: (n, t, ns) => `ఈరోజు ${n} మంది నుండి ${r(t)} రూపాయలు రావాలి${ns.length ? `: ${ns.join(', ')}` : ''}. జాబితా తెరపై ఉంది.`,
  nothingToCollect: () => 'ఈరోజు ఎవరి నుండీ రావలసింది లేదు.',
  planAsk: (n, t, p, a, e) => `${n} గారి ${r(t)} రూపాయలు, ${p} వాయిదాల్లో, ${every(e, 'ప్రతిరోజు', 'ప్రతి వారం', 'ప్రతి నెల', (x) => `ప్రతి ${x} రోజులకు`)} ${r(a)} రూపాయలు. సరేనా?`,
  planSet: (n, a, e) => `సరే, ${n} గారి వాయిదా ${every(e, 'ప్రతిరోజు', 'ప్రతి వారం', 'ప్రతి నెల', (x) => `ప్రతి ${x} రోజులకు`)} ${r(a)} రూపాయలు.`,
  planCancelAsk: (n) => `${n} గారి వాయిదా ప్లాన్ ఆపేయనా?`,
  planCancelled: (n) => `${n} గారి వాయిదా ప్లాన్ ఆపేశాను.`,
  noPlan: (n) => `${n} గారికి వాయిదా ప్లాన్ లేదు.`,
  cashSaved: (a, d, c) => (d === 'in' ? `గల్లాలోకి ${r(a)} రూపాయలు వచ్చాయి, ${CAT.te[c]}.` : `గల్లా నుండి ${r(a)} రూపాయలు వెళ్ళాయి, ${CAT.te[c]}.`),
  cashAsk: (a, d, c) => `${d === 'in' ? 'గల్లాలోకి' : 'గల్లా నుండి'} ${r(a)} రూపాయలు, ${CAT.te[c]}, సరేనా?`,
  supplierSaved: (n, a, d, o) => `${n}, ${r(a)} రూపాయలు ${d === 'credit' ? 'సరుకు తీసుకున్నది' : 'ఇచ్చినది'}. ${o > 0 ? `ఇప్పుడు ${n} గారికి ${r(o)} రూపాయలు ఇవ్వాలి.` : o < 0 ? `${n} గారి దగ్గర మీ ${r(-o)} రూపాయలు ఉన్నాయి.` : 'లెక్క సమం.'}`,
  supplierBalance: (n, o) => (o > 0 ? `${n} గారికి ${r(o)} రూపాయలు ఇవ్వాలి.` : o < 0 ? `${n} గారి దగ్గర మీ ${r(-o)} రూపాయలు ఉన్నాయి.` : `${n} గారితో లెక్క సమం.`),
  noSupplierReminder: (n) => `${n} సప్లయర్, వారికి రిమైండర్ వెళ్ళదు.`,
  dueNoted: (d) => `${d} వ తేదీ లోపు ఇవ్వాలి.`,
  instalmentLine: (a) => `ఈ వాయిదాకు: *${a}*`,
  nicknameAsk: (n) => `ఇప్పటికే ఒక ${n} ఉన్నారు. వీరిని ఎలా గుర్తించాలి, పాలవాళ్ళు లేదా వీధి 3 లాగా?`,
  notFoundOffer: (n) => `${n} ఖాతా ఇంకా లేదు. కొత్త ఖాతా తెరవనా?`,
  tagSet: (n, t) => `సరే, వీరు ${t} ${n}.`,
  soundAlikeAsk: (k, h, a, d) => `${r(a)} రూపాయలు ${d === 'credit' ? 'అప్పు' : 'జమ'}: ${k} గారా, లేక కొత్త కస్టమర్ ${h}?`,
  category: (c) => CAT.te[c],
}

const ML: ShopReplies = {
  tagSkipped: (l) => `ശരി, തൽക്കാലം ${l} എന്ന് കാണിക്കും.`,
  dailySummary: (d) => [
    `ഇന്ന് ${r(d.credit)} രൂപ കടം പോയി, ${r(d.paid)} രൂപ വരവ് വന്നു.`,
    d.newCustomers ? `${d.newCustomers} പുതിയ ഉപഭോക്താക്കൾ.` : '',
    d.top.length ? `കൂടുതൽ ബാക്കി: ${d.top.map((t) => `${t.name} ${r(t.amt)}`).join(', ')}.` : '',
    d.promises.length ? `ഇന്ന് ${names(d.promises, 'ഉം')} തരാമെന്ന് പറഞ്ഞിട്ടുണ്ട്.` : '',
    d.cashIn || d.cashOut ? `പണപ്പെട്ടി: ${r(d.cashIn ?? 0)} രൂപ വന്നു, ${r(d.cashOut ?? 0)} രൂപ പോയി.` : '',
  ].filter(Boolean).join(' '),
  morningBriefing: (b) => [
    'സുപ്രഭാതം!',
    b.promises ? `ഇന്ന് ${b.promises} വാഗ്ദാനങ്ങൾ ഉണ്ട്.` : '',
    b.due ? `${b.due} പേരുടെ തീയതി എത്തി.` : '',
    b.old ? `${b.old} പേരുടെ ബാക്കി 30 ദിവസത്തിലേറെ പഴയതാണ്.` : '',
    `ആകെ ${r(b.total)} രൂപ കിട്ടാനുണ്ട്. പട്ടിക കാണണോ?`,
  ].filter(Boolean).join(' '),
  overdueList: (n, d, t, ns) => `${n} പേരുടെ ബാക്കി ${d} ദിവസത്തിലേറെ പഴയതാണ്, ആകെ ${r(t)} രൂപ${ns.length ? `: ${ns.join(', ')}` : ''}. പട്ടിക സ്ക്രീനിലുണ്ട്.`,
  noOverdue: (d) => `${d} ദിവസത്തിലേറെ പഴയ ബാക്കി ഒന്നുമില്ല.`,
  collectToday: (n, t, ns) => `ഇന്ന് ${n} പേരിൽ നിന്ന് ${r(t)} രൂപ കിട്ടാനുണ്ട്${ns.length ? `: ${ns.join(', ')}` : ''}. പട്ടിക സ്ക്രീനിലുണ്ട്.`,
  nothingToCollect: () => 'ഇന്ന് ആരിൽ നിന്നും കിട്ടാനില്ല.',
  planAsk: (n, t, p, a, e) => `${n} ന്റെ ${r(t)} രൂപ, ${p} ഗഡുക്കളായി, ${every(e, 'ദിവസവും', 'ആഴ്ചതോറും', 'മാസംതോറും', (x) => `${x} ദിവസം കൂടുമ്പോൾ`)} ${r(a)} രൂപ. ശരിയാണോ?`,
  planSet: (n, a, e) => `ശരി, ${n} ന്റെ ഗഡു ${every(e, 'ദിവസവും', 'ആഴ്ചതോറും', 'മാസംതോറും', (x) => `${x} ദിവസം കൂടുമ്പോൾ`)} ${r(a)} രൂപ.`,
  planCancelAsk: (n) => `${n} ന്റെ ഗഡു പദ്ധതി നിർത്തട്ടെ?`,
  planCancelled: (n) => `${n} ന്റെ ഗഡു പദ്ധതി നിർത്തി.`,
  noPlan: (n) => `${n} ന് ഗഡു പദ്ധതി ഇല്ല.`,
  cashSaved: (a, d, c) => `${d === 'in' ? 'പണപ്പെട്ടിയിൽ' : 'പണപ്പെട്ടിയിൽ നിന്ന്'} ${r(a)} രൂപ ${d === 'in' ? 'വന്നു' : 'പോയി'}, ${CAT.ml[c]}.`,
  cashAsk: (a, d, c) => `${d === 'in' ? 'പണപ്പെട്ടിയിൽ' : 'പണപ്പെട്ടിയിൽ നിന്ന്'} ${r(a)} രൂപ, ${CAT.ml[c]}, ശരിയാണോ?`,
  supplierSaved: (n, a, d, o) => `${n}, ${r(a)} രൂപ ${d === 'credit' ? 'സാധനം എടുത്തത്' : 'കൊടുത്തത്'}. ${o > 0 ? `ഇപ്പോൾ ${n} ന് ${r(o)} രൂപ കൊടുക്കാനുണ്ട്.` : o < 0 ? `${n} ന്റെ പക്കൽ നിങ്ങളുടെ ${r(-o)} രൂപയുണ്ട്.` : 'കണക്ക് തുല്യം.'}`,
  supplierBalance: (n, o) => (o > 0 ? `${n} ന് ${r(o)} രൂപ കൊടുക്കാനുണ്ട്.` : o < 0 ? `${n} ന്റെ പക്കൽ നിങ്ങളുടെ ${r(-o)} രൂപയുണ്ട്.` : `${n} മായുള്ള കണക്ക് തുല്യം.`),
  noSupplierReminder: (n) => `${n} വിതരണക്കാരനാണ്, ഓർമ്മപ്പെടുത്തൽ അയക്കില്ല.`,
  dueNoted: (d) => `${d} ആം തീയതിക്കകം തരണം.`,
  instalmentLine: (a) => `ഈ ഗഡുവിന്: *${a}*`,
  nicknameAsk: (n) => `ഒരു ${n} ഇപ്പോൾ തന്നെ ഉണ്ട്. ഇവരെ എങ്ങനെ തിരിച്ചറിയാം, പാൽക്കാരൻ അല്ലെങ്കിൽ ഗലി 3 പോലെ?`,
  notFoundOffer: (n) => `${n} എന്ന കണക്ക് ഇതുവരെ ഇല്ല. പുതിയ കണക്ക് തുറക്കട്ടെ?`,
  tagSet: (n, t) => `ശരി, ഇത് ${t} ${n}.`,
  soundAlikeAsk: (k, h, a, d) => `${r(a)} രൂപ ${d === 'credit' ? 'കടം' : 'വരവ്'}: ${k} ആണോ, അതോ പുതിയ ഉപഭോക്താവ് ${h}?`,
  category: (c) => CAT.ml[c],
}

const MR: ShopReplies = {
  tagSkipped: (l) => `ठीक आहे, सध्या ${l} नावाने दिसतील.`,
  dailySummary: (d) => [
    `आज ${r(d.credit)} रुपये उधार गेले, ${r(d.paid)} रुपये जमा आले.`,
    d.newCustomers ? `${d.newCustomers} नवीन ग्राहक.` : '',
    d.top.length ? `सर्वात जास्त बाकी: ${d.top.map((t) => `${t.name} ${r(t.amt)}`).join(', ')}.` : '',
    d.promises.length ? `आज ${names(d.promises, 'आणि')} यांनी देण्याचे सांगितले आहे.` : '',
    d.cashIn || d.cashOut ? `गल्ला: ${r(d.cashIn ?? 0)} रुपये आले, ${r(d.cashOut ?? 0)} रुपये गेले.` : '',
  ].filter(Boolean).join(' '),
  morningBriefing: (b) => [
    'सुप्रभात!',
    b.promises ? `आज ${b.promises} वचने आहेत.` : '',
    b.due ? `${b.due} जणांची तारीख आली आहे.` : '',
    b.old ? `${b.old} जणांची बाकी 30 दिवसांपेक्षा जुनी आहे.` : '',
    `एकूण ${r(b.total)} रुपये घ्यायचे आहेत. यादी पाहायची?`,
  ].filter(Boolean).join(' '),
  overdueList: (n, d, t, ns) => `${n} जणांची बाकी ${d} दिवसांपेक्षा जुनी आहे, एकूण ${r(t)} रुपये${ns.length ? `: ${ns.join(', ')}` : ''}. यादी स्क्रीनवर आहे.`,
  noOverdue: (d) => `${d} दिवसांपेक्षा जुनी बाकी नाही.`,
  collectToday: (n, t, ns) => `आज ${n} जणांकडून ${r(t)} रुपये घ्यायचे आहेत${ns.length ? `: ${ns.join(', ')}` : ''}. यादी स्क्रीनवर आहे.`,
  nothingToCollect: () => 'आज कोणाकडून घ्यायचे बाकी नाही.',
  planAsk: (n, t, p, a, e) => `${n} यांचे ${r(t)} रुपये, ${p} हप्त्यांत, ${every(e, 'दररोज', 'दर आठवड्याला', 'दर महिन्याला', (x) => `दर ${x} दिवसांनी`)} ${r(a)} रुपये. बरोबर?`,
  planSet: (n, a, e) => `ठीक आहे, ${n} यांचा हप्ता ${every(e, 'दररोज', 'दर आठवड्याला', 'दर महिन्याला', (x) => `दर ${x} दिवसांनी`)} ${r(a)} रुपये.`,
  planCancelAsk: (n) => `${n} यांची हप्ता योजना बंद करू?`,
  planCancelled: (n) => `${n} यांची हप्ता योजना बंद केली.`,
  noPlan: (n) => `${n} यांची हप्ता योजना नाही.`,
  cashSaved: (a, d, c) => `गल्ल्या${d === 'in' ? 'त' : 'तून'} ${r(a)} रुपये ${d === 'in' ? 'आले' : 'गेले'}, ${CAT.mr[c]}.`,
  cashAsk: (a, d, c) => `गल्ल्या${d === 'in' ? 'त' : 'तून'} ${r(a)} रुपये, ${CAT.mr[c]}, बरोबर?`,
  supplierSaved: (n, a, d, o) => `${n}, ${r(a)} रुपये ${d === 'credit' ? 'माल घेतला' : 'दिले'}. ${o > 0 ? `आता ${n} यांना ${r(o)} रुपये द्यायचे आहेत.` : o < 0 ? `${n} यांच्याकडे तुमचे ${r(-o)} रुपये आहेत.` : 'हिशोब बरोबर.'}`,
  supplierBalance: (n, o) => (o > 0 ? `${n} यांना ${r(o)} रुपये द्यायचे आहेत.` : o < 0 ? `${n} यांच्याकडे तुमचे ${r(-o)} रुपये आहेत.` : `${n} यांचा हिशोब बरोबर आहे.`),
  noSupplierReminder: (n) => `${n} पुरवठादार आहेत, त्यांना आठवण संदेश जात नाही.`,
  dueNoted: (d) => `${d} तारखेपर्यंत द्यायचे.`,
  instalmentLine: (a) => `या हप्त्यासाठी: *${a}*`,
  nicknameAsk: (n) => `एक ${n} आधीच आहेत. यांना कसे ओळखायचे, जसे दूधवाले किंवा गल्ली 3?`,
  notFoundOffer: (n) => `${n} यांचे खाते अजून नाही. नवीन खाते उघडू का?`,
  tagSet: (n, t) => `ठीक आहे, हे ${t} ${n}.`,
  soundAlikeAsk: (k, h, a, d) => `${r(a)} रुपये ${d === 'credit' ? 'उधार' : 'जमा'}: ${k}, की नवीन ग्राहक ${h}?`,
  category: (c) => CAT.mr[c],
}

const BN: ShopReplies = {
  tagSkipped: (l) => `ঠিক আছে, আপাতত ${l} নামে দেখাব।`,
  dailySummary: (d) => [
    `আজ ${r(d.credit)} টাকা বাকি গেছে, ${r(d.paid)} টাকা জমা এসেছে।`,
    d.newCustomers ? `${d.newCustomers} জন নতুন গ্রাহক।` : '',
    d.top.length ? `সবচেয়ে বেশি বাকি: ${d.top.map((t) => `${t.name} ${r(t.amt)}`).join(', ')}।` : '',
    d.promises.length ? `আজ ${names(d.promises, 'আর')} দেবেন বলেছেন।` : '',
    d.cashIn || d.cashOut ? `ক্যাশবাক্স: ${r(d.cashIn ?? 0)} টাকা এসেছে, ${r(d.cashOut ?? 0)} টাকা গেছে।` : '',
  ].filter(Boolean).join(' '),
  morningBriefing: (b) => [
    'সুপ্রভাত!',
    b.promises ? `আজ ${b.promises}টি প্রতিশ্রুতি আছে।` : '',
    b.due ? `${b.due} জনের তারিখ এসে গেছে।` : '',
    b.old ? `${b.old} জনের বাকি 30 দিনের বেশি পুরনো।` : '',
    `মোট ${r(b.total)} টাকা পাওয়ার আছে। তালিকা দেখবেন?`,
  ].filter(Boolean).join(' '),
  overdueList: (n, d, t, ns) => `${n} জনের বাকি ${d} দিনের বেশি পুরনো, মোট ${r(t)} টাকা${ns.length ? `: ${ns.join(', ')}` : ''}। তালিকা স্ক্রিনে আছে।`,
  noOverdue: (d) => `${d} দিনের বেশি পুরনো কোনো বাকি নেই।`,
  collectToday: (n, t, ns) => `আজ ${n} জনের কাছ থেকে ${r(t)} টাকা পাওয়ার আছে${ns.length ? `: ${ns.join(', ')}` : ''}। তালিকা স্ক্রিনে আছে।`,
  nothingToCollect: () => 'আজ কারও কাছ থেকে পাওয়ার নেই।',
  planAsk: (n, t, p, a, e) => `${n}-এর ${r(t)} টাকা, ${p} কিস্তিতে, ${every(e, 'প্রতিদিন', 'প্রতি সপ্তাহে', 'প্রতি মাসে', (x) => `প্রতি ${x} দিনে`)} ${r(a)} টাকা। ঠিক তো?`,
  planSet: (n, a, e) => `ঠিক আছে, ${n}-এর কিস্তি ${every(e, 'প্রতিদিন', 'প্রতি সপ্তাহে', 'প্রতি মাসে', (x) => `প্রতি ${x} দিনে`)} ${r(a)} টাকা।`,
  planCancelAsk: (n) => `${n}-এর কিস্তির পরিকল্পনা বন্ধ করব?`,
  planCancelled: (n) => `${n}-এর কিস্তির পরিকল্পনা বন্ধ করলাম।`,
  noPlan: (n) => `${n}-এর কোনো কিস্তির পরিকল্পনা নেই।`,
  cashSaved: (a, d, c) => `ক্যাশবাক্স${d === 'in' ? 'ে' : ' থেকে'} ${r(a)} টাকা ${d === 'in' ? 'এল' : 'গেল'}, ${CAT.bn[c]}।`,
  cashAsk: (a, d, c) => `ক্যাশবাক্স${d === 'in' ? 'ে' : ' থেকে'} ${r(a)} টাকা, ${CAT.bn[c]}, ঠিক তো?`,
  supplierSaved: (n, a, d, o) => `${n}, ${r(a)} টাকা ${d === 'credit' ? 'মাল নেওয়া' : 'দেওয়া'}। ${o > 0 ? `এখন ${n}-কে ${r(o)} টাকা দিতে হবে।` : o < 0 ? `${n}-এর কাছে আপনার ${r(-o)} টাকা আছে।` : 'হিসাব সমান।'}`,
  supplierBalance: (n, o) => (o > 0 ? `${n}-কে ${r(o)} টাকা দিতে হবে।` : o < 0 ? `${n}-এর কাছে আপনার ${r(-o)} টাকা আছে।` : `${n}-এর সঙ্গে হিসাব সমান।`),
  noSupplierReminder: (n) => `${n} সরবরাহকারী, তাঁকে মনে করানোর বার্তা যায় না।`,
  dueNoted: (d) => `${d} তারিখের মধ্যে দিতে হবে।`,
  instalmentLine: (a) => `এই কিস্তির জন্য: *${a}*`,
  nicknameAsk: (n) => `একজন ${n} আগে থেকেই আছেন। এঁকে কীভাবে চিনব, যেমন দুধওয়ালা বা গলি 3?`,
  notFoundOffer: (n) => `${n}-এর খাতা এখনও নেই। নতুন খাতা খুলব?`,
  tagSet: (n, t) => `ঠিক আছে, ইনি ${t} ${n}।`,
  soundAlikeAsk: (k, h, a, d) => `${r(a)} টাকা ${d === 'credit' ? 'বাকি' : 'জমা'}: ${k}, নাকি নতুন গ্রাহক ${h}?`,
  category: (c) => CAT.bn[c],
}

const GU: ShopReplies = {
  tagSkipped: (l) => `બરાબર, હમણાં ${l} નામે દેખાશે.`,
  dailySummary: (d) => [
    `આજે ${r(d.credit)} રૂપિયા ઉધાર ગયા, ${r(d.paid)} રૂપિયા જમા આવ્યા.`,
    d.newCustomers ? `${d.newCustomers} નવા ગ્રાહક.` : '',
    d.top.length ? `સૌથી વધુ બાકી: ${d.top.map((t) => `${t.name} ${r(t.amt)}`).join(', ')}.` : '',
    d.promises.length ? `આજે ${names(d.promises, 'અને')} એ આપવાનું કહ્યું છે.` : '',
    d.cashIn || d.cashOut ? `ગલ્લો: ${r(d.cashIn ?? 0)} રૂપિયા આવ્યા, ${r(d.cashOut ?? 0)} રૂપિયા ગયા.` : '',
  ].filter(Boolean).join(' '),
  morningBriefing: (b) => [
    'સુપ્રભાત!',
    b.promises ? `આજે ${b.promises} વચન છે.` : '',
    b.due ? `${b.due} લોકોની તારીખ આવી ગઈ છે.` : '',
    b.old ? `${b.old} લોકોનું બાકી 30 દિવસથી જૂનું છે.` : '',
    `કુલ ${r(b.total)} રૂપિયા લેવાના છે. યાદી જોવી છે?`,
  ].filter(Boolean).join(' '),
  overdueList: (n, d, t, ns) => `${n} લોકોનું બાકી ${d} દિવસથી જૂનું છે, કુલ ${r(t)} રૂપિયા${ns.length ? `: ${ns.join(', ')}` : ''}. યાદી સ્ક્રીન પર છે.`,
  noOverdue: (d) => `${d} દિવસથી જૂનું કોઈ બાકી નથી.`,
  collectToday: (n, t, ns) => `આજે ${n} લોકો પાસેથી ${r(t)} રૂપિયા લેવાના છે${ns.length ? `: ${ns.join(', ')}` : ''}. યાદી સ્ક્રીન પર છે.`,
  nothingToCollect: () => 'આજે કોઈ પાસેથી લેવાનું બાકી નથી.',
  planAsk: (n, t, p, a, e) => `${n} ના ${r(t)} રૂપિયા, ${p} હપ્તામાં, ${every(e, 'દરરોજ', 'દર અઠવાડિયે', 'દર મહિને', (x) => `દર ${x} દિવસે`)} ${r(a)} રૂપિયા. બરાબર?`,
  planSet: (n, a, e) => `બરાબર, ${n} નો હપ્તો ${every(e, 'દરરોજ', 'દર અઠવાડિયે', 'દર મહિને', (x) => `દર ${x} દિવસે`)} ${r(a)} રૂપિયા.`,
  planCancelAsk: (n) => `${n} ની હપ્તા યોજના બંધ કરું?`,
  planCancelled: (n) => `${n} ની હપ્તા યોજના બંધ કરી.`,
  noPlan: (n) => `${n} ની કોઈ હપ્તા યોજના નથી.`,
  cashSaved: (a, d, c) => `ગલ્લા${d === 'in' ? 'માં' : 'માંથી'} ${r(a)} રૂપિયા ${d === 'in' ? 'આવ્યા' : 'ગયા'}, ${CAT.gu[c]}.`,
  cashAsk: (a, d, c) => `ગલ્લા${d === 'in' ? 'માં' : 'માંથી'} ${r(a)} રૂપિયા, ${CAT.gu[c]}, બરાબર?`,
  supplierSaved: (n, a, d, o) => `${n}, ${r(a)} રૂપિયા ${d === 'credit' ? 'નો માલ લીધો' : 'આપ્યા'}. ${o > 0 ? `હવે ${n} ને ${r(o)} રૂપિયા આપવાના છે.` : o < 0 ? `${n} પાસે તમારા ${r(-o)} રૂપિયા છે.` : 'હિસાબ સરખો.'}`,
  supplierBalance: (n, o) => (o > 0 ? `${n} ને ${r(o)} રૂપિયા આપવાના છે.` : o < 0 ? `${n} પાસે તમારા ${r(-o)} રૂપિયા છે.` : `${n} સાથે હિસાબ સરખો છે.`),
  noSupplierReminder: (n) => `${n} સપ્લાયર છે, તેમને રીમાઇન્ડર મોકલાતું નથી.`,
  dueNoted: (d) => `${d} તારીખ સુધીમાં આપવાના.`,
  instalmentLine: (a) => `આ હપ્તા માટે: *${a}*`,
  nicknameAsk: (n) => `એક ${n} પહેલેથી છે. એમને કેવી રીતે ઓળખીએ, જેમ કે દૂધવાળા કે ગલી 3?`,
  notFoundOffer: (n) => `${n}નું ખાતું હજી નથી. નવું ખાતું ખોલું?`,
  tagSet: (n, t) => `બરાબર, આ ${t} ${n} છે.`,
  soundAlikeAsk: (k, h, a, d) => `${r(a)} રૂપિયા ${d === 'credit' ? 'ઉધાર' : 'જમા'}: ${k}, કે નવા ગ્રાહક ${h}?`,
  category: (c) => CAT.gu[c],
}

const PA: ShopReplies = {
  tagSkipped: (l) => `ਠੀਕ ਹੈ, ਹਾਲੇ ${l} ਨਾਮ ਨਾਲ ਦਿਸਣਗੇ।`,
  dailySummary: (d) => [
    `ਅੱਜ ${r(d.credit)} ਰੁਪਏ ਉਧਾਰ ਗਏ, ${r(d.paid)} ਰੁਪਏ ਜਮ੍ਹਾ ਆਏ।`,
    d.newCustomers ? `${d.newCustomers} ਨਵੇਂ ਗਾਹਕ।` : '',
    d.top.length ? `ਸਭ ਤੋਂ ਵੱਧ ਬਾਕੀ: ${d.top.map((t) => `${t.name} ${r(t.amt)}`).join(', ')}।` : '',
    d.promises.length ? `ਅੱਜ ${names(d.promises, 'ਅਤੇ')} ਨੇ ਦੇਣ ਦਾ ਵਾਅਦਾ ਕੀਤਾ ਹੈ।` : '',
    d.cashIn || d.cashOut ? `ਗੱਲਾ: ${r(d.cashIn ?? 0)} ਰੁਪਏ ਆਏ, ${r(d.cashOut ?? 0)} ਰੁਪਏ ਗਏ।` : '',
  ].filter(Boolean).join(' '),
  morningBriefing: (b) => [
    'ਸ਼ੁਭ ਸਵੇਰ!',
    b.promises ? `ਅੱਜ ${b.promises} ਵਾਅਦੇ ਹਨ।` : '',
    b.due ? `${b.due} ਲੋਕਾਂ ਦੀ ਤਾਰੀਖ ਆ ਗਈ ਹੈ।` : '',
    b.old ? `${b.old} ਲੋਕਾਂ ਦਾ ਬਾਕੀ 30 ਦਿਨਾਂ ਤੋਂ ਪੁਰਾਣਾ ਹੈ।` : '',
    `ਕੁੱਲ ${r(b.total)} ਰੁਪਏ ਲੈਣੇ ਹਨ। ਸੂਚੀ ਵੇਖਣੀ ਹੈ?`,
  ].filter(Boolean).join(' '),
  overdueList: (n, d, t, ns) => `${n} ਲੋਕਾਂ ਦਾ ਬਾਕੀ ${d} ਦਿਨਾਂ ਤੋਂ ਪੁਰਾਣਾ ਹੈ, ਕੁੱਲ ${r(t)} ਰੁਪਏ${ns.length ? `: ${ns.join(', ')}` : ''}। ਸੂਚੀ ਸਕਰੀਨ ਉੱਤੇ ਹੈ।`,
  noOverdue: (d) => `${d} ਦਿਨਾਂ ਤੋਂ ਪੁਰਾਣਾ ਕੋਈ ਬਾਕੀ ਨਹੀਂ ਹੈ।`,
  collectToday: (n, t, ns) => `ਅੱਜ ${n} ਲੋਕਾਂ ਤੋਂ ${r(t)} ਰੁਪਏ ਲੈਣੇ ਹਨ${ns.length ? `: ${ns.join(', ')}` : ''}। ਸੂਚੀ ਸਕਰੀਨ ਉੱਤੇ ਹੈ।`,
  nothingToCollect: () => 'ਅੱਜ ਕਿਸੇ ਤੋਂ ਲੈਣਾ ਬਾਕੀ ਨਹੀਂ ਹੈ।',
  planAsk: (n, t, p, a, e) => `${n} ਦੇ ${r(t)} ਰੁਪਏ, ${p} ਕਿਸ਼ਤਾਂ ਵਿੱਚ, ${every(e, 'ਹਰ ਰੋਜ਼', 'ਹਰ ਹਫ਼ਤੇ', 'ਹਰ ਮਹੀਨੇ', (x) => `ਹਰ ${x} ਦਿਨ`)} ${r(a)} ਰੁਪਏ। ਠੀਕ ਹੈ?`,
  planSet: (n, a, e) => `ਠੀਕ ਹੈ, ${n} ਦੀ ਕਿਸ਼ਤ ${every(e, 'ਹਰ ਰੋਜ਼', 'ਹਰ ਹਫ਼ਤੇ', 'ਹਰ ਮਹੀਨੇ', (x) => `ਹਰ ${x} ਦਿਨ`)} ${r(a)} ਰੁਪਏ।`,
  planCancelAsk: (n) => `${n} ਦੀ ਕਿਸ਼ਤ ਯੋਜਨਾ ਬੰਦ ਕਰ ਦਿਆਂ?`,
  planCancelled: (n) => `${n} ਦੀ ਕਿਸ਼ਤ ਯੋਜਨਾ ਬੰਦ ਕਰ ਦਿੱਤੀ।`,
  noPlan: (n) => `${n} ਦੀ ਕੋਈ ਕਿਸ਼ਤ ਯੋਜਨਾ ਨਹੀਂ ਹੈ।`,
  cashSaved: (a, d, c) => `ਗੱਲੇ ${d === 'in' ? 'ਵਿੱਚ' : 'ਵਿੱਚੋਂ'} ${r(a)} ਰੁਪਏ ${d === 'in' ? 'ਆਏ' : 'ਗਏ'}, ${CAT.pa[c]}।`,
  cashAsk: (a, d, c) => `ਗੱਲੇ ${d === 'in' ? 'ਵਿੱਚ' : 'ਵਿੱਚੋਂ'} ${r(a)} ਰੁਪਏ, ${CAT.pa[c]}, ਠੀਕ ਹੈ?`,
  supplierSaved: (n, a, d, o) => `${n}, ${r(a)} ਰੁਪਏ ${d === 'credit' ? 'ਦਾ ਮਾਲ ਲਿਆ' : 'ਦਿੱਤੇ'}। ${o > 0 ? `ਹੁਣ ${n} ਨੂੰ ${r(o)} ਰੁਪਏ ਦੇਣੇ ਹਨ।` : o < 0 ? `${n} ਕੋਲ ਤੁਹਾਡੇ ${r(-o)} ਰੁਪਏ ਹਨ।` : 'ਹਿਸਾਬ ਬਰਾਬਰ।'}`,
  supplierBalance: (n, o) => (o > 0 ? `${n} ਨੂੰ ${r(o)} ਰੁਪਏ ਦੇਣੇ ਹਨ।` : o < 0 ? `${n} ਕੋਲ ਤੁਹਾਡੇ ${r(-o)} ਰੁਪਏ ਹਨ।` : `${n} ਨਾਲ ਹਿਸਾਬ ਬਰਾਬਰ ਹੈ।`),
  noSupplierReminder: (n) => `${n} ਸਪਲਾਇਰ ਹਨ, ਉਨ੍ਹਾਂ ਨੂੰ ਯਾਦ-ਦਹਾਨੀ ਨਹੀਂ ਭੇਜੀ ਜਾਂਦੀ।`,
  dueNoted: (d) => `${d} ਤਾਰੀਖ ਤੱਕ ਦੇਣੇ ਹਨ।`,
  instalmentLine: (a) => `ਇਸ ਕਿਸ਼ਤ ਲਈ: *${a}*`,
  nicknameAsk: (n) => `ਇੱਕ ${n} ਪਹਿਲਾਂ ਤੋਂ ਹਨ। ਇਨ੍ਹਾਂ ਨੂੰ ਕਿਵੇਂ ਪਛਾਣੀਏ, ਜਿਵੇਂ ਦੁੱਧਵਾਲੇ ਜਾਂ ਗਲੀ 3?`,
  notFoundOffer: (n) => `${n} ਦਾ ਖਾਤਾ ਹਾਲੇ ਨਹੀਂ ਹੈ। ਨਵਾਂ ਖਾਤਾ ਖੋਲ੍ਹਾਂ?`,
  tagSet: (n, t) => `ਠੀਕ ਹੈ, ਇਹ ${t} ਵਾਲੇ ${n} ਹਨ।`,
  soundAlikeAsk: (k, h, a, d) => `${r(a)} ਰੁਪਏ ${d === 'credit' ? 'ਉਧਾਰ' : 'ਜਮ੍ਹਾ'}: ${k}, ਜਾਂ ਨਵੇਂ ਗਾਹਕ ${h}?`,
  category: (c) => CAT.pa[c],
}

export const SHOP_REPLIES: Record<Lang, ShopReplies> = { hi: HI, en: EN, kn: KN, ta: TA, te: TE, ml: ML, mr: MR, bn: BN, gu: GU, pa: PA }
export const sayShop = (lang: Lang): ShopReplies => SHOP_REPLIES[lang]
