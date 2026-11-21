/**
 * Everything the agent says, as templates in 10 languages. Amounts are spoken as digits with
 * Indian grouping: a Timbre -> Prisma round trip confirmed digits are read correctly in
 * hi/kn/ta/te/en (e.g. "1,870" comes back as 1,870).
 *
 * Responsible-AI rules baked in here (tests enforce them):
 *  - the first turn says it is an AI, in the user's language;
 *  - nothing judges, ranks or pressures a customer; reminders are polite, opt-in, and
 *    carry an opt-out line;
 *  - no lending, credit-limit or scoring language.
 */
import { formatINR } from './numbers.js'

export type Lang = 'hi' | 'en' | 'kn' | 'ta' | 'te' | 'ml' | 'mr' | 'bn' | 'gu' | 'pa'
export const LANGS: Lang[] = ['hi', 'en', 'kn', 'ta', 'te', 'ml', 'mr', 'bn', 'gu', 'pa']
export const LOCALE: Record<Lang, string> = {
  hi: 'hi-IN', en: 'en-IN', kn: 'kn-IN', ta: 'ta-IN', te: 'te-IN', ml: 'ml-IN', mr: 'mr-IN', bn: 'bn-IN', gu: 'gu-IN', pa: 'pa-IN',
}
export const LANG_NAME: Record<Lang, string> = {
  hi: 'हिन्दी', en: 'English', kn: 'ಕನ್ನಡ', ta: 'தமிழ்', te: 'తెలుగు', ml: 'മലയാളം', mr: 'मराठी', bn: 'বাংলা', gu: 'ગુજરાતી', pa: 'ਪੰਜਾਬੀ',
}
export const langFromLocale = (l: string): Lang => (LANGS.find((x) => l.startsWith(x)) ?? 'hi')

type Dir = 'credit' | 'payment'
const r = (rupees: number) => formatINR(rupees)

export interface Replies {
  disclosure: () => string
  /** short spoken confirmation for a confident save (name and amount are on screen) */
  ack: () => string
  /** the connection dropped before a turn's result arrived: it is being handled again */
  resent: () => string
  saved: (name: string, amt: number, dir: Dir) => string
  savedPromise: (name: string, amt: number, dayOffset: number) => string
  newCustomer: (name: string) => string
  confirm: (name: string, amt: number, dir: Dir) => string
  /** read-back before opening an account: a name not in the ledger is never written without a yes */
  confirmNew: (name: string, amt: number, dir: Dir) => string
  /** only a name was said: ask for the amount */
  askAmount: (name: string) => string
  noisyConfirm: (name: string, amt: number, dir: Dir) => string
  confusable: (amt: number, alt: number) => string
  askName: (amt: number) => string
  askDirection: (name: string, amt: number) => string
  askWhich: (a: string, b: string) => string
  balance: (name: string, owed: number) => string
  notFound: (name: string) => string
  daySummary: (credit: number, payment: number, entries: number) => string
  monthSummary: (credit: number, payment: number, entries: number) => string
  dues: (count: number, total: number) => string
  noDues: () => string
  undone: () => string
  nothingToUndo: () => string
  corrected: (name: string, amt: number, dir: Dir) => string
  notSaved: () => string
  didNotCatch: () => string
  noisyRepeat: () => string
  privacy: () => string
  deleteAsk: () => string
  deleted: () => string
  remindReady: (name: string) => string
  remindNotAllowed: (name: string) => string
  reminderText: (name: string, owed: number, shop: string) => string
  /** one save line plus the customer's new balance; a negative balance means the shop holds their advance */
  savedWithBalance: (name: string, amt: number, dir: Dir, balanceRs: number) => string
  /** a customer's balance, with their last entry when there is one */
  showCustomer: (name: string, balanceRs: number, lastEntry?: { amt: number; dir: Dir }) => string
  /** how many customers owe in total and how much (list is on screen) */
  showDues: (count: number, totalRs: number) => string
  /** a customer's (or period's) entry history is being shown; label names whose or which */
  showHistory: (label: string, count: number) => string
  /** today's credit and payment totals */
  showToday: (creditRs: number, paidRs: number) => string
  /** search results are on screen; text is what was searched for, 0 count says nothing was found */
  searchResult: (text: string, count: number) => string
  /** the customers with the largest balances, in the order given */
  topDebtors: (names: string[]) => string
  /** the agent closed a panel or screen */
  closed: () => string
  /** a new customer account was opened */
  customerAdded: (name: string) => string
  /** a customer was renamed from old to new */
  renamed: (oldName: string, newName: string) => string
  /** ask whether two names are one person before merging their accounts */
  mergeAsk: (a: string, b: string) => string
  /** two accounts were joined into one */
  merged: (a: string, b: string) => string
  /** a customer's phone number was saved */
  phoneSet: (name: string) => string
  /** a reminder message for the customer is ready to send */
  reminderReady: (name: string) => string
  /** a statement for the customer is ready */
  statementReady: (name: string) => string
  /** the customer has not agreed to messages, so none is made */
  noConsent: (name: string) => string
  /** the spoken language was changed; langName is the language's own name */
  languageSet: (langName: string) => string
  /** read-back of entries before saving was turned on or off */
  readBackSet: (on: boolean) => string
  /** speaking speed was set to fast or slow */
  speedSet: (fast: boolean) => string
  /** the shop name was saved */
  shopNameSet: (name: string) => string
  /** the privacy details were opened on screen */
  privacyOpen: () => string
  /** the backup file is ready to save */
  backupReady: () => string
  /** first step of erasing all data: ask for a spoken yes */
  eraseAsk: () => string
  /** second step of erasing all data: ask for the on-screen button tap */
  eraseTap: () => string
  /** the agent woke up on the wake word */
  awakeHello: () => string
  /** the agent went back to sleep */
  sleeping: () => string
}

const HI: Replies = {
  resent: () => 'नेटवर्क टूट गया था, फिर से लिख रहा हूँ।',
  ack: () => 'लिख दिया।',
  disclosure: () => 'नमस्ते! मैं खाता भाई हूँ, एक AI सहायक। आपका हिसाब सिर्फ़ इसी फ़ोन पर रहता है। बोलिए, किसका कितना लिखूँ?',
  saved: (n, a, d) => `${n}, ${r(a)} रुपये ${d === 'credit' ? 'उधार' : 'जमा'}।`,
  savedPromise: (n, a, o) => `${n} ${o <= 0 ? 'आज' : o === 1 ? 'कल' : o === 2 ? 'परसों' : `${o} दिन में`} ${r(a)} रुपये देंगे, याद रखूँगी।`,
  newCustomer: (n) => `${n} का नया खाता खोला।`,
  confirm: (n, a, d) => `${n}, ${r(a)} रुपये ${d === 'credit' ? 'उधार' : 'जमा'}, सही है?`,
  confirmNew: (n, a, d) => `नया ग्राहक ${n}: ${r(a)} रुपये ${d === 'credit' ? 'उधार' : 'जमा'}, सही है?`,
  askAmount: (n) => `${n}, कितने रुपये?`,
  noisyConfirm: (n, a, d) => `शोर ज़्यादा है। ${n}, ${r(a)} रुपये ${d === 'credit' ? 'उधार' : 'जमा'}, सही है?`,
  confusable: (a, b) => `${r(a)} रुपये या ${r(b)} रुपये?`,
  askName: (a) => `${r(a)} रुपये किसके नाम पर लिखूँ?`,
  askDirection: (n, a) => `${n}, ${r(a)} रुपये, उधार दिया या जमा किया?`,
  askWhich: (a, b) => `कौन से, ${a} या ${b}?`,
  balance: (n, o) => (o > 0 ? `${n} का कुल बाकी ${r(o)} रुपये है।` : o < 0 ? `${n} के ${r(-o)} रुपये आपके पास जमा हैं।` : `${n} का कोई बाकी नहीं है।`),
  notFound: (n) => `${n} नाम का कोई खाता नहीं मिला।`,
  daySummary: (c, p, e) => `आज ${e} एंट्री: उधार ${r(c)} रुपये, जमा ${r(p)} रुपये।`,
  monthSummary: (c, p, e) => `इस महीने ${e} एंट्री: उधार ${r(c)} रुपये, जमा ${r(p)} रुपये।`,
  dues: (n, t) => `${n} लोगों का कुल ${r(t)} रुपये बाकी है। सूची स्क्रीन पर है।`,
  noDues: () => 'अभी किसी का कुछ बाकी नहीं है।',
  undone: () => 'ठीक है, पिछली एंट्री हटा दी।',
  nothingToUndo: () => 'हटाने के लिए कोई एंट्री नहीं है।',
  corrected: (n, a, d) => `ठीक किया: ${n}, ${r(a)} रुपये ${d === 'credit' ? 'उधार' : 'जमा'}।`,
  notSaved: () => 'ठीक है, नहीं लिखा।',
  didNotCatch: () => 'माफ़ कीजिए, समझ नहीं आया। एक बार फिर बोलिए।',
  noisyRepeat: () => 'शोर की वजह से ठीक से सुनाई नहीं दिया। फ़ोन पास रखकर फिर बोलिए।',
  privacy: () => 'मैं एक AI सहायक हूँ। आपका खाता इसी फ़ोन पर ताले में रहता है। आवाज़ को लिखने के लिए Gnani की सेवा इस्तेमाल होती है, रिकॉर्डिंग रखी नहीं जाती। बैकअप सिर्फ़ आपकी मर्ज़ी से, आपके PIN से बंद होकर जाता है। "सब डेटा मिटा दो" बोलकर सब हटा सकते हैं।',
  deleteAsk: () => 'पूरा खाता हमेशा के लिए मिट जाएगा। पक्का मिटाऊँ? हाँ या ना बोलिए।',
  deleted: () => 'सारा डेटा मिटा दिया।',
  remindReady: (n) => `${n} के लिए WhatsApp संदेश तैयार है। भेजने के लिए बटन दबाइए।`,
  remindNotAllowed: (n) => `${n} ने याद दिलाने की अनुमति नहीं दी है, इसलिए संदेश नहीं बनाया।`,
  reminderText: (n, o, s) => `नमस्ते ${n} जी, ${s} पर आपका ${r(o)} रुपये का हिसाब है। जब सुविधा हो, देख लीजिए। धन्यवाद! (ऐसे संदेश नहीं चाहिए तो "बंद" लिखें।)`,
  savedWithBalance: (n, a, d, b) => `${n} का ${r(a)} रुपये ${d === 'credit' ? 'उधार लिख दिया' : 'जमा कर लिया'}। अब ${HI.balance(n, b)}`,
  showCustomer: (n, b, l) => HI.balance(n, b) + (l ? ` आख़िरी एंट्री ${r(l.amt)} रुपये ${l.dir === 'credit' ? 'उधार' : 'जमा'} की है।` : ''),
  showDues: (c, t) => `अभी ${c} लोगों का कुल ${r(t)} रुपये बाकी है।`,
  showHistory: (l, c) => `${l} की ${c} एंट्री स्क्रीन पर दिखा रहा हूँ।`,
  showToday: (c, p) => `आज उधार ${r(c)} रुपये और जमा ${r(p)} रुपये हुआ।`,
  searchResult: (t, c) => (c > 0 ? `"${t}" के ${c} नतीजे मिले, स्क्रीन पर हैं।` : `"${t}" के लिए कुछ नहीं मिला।`),
  topDebtors: (ns) => (ns.length ? `ज़्यादा बाकी वाले: ${ns.join(', ')}।` : HI.noDues()),
  closed: () => 'ठीक है, बंद कर दिया।',
  customerAdded: (n) => `${n} का नया खाता खोल दिया।`,
  renamed: (o, n) => `${o} का नाम बदलकर ${n} कर दिया।`,
  mergeAsk: (a, b) => `${a} और ${b} एक ही हैं? दोनों खाते मिला दूँ?`,
  merged: (a, b) => `${a} और ${b} का खाता एक कर दिया।`,
  phoneSet: (n) => `${n} का फ़ोन नंबर लिख लिया।`,
  reminderReady: (n) => `${n} के लिए याद दिलाने वाला संदेश तैयार है।`,
  statementReady: (n) => `${n} की हिसाब पर्ची तैयार है।`,
  noConsent: (n) => `${n} ने संदेश की इजाज़त नहीं दी है, इसलिए नहीं भेज सकता।`,
  languageSet: (l) => `ठीक है, अब ${l} में बात करूँगा।`,
  readBackSet: (on) => (on ? 'ठीक है, लिखने से पहले पढ़कर सुनाऊँगा।' : 'ठीक है, अब सीधे लिख दूँगा, पढ़कर नहीं सुनाऊँगा।'),
  speedSet: (f) => (f ? 'ठीक है, अब तेज़ बोलूँगा।' : 'ठीक है, अब धीरे बोलूँगा।'),
  shopNameSet: (n) => `दुकान का नाम ${n} रख दिया।`,
  privacyOpen: () => 'प्राइवेसी की जानकारी स्क्रीन पर खोल दी है।',
  backupReady: () => 'बैकअप तैयार है, सेव करने के लिए बटन दबाइए।',
  eraseAsk: () => 'सारा डेटा मिटाना है? पक्का हो तो हाँ बोलिए।',
  eraseTap: () => 'ठीक है, मिटाने के लिए स्क्रीन का बटन दबाइए।',
  awakeHello: () => 'हाँ, बोलिए।',
  sleeping: () => 'ठीक है, ज़रूरत हो तो बुला लीजिए।',
}

const EN: Replies = {
  resent: () => 'The network dropped, saving that again.',
  ack: () => 'Noted.',
  disclosure: () => 'Hello! I am KhataBhai, an AI assistant. Your ledger stays only on this phone. Tell me, whose amount should I write?',
  saved: (n, a, d) => `${n}, ${r(a)} rupees ${d === 'credit' ? 'on credit' : 'paid'}.`,
  savedPromise: (n, a, o) => `${n} will pay ${r(a)} rupees ${o <= 0 ? 'today' : o === 1 ? 'tomorrow' : `in ${o} days`}. I will remember.`,
  newCustomer: (n) => `Opened a new account for ${n}.`,
  confirm: (n, a, d) => `${n}, ${r(a)} rupees ${d === 'credit' ? 'on credit' : 'paid'}, correct?`,
  confirmNew: (n, a, d) => `New customer ${n}: ${r(a)} rupees ${d === 'credit' ? 'on credit' : 'paid'}, correct?`,
  askAmount: (n) => `${n}, how much?`,
  noisyConfirm: (n, a, d) => `It is noisy. ${n}, ${r(a)} rupees ${d === 'credit' ? 'on credit' : 'paid'}, correct?`,
  confusable: (a, b) => `${r(a)} rupees or ${r(b)} rupees?`,
  askName: (a) => `Whose name should I write ${r(a)} rupees under?`,
  askDirection: (n, a) => `${n}, ${r(a)} rupees. Credit, or paid?`,
  askWhich: (a, b) => `Which one, ${a} or ${b}?`,
  balance: (n, o) => (o > 0 ? `${n} owes ${r(o)} rupees in total.` : o < 0 ? `You hold ${r(-o)} rupees of ${n}'s advance.` : `${n} owes nothing.`),
  notFound: (n) => `I could not find an account named ${n}.`,
  daySummary: (c, p, e) => `Today, ${e} entries: credit ${r(c)} rupees, paid ${r(p)} rupees.`,
  monthSummary: (c, p, e) => `This month, ${e} entries: credit ${r(c)} rupees, paid ${r(p)} rupees.`,
  dues: (n, t) => `${n} customers owe ${r(t)} rupees in total. The list is on screen.`,
  noDues: () => 'Nobody owes anything right now.',
  undone: () => 'Okay, removed the last entry.',
  nothingToUndo: () => 'There is no entry to remove.',
  corrected: (n, a, d) => `Fixed: ${n}, ${r(a)} rupees ${d === 'credit' ? 'on credit' : 'paid'}.`,
  notSaved: () => 'Okay, not written.',
  didNotCatch: () => 'Sorry, I did not catch that. Please say it again.',
  noisyRepeat: () => 'It was too noisy to hear clearly. Hold the phone closer and say it again.',
  privacy: () => 'I am an AI assistant. Your ledger is locked on this phone. Gnani\'s service turns speech into text; recordings are not kept. Backup happens only if you choose, locked with your PIN. Say "delete all data" to erase everything.',
  deleteAsk: () => 'The whole ledger will be erased for good. Are you sure? Say yes or no.',
  deleted: () => 'All data erased.',
  remindReady: (n) => `A WhatsApp message for ${n} is ready. Press the button to send it.`,
  remindNotAllowed: (n) => `${n} has not agreed to reminders, so I did not make a message.`,
  reminderText: (n, o, s) => `Hello ${n}, your account at ${s} shows ${r(o)} rupees. Please have a look whenever convenient. Thank you! (Reply STOP to get no more messages like this.)`,
  savedWithBalance: (n, a, d, b) => `${n}'s ${r(a)} rupees ${d === 'credit' ? 'written on credit' : 'received as payment'}. ${b > 0 ? `Now ${n} owes ${r(b)} rupees in total.` : b < 0 ? `Now you hold ${r(-b)} rupees of ${n}'s advance.` : `Now ${n} owes nothing.`}`,
  showCustomer: (n, b, l) => EN.balance(n, b) + (l ? ` The last entry was ${r(l.amt)} rupees ${l.dir === 'credit' ? 'on credit' : 'paid'}.` : ''),
  showDues: (c, t) => `Right now ${c} customers owe ${r(t)} rupees in total.`,
  showHistory: (l, c) => `Showing ${l}'s ${c} entries on screen.`,
  showToday: (c, p) => `Today it is ${r(c)} rupees on credit and ${r(p)} rupees paid.`,
  searchResult: (t, c) => (c > 0 ? `Found ${c} results for "${t}", they are on screen.` : `I found nothing for "${t}".`),
  topDebtors: (ns) => (ns.length ? `The biggest balances are: ${ns.join(', ')}.` : EN.noDues()),
  closed: () => 'Okay, closed it.',
  customerAdded: (n) => `Added ${n} as a new customer.`,
  renamed: (o, n) => `Changed the name ${o} to ${n}.`,
  mergeAsk: (a, b) => `Are ${a} and ${b} the same person? Should I join both accounts?`,
  merged: (a, b) => `Joined ${a} and ${b} into one account.`,
  phoneSet: (n) => `Saved ${n}'s phone number.`,
  reminderReady: (n) => `The reminder message for ${n} is ready.`,
  statementReady: (n) => `${n}'s statement is ready.`,
  noConsent: (n) => `${n} has not agreed to messages, so I cannot send one.`,
  languageSet: (l) => `Okay, I will speak in ${l} from now on.`,
  readBackSet: (on) => (on ? 'Okay, I will read each entry back before saving.' : 'Okay, I will save directly without reading it back.'),
  speedSet: (f) => (f ? 'Okay, I will speak faster now.' : 'Okay, I will speak slower now.'),
  shopNameSet: (n) => `Set the shop name to ${n}.`,
  privacyOpen: () => 'I have opened the privacy details on screen.',
  backupReady: () => 'Your backup is ready, press the button to save it.',
  eraseAsk: () => 'Erase all data? If you are sure, say yes.',
  eraseTap: () => 'Okay, press the button on screen to erase it.',
  awakeHello: () => 'Yes, tell me.',
  sleeping: () => 'Okay, call me when you need me.',
}

const KN: Replies = {
  resent: () => 'ನೆಟ್‌ವರ್ಕ್ ಕಡಿತವಾಗಿತ್ತು, ಮತ್ತೆ ಬರೆಯುತ್ತಿದ್ದೇನೆ.',
  ack: () => 'ಬರೆದೆ.',
  disclosure: () => 'ನಮಸ್ಕಾರ! ನಾನು ಖಾತಾ ಭಾಯ್, ಒಂದು AI ಸಹಾಯಕಿ. ನಿಮ್ಮ ಲೆಕ್ಕ ಈ ಫೋನಿನಲ್ಲೇ ಇರುತ್ತದೆ. ಹೇಳಿ, ಯಾರದು ಎಷ್ಟು ಬರೆಯಲಿ?',
  saved: (n, a, d) => `${n}, ${r(a)} ರೂಪಾಯಿ ${d === 'credit' ? 'ಸಾಲ' : 'ಜಮಾ'}.`,
  savedPromise: (n, a, o) => `${n} ${o <= 0 ? 'ಇವತ್ತು' : o === 1 ? 'ನಾಳೆ' : `${o} ದಿನದಲ್ಲಿ`} ${r(a)} ರೂಪಾಯಿ ಕೊಡುತ್ತಾರೆ, ನೆನಪಿಟ್ಟುಕೊಳ್ಳುತ್ತೇನೆ.`,
  newCustomer: (n) => `${n} ಅವರ ಹೊಸ ಖಾತೆ ತೆರೆದಿದ್ದೇನೆ.`,
  confirm: (n, a, d) => `${n}, ${r(a)} ರೂಪಾಯಿ ${d === 'credit' ? 'ಸಾಲ' : 'ಜಮಾ'}, ಸರಿನಾ?`,
  confirmNew: (n, a, d) => `ಹೊಸ ಗ್ರಾಹಕ ${n}: ${r(a)} ರೂಪಾಯಿ ${d === 'credit' ? 'ಸಾಲ' : 'ಜಮಾ'}, ಸರಿನಾ?`,
  askAmount: (n) => `${n}, ಎಷ್ಟು ರೂಪಾಯಿ?`,
  noisyConfirm: (n, a, d) => `ತುಂಬಾ ಗಲಾಟೆ ಇದೆ. ${n}, ${r(a)} ರೂಪಾಯಿ ${d === 'credit' ? 'ಸಾಲ' : 'ಜಮಾ'}, ಸರಿನಾ?`,
  confusable: (a, b) => `${r(a)} ರೂಪಾಯಿನಾ ಅಥವಾ ${r(b)} ರೂಪಾಯಿನಾ?`,
  askName: (a) => `${r(a)} ರೂಪಾಯಿ ಯಾರ ಹೆಸರಿಗೆ ಬರೆಯಲಿ?`,
  askDirection: (n, a) => `${n}, ${r(a)} ರೂಪಾಯಿ, ಸಾಲ ಕೊಟ್ಟಿದ್ದಾ ಅಥವಾ ಅವರು ಕಟ್ಟಿದ್ದಾ?`,
  askWhich: (a, b) => `ಯಾರು, ${a} ಅಥವಾ ${b}?`,
  balance: (n, o) => (o > 0 ? `${n} ಅವರ ಒಟ್ಟು ಬಾಕಿ ${r(o)} ರೂಪಾಯಿ.` : o < 0 ? `${n} ಅವರ ${r(-o)} ರೂಪಾಯಿ ಮುಂಗಡ ನಿಮ್ಮ ಬಳಿ ಇದೆ.` : `${n} ಅವರ ಬಾಕಿ ಏನೂ ಇಲ್ಲ.`),
  notFound: (n) => `${n} ಹೆಸರಿನ ಖಾತೆ ಸಿಗಲಿಲ್ಲ.`,
  daySummary: (c, p, e) => `ಇವತ್ತು ${e} ಎಂಟ್ರಿ: ಸಾಲ ${r(c)} ರೂಪಾಯಿ, ಜಮಾ ${r(p)} ರೂಪಾಯಿ.`,
  monthSummary: (c, p, e) => `ಈ ತಿಂಗಳು ${e} ಎಂಟ್ರಿ: ಸಾಲ ${r(c)} ರೂಪಾಯಿ, ಜಮಾ ${r(p)} ರೂಪಾಯಿ.`,
  dues: (n, t) => `${n} ಜನರ ಒಟ್ಟು ಬಾಕಿ ${r(t)} ರೂಪಾಯಿ. ಪಟ್ಟಿ ಪರದೆಯ ಮೇಲಿದೆ.`,
  noDues: () => 'ಈಗ ಯಾರದೂ ಬಾಕಿ ಇಲ್ಲ.',
  undone: () => 'ಸರಿ, ಕೊನೆಯ ಎಂಟ್ರಿ ತೆಗೆದಿದ್ದೇನೆ.',
  nothingToUndo: () => 'ತೆಗೆಯಲು ಯಾವ ಎಂಟ್ರಿಯೂ ಇಲ್ಲ.',
  corrected: (n, a, d) => `ಸರಿಪಡಿಸಿದೆ: ${n}, ${r(a)} ರೂಪಾಯಿ ${d === 'credit' ? 'ಸಾಲ' : 'ಜಮಾ'}.`,
  notSaved: () => 'ಸರಿ, ಬರೆಯಲಿಲ್ಲ.',
  didNotCatch: () => 'ಕ್ಷಮಿಸಿ, ಅರ್ಥ ಆಗಲಿಲ್ಲ. ಇನ್ನೊಮ್ಮೆ ಹೇಳಿ.',
  noisyRepeat: () => 'ಗಲಾಟೆಯಿಂದ ಸರಿಯಾಗಿ ಕೇಳಿಸಲಿಲ್ಲ. ಫೋನ್ ಹತ್ತಿರ ಇಟ್ಟು ಮತ್ತೆ ಹೇಳಿ.',
  privacy: () => 'ನಾನು ಒಂದು AI ಸಹಾಯಕಿ. ನಿಮ್ಮ ಖಾತೆ ಈ ಫೋನಿನಲ್ಲೇ ಬೀಗ ಹಾಕಿ ಇರುತ್ತದೆ. ಧ್ವನಿಯನ್ನು ಬರಹಕ್ಕೆ ಬದಲಿಸಲು Gnani ಸೇವೆ ಬಳಸುತ್ತೇನೆ, ರೆಕಾರ್ಡಿಂಗ್ ಇಟ್ಟುಕೊಳ್ಳುವುದಿಲ್ಲ. ಬ್ಯಾಕಪ್ ನಿಮ್ಮ ಇಷ್ಟದಂತೆ, ನಿಮ್ಮ PIN ನಿಂದ ಬೀಗ ಹಾಕಿ ಮಾತ್ರ. "ಎಲ್ಲಾ ಡೇಟಾ ಅಳಿಸು" ಎಂದು ಹೇಳಿದರೆ ಎಲ್ಲವೂ ಅಳಿಯುತ್ತದೆ.',
  deleteAsk: () => 'ಇಡೀ ಖಾತೆ ಶಾಶ್ವತವಾಗಿ ಅಳಿಯುತ್ತದೆ. ಖಚಿತವಾ? ಹೌದು ಅಥವಾ ಇಲ್ಲ ಹೇಳಿ.',
  deleted: () => 'ಎಲ್ಲಾ ಡೇಟಾ ಅಳಿಸಿದೆ.',
  remindReady: (n) => `${n} ಅವರಿಗೆ WhatsApp ಸಂದೇಶ ಸಿದ್ಧ. ಕಳುಹಿಸಲು ಬಟನ್ ಒತ್ತಿ.`,
  remindNotAllowed: (n) => `${n} ಅವರು ನೆನಪಿನ ಸಂದೇಶಕ್ಕೆ ಒಪ್ಪಿಗೆ ಕೊಟ್ಟಿಲ್ಲ, ಹಾಗಾಗಿ ಸಂದೇಶ ಮಾಡಲಿಲ್ಲ.`,
  reminderText: (n, o, s) => `ನಮಸ್ಕಾರ ${n} ಅವರೇ, ${s} ನಲ್ಲಿ ನಿಮ್ಮ ಲೆಕ್ಕ ${r(o)} ರೂಪಾಯಿ ಇದೆ. ಅನುಕೂಲವಾದಾಗ ನೋಡಿ. ಧನ್ಯವಾದ! (ಇಂಥ ಸಂದೇಶ ಬೇಡವಾದರೆ "ನಿಲ್ಲಿಸಿ" ಎಂದು ಉತ್ತರಿಸಿ.)`,
  savedWithBalance: (n, a, d, b) => `${n} ಅವರ ${r(a)} ರೂಪಾಯಿ ${d === 'credit' ? 'ಸಾಲ ಬರೆದಿದ್ದೇನೆ' : 'ಜಮಾ ಮಾಡಿದ್ದೇನೆ'}. ಈಗ ${KN.balance(n, b)}`,
  showCustomer: (n, b, l) => KN.balance(n, b) + (l ? ` ಕೊನೆಯ ಎಂಟ್ರಿ ${r(l.amt)} ರೂಪಾಯಿ ${l.dir === 'credit' ? 'ಸಾಲ' : 'ಜಮಾ'}.` : ''),
  showDues: (c, t) => `ಈಗ ${c} ಜನರ ಒಟ್ಟು ಬಾಕಿ ${r(t)} ರೂಪಾಯಿ.`,
  showHistory: (l, c) => `${l} ಅವರ ${c} ಎಂಟ್ರಿಗಳು ಪರದೆಯ ಮೇಲಿವೆ.`,
  showToday: (c, p) => `ಇವತ್ತು ಸಾಲ ${r(c)} ರೂಪಾಯಿ, ಜಮಾ ${r(p)} ರೂಪಾಯಿ.`,
  searchResult: (t, c) => (c > 0 ? `"${t}" ಗೆ ${c} ಫಲಿತಾಂಶ ಸಿಕ್ಕಿವೆ, ಪರದೆಯ ಮೇಲಿವೆ.` : `"${t}" ಗೆ ಏನೂ ಸಿಗಲಿಲ್ಲ.`),
  topDebtors: (ns) => (ns.length ? `ಹೆಚ್ಚು ಬಾಕಿ ಇರುವವರು: ${ns.join(', ')}.` : KN.noDues()),
  closed: () => 'ಸರಿ, ಮುಚ್ಚಿದ್ದೇನೆ.',
  customerAdded: (n) => `${n} ಅವರ ಹೊಸ ಖಾತೆ ತೆರೆದಿದ್ದೇನೆ.`,
  renamed: (o, n) => `${o} ಹೆಸರನ್ನು ${n} ಎಂದು ಬದಲಾಯಿಸಿದ್ದೇನೆ.`,
  mergeAsk: (a, b) => `${a} ಮತ್ತು ${b} ಒಬ್ಬರೇನಾ? ಎರಡೂ ಖಾತೆ ಒಂದು ಮಾಡಲಾ?`,
  merged: (a, b) => `${a} ಮತ್ತು ${b} ಖಾತೆಗಳನ್ನು ಒಂದು ಮಾಡಿದ್ದೇನೆ.`,
  phoneSet: (n) => `${n} ಅವರ ಫೋನ್ ನಂಬರ್ ಬರೆದುಕೊಂಡೆ.`,
  reminderReady: (n) => `${n} ಅವರಿಗೆ ನೆನಪಿನ ಸಂದೇಶ ಸಿದ್ಧ.`,
  statementReady: (n) => `${n} ಅವರ ಲೆಕ್ಕದ ಚೀಟಿ ಸಿದ್ಧ.`,
  noConsent: (n) => `${n} ಅವರು ಸಂದೇಶಕ್ಕೆ ಒಪ್ಪಿಗೆ ಕೊಟ್ಟಿಲ್ಲ, ಹಾಗಾಗಿ ಕಳುಹಿಸಲಾಗುವುದಿಲ್ಲ.`,
  languageSet: (l) => `ಸರಿ, ಇನ್ನು ${l} ನಲ್ಲಿ ಮಾತಾಡುತ್ತೇನೆ.`,
  readBackSet: (on) => (on ? 'ಸರಿ, ಬರೆಯುವ ಮೊದಲು ಓದಿ ಹೇಳುತ್ತೇನೆ.' : 'ಸರಿ, ಇನ್ನು ನೇರವಾಗಿ ಬರೆಯುತ್ತೇನೆ, ಓದಿ ಹೇಳುವುದಿಲ್ಲ.'),
  speedSet: (f) => (f ? 'ಸರಿ, ಇನ್ನು ವೇಗವಾಗಿ ಮಾತಾಡುತ್ತೇನೆ.' : 'ಸರಿ, ಇನ್ನು ನಿಧಾನವಾಗಿ ಮಾತಾಡುತ್ತೇನೆ.'),
  shopNameSet: (n) => `ಅಂಗಡಿಯ ಹೆಸರು ${n} ಎಂದು ಇಟ್ಟಿದ್ದೇನೆ.`,
  privacyOpen: () => 'ಗೌಪ್ಯತೆ ಮಾಹಿತಿಯನ್ನು ಪರದೆಯ ಮೇಲೆ ತೆರೆದಿದ್ದೇನೆ.',
  backupReady: () => 'ಬ್ಯಾಕಪ್ ಸಿದ್ಧ, ಉಳಿಸಲು ಬಟನ್ ಒತ್ತಿ.',
  eraseAsk: () => 'ಎಲ್ಲಾ ಡೇಟಾ ಅಳಿಸಬೇಕಾ? ಖಚಿತವಿದ್ದರೆ ಹೌದು ಎಂದು ಹೇಳಿ.',
  eraseTap: () => 'ಸರಿ, ಅಳಿಸಲು ಪರದೆಯ ಮೇಲಿನ ಬಟನ್ ಒತ್ತಿ.',
  awakeHello: () => 'ಹೌದು, ಹೇಳಿ.',
  sleeping: () => 'ಸರಿ, ಬೇಕಾದಾಗ ಕರೆಯಿರಿ.',
}

const TA: Replies = {
  resent: () => 'நெட்வொர்க் துண்டிக்கப்பட்டது, மீண்டும் எழுதுகிறேன்.',
  ack: () => 'எழுதிட்டேன்.',
  disclosure: () => 'வணக்கம்! நான் காதா பாய், ஒரு AI உதவியாளர். உங்கள் கணக்கு இந்த போனில் மட்டுமே இருக்கும். சொல்லுங்கள், யாருக்கு எவ்வளவு எழுதட்டும்?',
  saved: (n, a, d) => `${n}, ${r(a)} ரூபாய் ${d === 'credit' ? 'கடன்' : 'வரவு'}.`,
  savedPromise: (n, a, o) => `${n} ${o <= 0 ? 'இன்று' : o === 1 ? 'நாளை' : `${o} நாளில்`} ${r(a)} ரூபாய் தருவார், நினைவில் வைக்கிறேன்.`,
  newCustomer: (n) => `${n} அவர்களுக்குப் புதிய கணக்கு திறந்தேன்.`,
  confirm: (n, a, d) => `${n}, ${r(a)} ரூபாய் ${d === 'credit' ? 'கடன்' : 'வரவு'}, சரியா?`,
  confirmNew: (n, a, d) => `புதிய வாடிக்கையாளர் ${n}: ${r(a)} ரூபாய் ${d === 'credit' ? 'கடன்' : 'வரவு'}, சரியா?`,
  askAmount: (n) => `${n}, எவ்வளவு ரூபாய்?`,
  noisyConfirm: (n, a, d) => `சத்தம் அதிகம். ${n}, ${r(a)} ரூபாய் ${d === 'credit' ? 'கடன்' : 'வரவு'}, சரியா?`,
  confusable: (a, b) => `${r(a)} ரூபாயா, ${r(b)} ரூபாயா?`,
  askName: (a) => `${r(a)} ரூபாய் யார் பெயரில் எழுதட்டும்?`,
  askDirection: (n, a) => `${n}, ${r(a)} ரூபாய், கடனாகக் கொடுத்ததா, அவர் கட்டியதா?`,
  askWhich: (a, b) => `யார், ${a} அல்லது ${b}?`,
  balance: (n, o) => (o > 0 ? `${n} அவர்களின் மொத்த பாக்கி ${r(o)} ரூபாய்.` : o < 0 ? `${n} அவர்களின் ${r(-o)} ரூபாய் முன்பணம் உங்களிடம் உள்ளது.` : `${n} அவர்களுக்குப் பாக்கி இல்லை.`),
  notFound: (n) => `${n} என்ற பெயரில் கணக்கு இல்லை.`,
  daySummary: (c, p, e) => `இன்று ${e} பதிவுகள்: கடன் ${r(c)} ரூபாய், வரவு ${r(p)} ரூபாய்.`,
  monthSummary: (c, p, e) => `இந்த மாதம் ${e} பதிவுகள்: கடன் ${r(c)} ரூபாய், வரவு ${r(p)} ரூபாய்.`,
  dues: (n, t) => `${n} பேரின் மொத்த பாக்கி ${r(t)} ரூபாய். பட்டியல் திரையில் உள்ளது.`,
  noDues: () => 'இப்போது யாருக்கும் பாக்கி இல்லை.',
  undone: () => 'சரி, கடைசி பதிவை நீக்கினேன்.',
  nothingToUndo: () => 'நீக்க எந்தப் பதிவும் இல்லை.',
  corrected: (n, a, d) => `திருத்தினேன்: ${n}, ${r(a)} ரூபாய் ${d === 'credit' ? 'கடன்' : 'வரவு'}.`,
  notSaved: () => 'சரி, எழுதவில்லை.',
  didNotCatch: () => 'மன்னிக்கவும், புரியவில்லை. மீண்டும் சொல்லுங்கள்.',
  noisyRepeat: () => 'சத்தத்தால் சரியாகக் கேட்கவில்லை. போனை அருகில் வைத்து மீண்டும் சொல்லுங்கள்.',
  privacy: () => 'நான் ஒரு AI உதவியாளர். உங்கள் கணக்கு இந்த போனில் பூட்டி வைக்கப்பட்டுள்ளது. பேச்சை எழுத்தாக்க Gnani சேவையைப் பயன்படுத்துகிறேன், பதிவுகள் வைக்கப்படுவதில்லை. காப்புப்பிரதி உங்கள் விருப்பப்படி, உங்கள் PIN கொண்டு பூட்டி மட்டுமே. "எல்லா தரவையும் அழி" என்றால் அனைத்தும் அழியும்.',
  deleteAsk: () => 'முழுக் கணக்கும் நிரந்தரமாக அழியும். உறுதியா? ஆமாம் அல்லது இல்லை சொல்லுங்கள்.',
  deleted: () => 'எல்லா தரவும் அழிக்கப்பட்டது.',
  remindReady: (n) => `${n} அவர்களுக்கு WhatsApp செய்தி தயார். அனுப்ப பொத்தானை அழுத்துங்கள்.`,
  remindNotAllowed: (n) => `${n} நினைவூட்டலுக்கு ஒப்புதல் தரவில்லை, அதனால் செய்தி உருவாக்கவில்லை.`,
  reminderText: (n, o, s) => `வணக்கம் ${n}, ${s} கடையில் உங்கள் கணக்கில் ${r(o)} ரூபாய் உள்ளது. வசதிப்படும்போது பாருங்கள். நன்றி! (இத்தகைய செய்திகள் வேண்டாமெனில் "நிறுத்து" என்று பதில் அனுப்புங்கள்.)`,
  savedWithBalance: (n, a, d, b) => `${n} அவர்களுக்கு ${r(a)} ரூபாய் ${d === 'credit' ? 'கடன் எழுதிவிட்டேன்' : 'வரவு வைத்தேன்'}. இப்போது ${TA.balance(n, b)}`,
  showCustomer: (n, b, l) => TA.balance(n, b) + (l ? ` கடைசிப் பதிவு ${r(l.amt)} ரூபாய் ${l.dir === 'credit' ? 'கடன்' : 'வரவு'}.` : ''),
  showDues: (c, t) => `இப்போது ${c} பேரின் மொத்த பாக்கி ${r(t)} ரூபாய்.`,
  showHistory: (l, c) => `${l} அவர்களின் ${c} பதிவுகள் திரையில் உள்ளன.`,
  showToday: (c, p) => `இன்று கடன் ${r(c)} ரூபாய், வரவு ${r(p)} ரூபாய்.`,
  searchResult: (t, c) => (c > 0 ? `"${t}" க்கு ${c} முடிவுகள் கிடைத்தன, திரையில் உள்ளன.` : `"${t}" க்கு எதுவும் கிடைக்கவில்லை.`),
  topDebtors: (ns) => (ns.length ? `அதிக பாக்கி உள்ளவர்கள்: ${ns.join(', ')}.` : TA.noDues()),
  closed: () => 'சரி, மூடிவிட்டேன்.',
  customerAdded: (n) => `${n} அவர்களுக்குப் புதிய கணக்கு திறந்துவிட்டேன்.`,
  renamed: (o, n) => `${o} பெயரை ${n} என்று மாற்றிவிட்டேன்.`,
  mergeAsk: (a, b) => `${a} மற்றும் ${b} ஒரே ஆளா? இரண்டு கணக்கையும் ஒன்றாக்கவா?`,
  merged: (a, b) => `${a} மற்றும் ${b} கணக்குகளை ஒன்றாக்கிவிட்டேன்.`,
  phoneSet: (n) => `${n} அவர்களின் போன் நம்பரை எழுதிக்கொண்டேன்.`,
  reminderReady: (n) => `${n} அவர்களுக்கான நினைவூட்டல் செய்தி தயார்.`,
  statementReady: (n) => `${n} அவர்களின் கணக்கு சீட்டு தயார்.`,
  noConsent: (n) => `${n} செய்தி அனுப்ப ஒப்புதல் தரவில்லை, அதனால் அனுப்ப முடியாது.`,
  languageSet: (l) => `சரி, இனி ${l} மொழியில் பேசுகிறேன்.`,
  readBackSet: (on) => (on ? 'சரி, எழுதுவதற்கு முன் படித்துச் சொல்கிறேன்.' : 'சரி, இனி நேராக எழுதுகிறேன், படித்துச் சொல்ல மாட்டேன்.'),
  speedSet: (f) => (f ? 'சரி, இனி வேகமாகப் பேசுகிறேன்.' : 'சரி, இனி மெதுவாகப் பேசுகிறேன்.'),
  shopNameSet: (n) => `கடை பெயரை ${n} என்று வைத்துவிட்டேன்.`,
  privacyOpen: () => 'தனியுரிமை தகவலைத் திரையில் திறந்துள்ளேன்.',
  backupReady: () => 'காப்புப்பிரதி தயார், சேமிக்க பொத்தானை அழுத்துங்கள்.',
  eraseAsk: () => 'எல்லா தரவையும் அழிக்கவா? உறுதியென்றால் ஆமாம் என்று சொல்லுங்கள்.',
  eraseTap: () => 'சரி, அழிக்க திரையில் உள்ள பொத்தானை அழுத்துங்கள்.',
  awakeHello: () => 'ஆமாம், சொல்லுங்கள்.',
  sleeping: () => 'சரி, தேவைப்பட்டால் கூப்பிடுங்கள்.',
}

const TE: Replies = {
  resent: () => 'నెట్‌వర్క్ తెగిపోయింది, మళ్ళీ రాస్తున్నాను.',
  ack: () => 'రాశాను.',
  disclosure: () => 'నమస్కారం! నేను ఖాతా భాయ్, ఒక AI సహాయకురాలిని. మీ లెక్క ఈ ఫోన్‌లోనే ఉంటుంది. చెప్పండి, ఎవరిది ఎంత రాయాలి?',
  saved: (n, a, d) => `${n}, ${r(a)} రూపాయలు ${d === 'credit' ? 'అప్పు' : 'జమ'}.`,
  savedPromise: (n, a, o) => `${n} ${o <= 0 ? 'ఈరోజు' : o === 1 ? 'రేపు' : `${o} రోజుల్లో`} ${r(a)} రూపాయలు ఇస్తారు, గుర్తుంచుకుంటాను.`,
  newCustomer: (n) => `${n} గారికి కొత్త ఖాతా తెరిచాను.`,
  confirm: (n, a, d) => `${n}, ${r(a)} రూపాయలు ${d === 'credit' ? 'అప్పు' : 'జమ'}, సరేనా?`,
  confirmNew: (n, a, d) => `కొత్త కస్టమర్ ${n}: ${r(a)} రూపాయలు ${d === 'credit' ? 'అప్పు' : 'జమ'}, సరేనా?`,
  askAmount: (n) => `${n}, ఎన్ని రూపాయలు?`,
  noisyConfirm: (n, a, d) => `శబ్దం ఎక్కువగా ఉంది. ${n}, ${r(a)} రూపాయలు ${d === 'credit' ? 'అప్పు' : 'జమ'}, సరేనా?`,
  confusable: (a, b) => `${r(a)} రూపాయలా, ${r(b)} రూపాయలా?`,
  askName: (a) => `${r(a)} రూపాయలు ఎవరి పేరు మీద రాయాలి?`,
  askDirection: (n, a) => `${n}, ${r(a)} రూపాయలు, అప్పుగా ఇచ్చారా, వారు కట్టారా?`,
  askWhich: (a, b) => `ఎవరు, ${a} లేదా ${b}?`,
  balance: (n, o) => (o > 0 ? `${n} గారి మొత్తం బాకీ ${r(o)} రూపాయలు.` : o < 0 ? `${n} గారి ${r(-o)} రూపాయల అడ్వాన్స్ మీ దగ్గర ఉంది.` : `${n} గారికి బాకీ ఏమీ లేదు.`),
  notFound: (n) => `${n} పేరుతో ఖాతా దొరకలేదు.`,
  daySummary: (c, p, e) => `ఈరోజు ${e} ఎంట్రీలు: అప్పు ${r(c)} రూపాయలు, జమ ${r(p)} రూపాయలు.`,
  monthSummary: (c, p, e) => `ఈ నెల ${e} ఎంట్రీలు: అప్పు ${r(c)} రూపాయలు, జమ ${r(p)} రూపాయలు.`,
  dues: (n, t) => `${n} మంది మొత్తం బాకీ ${r(t)} రూపాయలు. జాబితా తెరపై ఉంది.`,
  noDues: () => 'ఇప్పుడు ఎవరికీ బాకీ లేదు.',
  undone: () => 'సరే, చివరి ఎంట్రీ తీసేశాను.',
  nothingToUndo: () => 'తీసేయడానికి ఏ ఎంట్రీ లేదు.',
  corrected: (n, a, d) => `సరిచేశాను: ${n}, ${r(a)} రూపాయలు ${d === 'credit' ? 'అప్పు' : 'జమ'}.`,
  notSaved: () => 'సరే, రాయలేదు.',
  didNotCatch: () => 'క్షమించండి, అర్థం కాలేదు. మళ్ళీ చెప్పండి.',
  noisyRepeat: () => 'శబ్దం వల్ల సరిగా వినిపించలేదు. ఫోన్ దగ్గర పెట్టి మళ్ళీ చెప్పండి.',
  privacy: () => 'నేను ఒక AI సహాయకురాలిని. మీ ఖాతా ఈ ఫోన్‌లోనే తాళం వేసి ఉంటుంది. మాటను రాతగా మార్చడానికి Gnani సేవను వాడతాను, రికార్డింగ్‌లు ఉంచను. బ్యాకప్ మీ ఇష్టంతో, మీ PIN తో తాళం వేసి మాత్రమే. "మొత్తం డేటా తొలగించు" అంటే అంతా తొలగిపోతుంది.',
  deleteAsk: () => 'మొత్తం ఖాతా శాశ్వతంగా తొలగిపోతుంది. ఖచ్చితమా? అవును లేదా కాదు చెప్పండి.',
  deleted: () => 'మొత్తం డేటా తొలగించాను.',
  remindReady: (n) => `${n} గారికి WhatsApp సందేశం సిద్ధం. పంపడానికి బటన్ నొక్కండి.`,
  remindNotAllowed: (n) => `${n} గారు రిమైండర్‌కు అనుమతి ఇవ్వలేదు, అందుకే సందేశం చేయలేదు.`,
  reminderText: (n, o, s) => `నమస్కారం ${n} గారు, ${s} లో మీ ఖాతాలో ${r(o)} రూపాయలు ఉన్నాయి. వీలైనప్పుడు చూడండి. ధన్యవాదాలు! (ఇలాంటి సందేశాలు వద్దంటే "ఆపండి" అని జవాబివ్వండి.)`,
  savedWithBalance: (n, a, d, b) => `${n} గారి ${r(a)} రూపాయలు ${d === 'credit' ? 'అప్పుగా రాశాను' : 'జమ చేశాను'}. ఇప్పుడు ${TE.balance(n, b)}`,
  showCustomer: (n, b, l) => TE.balance(n, b) + (l ? ` చివరి ఎంట్రీ ${r(l.amt)} రూపాయలు ${l.dir === 'credit' ? 'అప్పు' : 'జమ'}.` : ''),
  showDues: (c, t) => `ఇప్పుడు ${c} మంది మొత్తం బాకీ ${r(t)} రూపాయలు.`,
  showHistory: (l, c) => `${l} గారి ${c} ఎంట్రీలు తెరపై ఉన్నాయి.`,
  showToday: (c, p) => `ఈరోజు అప్పు ${r(c)} రూపాయలు, జమ ${r(p)} రూపాయలు.`,
  searchResult: (t, c) => (c > 0 ? `"${t}" కి ${c} ఫలితాలు దొరికాయి, తెరపై ఉన్నాయి.` : `"${t}" కి ఏమీ దొరకలేదు.`),
  topDebtors: (ns) => (ns.length ? `ఎక్కువ బాకీ ఉన్నవారు: ${ns.join(', ')}.` : TE.noDues()),
  closed: () => 'సరే, మూసేశాను.',
  customerAdded: (n) => `${n} గారికి కొత్త ఖాతా తెరిచాను.`,
  renamed: (o, n) => `${o} పేరును ${n} గా మార్చాను.`,
  mergeAsk: (a, b) => `${a}, ${b} ఒకరేనా? రెండు ఖాతాలను ఒకటి చేయనా?`,
  merged: (a, b) => `${a}, ${b} ఖాతాలను ఒకటి చేశాను.`,
  phoneSet: (n) => `${n} గారి ఫోన్ నంబర్ రాసుకున్నాను.`,
  reminderReady: (n) => `${n} గారికి రిమైండర్ సందేశం సిద్ధం.`,
  statementReady: (n) => `${n} గారి లెక్క చిట్టా సిద్ధం.`,
  noConsent: (n) => `${n} గారు సందేశాలకు అనుమతి ఇవ్వలేదు, అందుకే పంపలేను.`,
  languageSet: (l) => `సరే, ఇకపై ${l} లో మాట్లాడతాను.`,
  readBackSet: (on) => (on ? 'సరే, రాసే ముందు చదివి వినిపిస్తాను.' : 'సరే, ఇకపై నేరుగా రాస్తాను, చదివి వినిపించను.'),
  speedSet: (f) => (f ? 'సరే, ఇకపై వేగంగా మాట్లాడతాను.' : 'సరే, ఇకపై నెమ్మదిగా మాట్లాడతాను.'),
  shopNameSet: (n) => `షాప్ పేరును ${n} గా పెట్టాను.`,
  privacyOpen: () => 'ప్రైవసీ వివరాలను తెరపై తెరిచాను.',
  backupReady: () => 'బ్యాకప్ సిద్ధం, సేవ్ చేయడానికి బటన్ నొక్కండి.',
  eraseAsk: () => 'మొత్తం డేటా తొలగించాలా? ఖచ్చితమైతే అవును అని చెప్పండి.',
  eraseTap: () => 'సరే, తొలగించడానికి తెరపై బటన్ నొక్కండి.',
  awakeHello: () => 'అవును, చెప్పండి.',
  sleeping: () => 'సరే, అవసరమైతే పిలవండి.',
}

const ML: Replies = {
  resent: () => 'നെറ്റ്‌വർക്ക് മുറിഞ്ഞു, വീണ്ടും എഴുതുന്നു.',
  ack: () => 'എഴുതി.',
  disclosure: () => 'നമസ്കാരം! ഞാൻ ഖാത ഭായ്, ഒരു AI സഹായി. നിങ്ങളുടെ കണക്ക് ഈ ഫോണിൽ മാത്രമേ ഉള്ളൂ. പറയൂ, ആരുടെ എത്ര എഴുതണം?',
  saved: (n, a, d) => `${n}, ${r(a)} രൂപ ${d === 'credit' ? 'കടം' : 'വരവ്'}.`,
  savedPromise: (n, a, o) => `${n} ${o <= 0 ? 'ഇന്ന്' : o === 1 ? 'നാളെ' : `${o} ദിവസത്തിനുള്ളിൽ`} ${r(a)} രൂപ തരും, ഓർത്തുവെക്കാം.`,
  newCustomer: (n) => `${n} എന്നയാൾക്ക് പുതിയ കണക്ക് തുറന്നു.`,
  confirm: (n, a, d) => `${n}, ${r(a)} രൂപ ${d === 'credit' ? 'കടം' : 'വരവ്'}, ശരിയാണോ?`,
  confirmNew: (n, a, d) => `പുതിയ ഉപഭോക്താവ് ${n}: ${r(a)} രൂപ ${d === 'credit' ? 'കടം' : 'വരവ്'}, ശരിയാണോ?`,
  askAmount: (n) => `${n}, എത്ര രൂപ?`,
  noisyConfirm: (n, a, d) => `ശബ്ദം കൂടുതലാണ്. ${n}, ${r(a)} രൂപ ${d === 'credit' ? 'കടം' : 'വരവ്'}, ശരിയാണോ?`,
  confusable: (a, b) => `${r(a)} രൂപയോ ${r(b)} രൂപയോ?`,
  askName: (a) => `${r(a)} രൂപ ആരുടെ പേരിൽ എഴുതണം?`,
  askDirection: (n, a) => `${n}, ${r(a)} രൂപ, കടം കൊടുത്തതാണോ അതോ തിരിച്ചടച്ചതാണോ?`,
  askWhich: (a, b) => `ആര്, ${a} ആണോ ${b} ആണോ?`,
  balance: (n, o) => (o > 0 ? `${n} ന്റെ ആകെ ബാക്കി ${r(o)} രൂപ.` : o < 0 ? `${n} ന്റെ ${r(-o)} രൂപ മുൻകൂർ നിങ്ങളുടെ കൈയിലുണ്ട്.` : `${n} ന് ബാക്കി ഒന്നുമില്ല.`),
  notFound: (n) => `${n} എന്ന പേരിൽ കണക്കില്ല.`,
  daySummary: (c, p, e) => `ഇന്ന് ${e} എൻട്രികൾ: കടം ${r(c)} രൂപ, വരവ് ${r(p)} രൂപ.`,
  monthSummary: (c, p, e) => `ഈ മാസം ${e} എൻട്രികൾ: കടം ${r(c)} രൂപ, വരവ് ${r(p)} രൂപ.`,
  dues: (n, t) => `${n} പേരുടെ ആകെ ബാക്കി ${r(t)} രൂപ. പട്ടിക സ്ക്രീനിലുണ്ട്.`,
  noDues: () => 'ഇപ്പോൾ ആർക്കും ബാക്കിയില്ല.',
  undone: () => 'ശരി, അവസാനത്തെ എൻട്രി മാറ്റി.',
  nothingToUndo: () => 'മാറ്റാൻ എൻട്രി ഒന്നുമില്ല.',
  corrected: (n, a, d) => `തിരുത്തി: ${n}, ${r(a)} രൂപ ${d === 'credit' ? 'കടം' : 'വരവ്'}.`,
  notSaved: () => 'ശരി, എഴുതിയില്ല.',
  didNotCatch: () => 'ക്ഷമിക്കണം, മനസ്സിലായില്ല. ഒന്നുകൂടി പറയൂ.',
  noisyRepeat: () => 'ശബ്ദം കാരണം ശരിയായി കേട്ടില്ല. ഫോൺ അടുത്തുവെച്ച് വീണ്ടും പറയൂ.',
  privacy: () => 'ഞാൻ ഒരു AI സഹായി ആണ്. നിങ്ങളുടെ കണക്ക് ഈ ഫോണിൽ പൂട്ടിവെച്ചിരിക്കുന്നു. സംസാരം എഴുത്താക്കാൻ Gnani സേവനം ഉപയോഗിക്കുന്നു, റെക്കോർഡിംഗ് സൂക്ഷിക്കുന്നില്ല. ബാക്കപ്പ് നിങ്ങളുടെ ഇഷ്ടപ്രകാരം, PIN കൊണ്ട് പൂട്ടി മാത്രം. "എല്ലാ ഡാറ്റയും മായ്ക്കൂ" എന്ന് പറഞ്ഞാൽ എല്ലാം മായും.',
  deleteAsk: () => 'മുഴുവൻ കണക്കും എന്നന്നേക്കുമായി മായും. ഉറപ്പാണോ? അതെ അല്ലെങ്കിൽ ഇല്ല എന്ന് പറയൂ.',
  deleted: () => 'എല്ലാ ഡാറ്റയും മായ്ച്ചു.',
  remindReady: (n) => `${n} ന് WhatsApp സന്ദേശം തയ്യാർ. അയക്കാൻ ബട്ടൺ അമർത്തൂ.`,
  remindNotAllowed: (n) => `${n} ഓർമ്മപ്പെടുത്തലിന് സമ്മതം നൽകിയിട്ടില്ല, അതിനാൽ സന്ദേശം ഉണ്ടാക്കിയില്ല.`,
  reminderText: (n, o, s) => `നമസ്കാരം ${n}, ${s} ൽ നിങ്ങളുടെ കണക്കിൽ ${r(o)} രൂപയുണ്ട്. സൗകര്യം പോലെ നോക്കൂ. നന്ദി! (ഇത്തരം സന്ദേശങ്ങൾ വേണ്ടെങ്കിൽ "നിർത്തൂ" എന്ന് മറുപടി അയക്കൂ.)`,
  savedWithBalance: (n, a, d, b) => `${n} ന്റെ ${r(a)} രൂപ ${d === 'credit' ? 'കടമായി എഴുതി' : 'വരവ് വെച്ചു'}. ഇപ്പോൾ ${ML.balance(n, b)}`,
  showCustomer: (n, b, l) => ML.balance(n, b) + (l ? ` അവസാന എൻട്രി ${r(l.amt)} രൂപ ${l.dir === 'credit' ? 'കടം' : 'വരവ്'}.` : ''),
  showDues: (c, t) => `ഇപ്പോൾ ${c} പേരുടെ ആകെ ബാക്കി ${r(t)} രൂപ.`,
  showHistory: (l, c) => `${l} ന്റെ ${c} എൻട്രികൾ സ്ക്രീനിലുണ്ട്.`,
  showToday: (c, p) => `ഇന്ന് കടം ${r(c)} രൂപ, വരവ് ${r(p)} രൂപ.`,
  searchResult: (t, c) => (c > 0 ? `"${t}" ന് ${c} ഫലങ്ങൾ കിട്ടി, സ്ക്രീനിലുണ്ട്.` : `"${t}" ന് ഒന്നും കിട്ടിയില്ല.`),
  topDebtors: (ns) => (ns.length ? `കൂടുതൽ ബാക്കിയുള്ളവർ: ${ns.join(', ')}.` : ML.noDues()),
  closed: () => 'ശരി, അടച്ചു.',
  customerAdded: (n) => `${n} എന്നയാൾക്ക് പുതിയ കണക്ക് തുറന്നു.`,
  renamed: (o, n) => `${o} എന്ന പേര് ${n} എന്നാക്കി മാറ്റി.`,
  mergeAsk: (a, b) => `${a} ഉം ${b} ഉം ഒരാളാണോ? രണ്ടു കണക്കും ഒന്നാക്കട്ടെ?`,
  merged: (a, b) => `${a} ഉം ${b} ഉം കണക്കുകൾ ഒന്നാക്കി.`,
  phoneSet: (n) => `${n} ന്റെ ഫോൺ നമ്പർ എഴുതിവെച്ചു.`,
  reminderReady: (n) => `${n} ന് ഓർമ്മപ്പെടുത്തൽ സന്ദേശം തയ്യാർ.`,
  statementReady: (n) => `${n} ന്റെ കണക്ക് സ്ലിപ്പ് തയ്യാർ.`,
  noConsent: (n) => `${n} സന്ദേശത്തിന് സമ്മതം നൽകിയിട്ടില്ല, അതിനാൽ അയക്കാനാവില്ല.`,
  languageSet: (l) => `ശരി, ഇനി ${l} ൽ സംസാരിക്കാം.`,
  readBackSet: (on) => (on ? 'ശരി, എഴുതുന്നതിനു മുൻപ് വായിച്ചു കേൾപ്പിക്കാം.' : 'ശരി, ഇനി നേരെ എഴുതാം, വായിച്ചു കേൾപ്പിക്കില്ല.'),
  speedSet: (f) => (f ? 'ശരി, ഇനി വേഗത്തിൽ സംസാരിക്കാം.' : 'ശരി, ഇനി പതുക്കെ സംസാരിക്കാം.'),
  shopNameSet: (n) => `കടയുടെ പേര് ${n} എന്നാക്കി.`,
  privacyOpen: () => 'സ്വകാര്യതാ വിവരങ്ങൾ സ്ക്രീനിൽ തുറന്നിട്ടുണ്ട്.',
  backupReady: () => 'ബാക്കപ്പ് തയ്യാർ, സേവ് ചെയ്യാൻ ബട്ടൺ അമർത്തൂ.',
  eraseAsk: () => 'എല്ലാ ഡാറ്റയും മായ്ക്കണോ? ഉറപ്പാണെങ്കിൽ അതെ എന്ന് പറയൂ.',
  eraseTap: () => 'ശരി, മായ്ക്കാൻ സ്ക്രീനിലെ ബട്ടൺ അമർത്തൂ.',
  awakeHello: () => 'അതെ, പറയൂ.',
  sleeping: () => 'ശരി, വേണമെങ്കിൽ വിളിക്കൂ.',
}

const MR: Replies = {
  resent: () => 'नेटवर्क तुटले होते, पुन्हा लिहितो.',
  ack: () => 'लिहिलं.',
  disclosure: () => 'नमस्कार! मी खाता भाई, एक AI सहाय्यक. तुमचा हिशोब फक्त याच फोनवर राहतो. सांगा, कोणाचे किती लिहू?',
  saved: (n, a, d) => `${n}, ${r(a)} रुपये ${d === 'credit' ? 'उधार' : 'जमा'}.`,
  savedPromise: (n, a, o) => `${n} ${o <= 0 ? 'आज' : o === 1 ? 'उद्या' : `${o} दिवसांत`} ${r(a)} रुपये देतील, लक्षात ठेवते.`,
  newCustomer: (n) => `${n} यांचे नवीन खाते उघडले.`,
  confirm: (n, a, d) => `${n}, ${r(a)} रुपये ${d === 'credit' ? 'उधार' : 'जमा'}, बरोबर?`,
  confirmNew: (n, a, d) => `नवीन ग्राहक ${n}: ${r(a)} रुपये ${d === 'credit' ? 'उधार' : 'जमा'}, बरोबर?`,
  askAmount: (n) => `${n}, किती रुपये?`,
  noisyConfirm: (n, a, d) => `खूप गोंगाट आहे. ${n}, ${r(a)} रुपये ${d === 'credit' ? 'उधार' : 'जमा'}, बरोबर?`,
  confusable: (a, b) => `${r(a)} रुपये की ${r(b)} रुपये?`,
  askName: (a) => `${r(a)} रुपये कोणाच्या नावावर लिहू?`,
  askDirection: (n, a) => `${n}, ${r(a)} रुपये, उधार दिले की त्यांनी जमा केले?`,
  askWhich: (a, b) => `कोण, ${a} की ${b}?`,
  balance: (n, o) => (o > 0 ? `${n} यांची एकूण बाकी ${r(o)} रुपये.` : o < 0 ? `${n} यांचे ${r(-o)} रुपये आगाऊ तुमच्याकडे आहेत.` : `${n} यांची काहीही बाकी नाही.`),
  notFound: (n) => `${n} नावाचे खाते सापडले नाही.`,
  daySummary: (c, p, e) => `आज ${e} नोंदी: उधार ${r(c)} रुपये, जमा ${r(p)} रुपये.`,
  monthSummary: (c, p, e) => `या महिन्यात ${e} नोंदी: उधार ${r(c)} रुपये, जमा ${r(p)} रुपये.`,
  dues: (n, t) => `${n} जणांची एकूण बाकी ${r(t)} रुपये. यादी स्क्रीनवर आहे.`,
  noDues: () => 'सध्या कोणाचीही बाकी नाही.',
  undone: () => 'ठीक आहे, शेवटची नोंद काढली.',
  nothingToUndo: () => 'काढण्यासाठी कोणतीही नोंद नाही.',
  corrected: (n, a, d) => `दुरुस्त केले: ${n}, ${r(a)} रुपये ${d === 'credit' ? 'उधार' : 'जमा'}.`,
  notSaved: () => 'ठीक आहे, लिहिले नाही.',
  didNotCatch: () => 'माफ करा, समजले नाही. पुन्हा सांगा.',
  noisyRepeat: () => 'गोंगाटामुळे नीट ऐकू आले नाही. फोन जवळ धरून पुन्हा सांगा.',
  privacy: () => 'मी एक AI सहाय्यक आहे. तुमचे खाते याच फोनवर कुलूपबंद असते. आवाजाचे लिखाण करण्यासाठी Gnani ची सेवा वापरली जाते, रेकॉर्डिंग ठेवले जात नाही. बॅकअप फक्त तुमच्या इच्छेने, तुमच्या PIN ने बंद करून. "सगळा डेटा पुसून टाक" म्हटल्यास सर्व पुसले जाईल.',
  deleteAsk: () => 'संपूर्ण खाते कायमचे पुसले जाईल. नक्की? हो किंवा नाही सांगा.',
  deleted: () => 'सगळा डेटा पुसला.',
  remindReady: (n) => `${n} यांच्यासाठी WhatsApp संदेश तयार आहे. पाठवण्यासाठी बटण दाबा.`,
  remindNotAllowed: (n) => `${n} यांनी आठवणीसाठी परवानगी दिलेली नाही, म्हणून संदेश बनवला नाही.`,
  reminderText: (n, o, s) => `नमस्कार ${n}, ${s} येथे तुमचा ${r(o)} रुपयांचा हिशोब आहे. सोयीने पाहा. धन्यवाद! (असे संदेश नको असल्यास "बंद" लिहा.)`,
  savedWithBalance: (n, a, d, b) => `${n} यांचे ${r(a)} रुपये ${d === 'credit' ? 'उधार लिहिले' : 'जमा केले'}. आता ${MR.balance(n, b)}`,
  showCustomer: (n, b, l) => MR.balance(n, b) + (l ? ` शेवटची नोंद ${r(l.amt)} रुपये ${l.dir === 'credit' ? 'उधार' : 'जमा'}.` : ''),
  showDues: (c, t) => `सध्या ${c} जणांची एकूण बाकी ${r(t)} रुपये आहे.`,
  showHistory: (l, c) => `${l} यांच्या ${c} नोंदी स्क्रीनवर आहेत.`,
  showToday: (c, p) => `आज उधार ${r(c)} रुपये, जमा ${r(p)} रुपये.`,
  searchResult: (t, c) => (c > 0 ? `"${t}" साठी ${c} निकाल सापडले, स्क्रीनवर आहेत.` : `"${t}" साठी काही सापडले नाही.`),
  topDebtors: (ns) => (ns.length ? `जास्त बाकी असलेले: ${ns.join(', ')}.` : MR.noDues()),
  closed: () => 'ठीक आहे, बंद केले.',
  customerAdded: (n) => `${n} यांचे नवीन खाते उघडले.`,
  renamed: (o, n) => `${o} यांचे नाव बदलून ${n} केले.`,
  mergeAsk: (a, b) => `${a} आणि ${b} एकच आहेत का? दोन्ही खाती एक करू?`,
  merged: (a, b) => `${a} आणि ${b} यांची खाती एक केली.`,
  phoneSet: (n) => `${n} यांचा फोन नंबर लिहून घेतला.`,
  reminderReady: (n) => `${n} यांच्यासाठी आठवण संदेश तयार आहे.`,
  statementReady: (n) => `${n} यांची हिशोब पावती तयार आहे.`,
  noConsent: (n) => `${n} यांनी संदेशासाठी परवानगी दिलेली नाही, म्हणून पाठवता येणार नाही.`,
  languageSet: (l) => `ठीक आहे, आता ${l} मध्ये बोलेन.`,
  readBackSet: (on) => (on ? 'ठीक आहे, लिहिण्यापूर्वी वाचून दाखवेन.' : 'ठीक आहे, आता थेट लिहीन, वाचून दाखवणार नाही.'),
  speedSet: (f) => (f ? 'ठीक आहे, आता वेगात बोलेन.' : 'ठीक आहे, आता हळू बोलेन.'),
  shopNameSet: (n) => `दुकानाचे नाव ${n} ठेवले.`,
  privacyOpen: () => 'गोपनीयतेची माहिती स्क्रीनवर उघडली आहे.',
  backupReady: () => 'बॅकअप तयार आहे, सेव्ह करण्यासाठी बटण दाबा.',
  eraseAsk: () => 'सगळा डेटा पुसायचा आहे का? नक्की असेल तर हो म्हणा.',
  eraseTap: () => 'ठीक आहे, पुसण्यासाठी स्क्रीनवरचे बटण दाबा.',
  awakeHello: () => 'हो, बोला.',
  sleeping: () => 'ठीक आहे, लागल्यास हाक मारा.',
}

const BN: Replies = {
  resent: () => 'নেটওয়ার্ক কেটে গিয়েছিল, আবার লিখছি।',
  ack: () => 'লিখে নিলাম।',
  disclosure: () => 'নমস্কার! আমি খাতা ভাই, একজন AI সহায়ক। আপনার হিসাব শুধু এই ফোনেই থাকে। বলুন, কার কত লিখব?',
  saved: (n, a, d) => `${n}, ${r(a)} টাকা ${d === 'credit' ? 'বাকি' : 'জমা'}।`,
  savedPromise: (n, a, o) => `${n} ${o <= 0 ? 'আজ' : o === 1 ? 'কাল' : `${o} দিনের মধ্যে`} ${r(a)} টাকা দেবেন, মনে রাখব।`,
  newCustomer: (n) => `${n}-এর নতুন খাতা খুললাম।`,
  confirm: (n, a, d) => `${n}, ${r(a)} টাকা ${d === 'credit' ? 'বাকি' : 'জমা'}, ঠিক তো?`,
  confirmNew: (n, a, d) => `নতুন খদ্দের ${n}: ${r(a)} টাকা ${d === 'credit' ? 'বাকি' : 'জমা'}, ঠিক তো?`,
  askAmount: (n) => `${n}, কত টাকা?`,
  noisyConfirm: (n, a, d) => `খুব আওয়াজ। ${n}, ${r(a)} টাকা ${d === 'credit' ? 'বাকি' : 'জমা'}, ঠিক তো?`,
  confusable: (a, b) => `${r(a)} টাকা না ${r(b)} টাকা?`,
  askName: (a) => `${r(a)} টাকা কার নামে লিখব?`,
  askDirection: (n, a) => `${n}, ${r(a)} টাকা, বাকিতে দিলেন না উনি জমা দিলেন?`,
  askWhich: (a, b) => `কে, ${a} না ${b}?`,
  balance: (n, o) => (o > 0 ? `${n}-এর মোট বাকি ${r(o)} টাকা।` : o < 0 ? `${n}-এর ${r(-o)} টাকা অগ্রিম আপনার কাছে আছে।` : `${n}-এর কোনো বাকি নেই।`),
  notFound: (n) => `${n} নামে কোনো খাতা পাইনি।`,
  daySummary: (c, p, e) => `আজ ${e}টি এন্ট্রি: বাকি ${r(c)} টাকা, জমা ${r(p)} টাকা।`,
  monthSummary: (c, p, e) => `এই মাসে ${e}টি এন্ট্রি: বাকি ${r(c)} টাকা, জমা ${r(p)} টাকা।`,
  dues: (n, t) => `${n} জনের মোট বাকি ${r(t)} টাকা। তালিকা স্ক্রিনে আছে।`,
  noDues: () => 'এখন কারও কিছু বাকি নেই।',
  undone: () => 'ঠিক আছে, শেষ এন্ট্রি মুছে দিলাম।',
  nothingToUndo: () => 'মোছার মতো কোনো এন্ট্রি নেই।',
  corrected: (n, a, d) => `ঠিক করলাম: ${n}, ${r(a)} টাকা ${d === 'credit' ? 'বাকি' : 'জমা'}।`,
  notSaved: () => 'ঠিক আছে, লিখলাম না।',
  didNotCatch: () => 'দুঃখিত, বুঝতে পারিনি। আবার বলুন।',
  noisyRepeat: () => 'আওয়াজের জন্য ঠিকমতো শুনতে পাইনি। ফোন কাছে রেখে আবার বলুন।',
  privacy: () => 'আমি একজন AI সহায়ক। আপনার খাতা এই ফোনেই তালাবন্ধ থাকে। কথাকে লেখায় বদলাতে Gnani-র পরিষেবা ব্যবহার হয়, রেকর্ডিং রাখা হয় না। ব্যাকআপ শুধু আপনি চাইলে, আপনার PIN দিয়ে তালাবন্ধ করে। "সব ডেটা মুছে দাও" বললে সব মুছে যাবে।',
  deleteAsk: () => 'পুরো খাতা চিরতরে মুছে যাবে। নিশ্চিত? হ্যাঁ বা না বলুন।',
  deleted: () => 'সব ডেটা মুছে দিলাম।',
  remindReady: (n) => `${n}-এর জন্য WhatsApp বার্তা তৈরি। পাঠাতে বোতাম টিপুন।`,
  remindNotAllowed: (n) => `${n} মনে করানোর অনুমতি দেননি, তাই বার্তা বানাইনি।`,
  reminderText: (n, o, s) => `নমস্কার ${n}, ${s}-এ আপনার হিসাবে ${r(o)} টাকা আছে। সুবিধামতো দেখে নেবেন। ধন্যবাদ! (এমন বার্তা না চাইলে "বন্ধ" লিখুন।)`,
  savedWithBalance: (n, a, d, b) => `${n}-এর ${r(a)} টাকা ${d === 'credit' ? 'বাকি লিখে নিলাম' : 'জমা করে নিলাম'}। এখন ${BN.balance(n, b)}`,
  showCustomer: (n, b, l) => BN.balance(n, b) + (l ? ` শেষ এন্ট্রি ${r(l.amt)} টাকা ${l.dir === 'credit' ? 'বাকি' : 'জমা'}।` : ''),
  showDues: (c, t) => `এখন ${c} জনের মোট বাকি ${r(t)} টাকা।`,
  showHistory: (l, c) => `${l}-এর ${c}টি এন্ট্রি স্ক্রিনে আছে।`,
  showToday: (c, p) => `আজ বাকি ${r(c)} টাকা, জমা ${r(p)} টাকা।`,
  searchResult: (t, c) => (c > 0 ? `"${t}"-এর জন্য ${c}টি ফল পেয়েছি, স্ক্রিনে আছে।` : `"${t}"-এর জন্য কিছু পাইনি।`),
  topDebtors: (ns) => (ns.length ? `বেশি বাকি যাঁদের: ${ns.join(', ')}।` : BN.noDues()),
  closed: () => 'ঠিক আছে, বন্ধ করে দিলাম।',
  customerAdded: (n) => `${n}-এর নতুন খাতা খুলে দিলাম।`,
  renamed: (o, n) => `${o}-এর নাম বদলে ${n} করে দিলাম।`,
  mergeAsk: (a, b) => `${a} আর ${b} কি একই মানুষ? দুটো খাতা এক করে দেব?`,
  merged: (a, b) => `${a} আর ${b}-এর খাতা এক করে দিলাম।`,
  phoneSet: (n) => `${n}-এর ফোন নম্বর লিখে নিলাম।`,
  reminderReady: (n) => `${n}-এর জন্য মনে করানোর বার্তা তৈরি।`,
  statementReady: (n) => `${n}-এর হিসাবের কাগজ তৈরি।`,
  noConsent: (n) => `${n} বার্তা পাঠানোর অনুমতি দেননি, তাই পাঠাতে পারব না।`,
  languageSet: (l) => `ঠিক আছে, এবার থেকে ${l}-তে কথা বলব।`,
  readBackSet: (on) => (on ? 'ঠিক আছে, লেখার আগে পড়ে শোনাব।' : 'ঠিক আছে, এবার সরাসরি লিখব, পড়ে শোনাব না।'),
  speedSet: (f) => (f ? 'ঠিক আছে, এবার তাড়াতাড়ি বলব।' : 'ঠিক আছে, এবার ধীরে বলব।'),
  shopNameSet: (n) => `দোকানের নাম ${n} রাখলাম।`,
  privacyOpen: () => 'গোপনীয়তার তথ্য স্ক্রিনে খুলে দিয়েছি।',
  backupReady: () => 'ব্যাকআপ তৈরি, সেভ করতে বোতাম টিপুন।',
  eraseAsk: () => 'সব ডেটা মুছে দেব? নিশ্চিত হলে হ্যাঁ বলুন।',
  eraseTap: () => 'ঠিক আছে, মোছার জন্য স্ক্রিনের বোতাম টিপুন।',
  awakeHello: () => 'হ্যাঁ, বলুন।',
  sleeping: () => 'ঠিক আছে, দরকার হলে ডাকবেন।',
}

const GU: Replies = {
  resent: () => 'નેટવર્ક તૂટી ગયું હતું, ફરી લખું છું.',
  ack: () => 'લખી દીધું.',
  disclosure: () => 'નમસ્તે! હું ખાતા ભાઈ છું, એક AI સહાયક. તમારો હિસાબ ફક્ત આ ફોનમાં જ રહે છે. બોલો, કોનું કેટલું લખું?',
  saved: (n, a, d) => `${n}, ${r(a)} રૂપિયા ${d === 'credit' ? 'ઉધાર' : 'જમા'}.`,
  savedPromise: (n, a, o) => `${n} ${o <= 0 ? 'આજે' : o === 1 ? 'કાલે' : `${o} દિવસમાં`} ${r(a)} રૂપિયા આપશે, યાદ રાખીશ.`,
  newCustomer: (n) => `${n}નું નવું ખાતું ખોલ્યું.`,
  confirm: (n, a, d) => `${n}, ${r(a)} રૂપિયા ${d === 'credit' ? 'ઉધાર' : 'જમા'}, બરાબર?`,
  confirmNew: (n, a, d) => `નવા ગ્રાહક ${n}: ${r(a)} રૂપિયા ${d === 'credit' ? 'ઉધાર' : 'જમા'}, બરાબર?`,
  askAmount: (n) => `${n}, કેટલા રૂપિયા?`,
  noisyConfirm: (n, a, d) => `ઘોંઘાટ વધારે છે. ${n}, ${r(a)} રૂપિયા ${d === 'credit' ? 'ઉધાર' : 'જમા'}, બરાબર?`,
  confusable: (a, b) => `${r(a)} રૂપિયા કે ${r(b)} રૂપિયા?`,
  askName: (a) => `${r(a)} રૂપિયા કોના નામે લખું?`,
  askDirection: (n, a) => `${n}, ${r(a)} રૂપિયા, ઉધાર આપ્યા કે તેમણે જમા કર્યા?`,
  askWhich: (a, b) => `કોણ, ${a} કે ${b}?`,
  balance: (n, o) => (o > 0 ? `${n}ની કુલ બાકી ${r(o)} રૂપિયા છે.` : o < 0 ? `${n}ના ${r(-o)} રૂપિયા એડવાન્સ તમારી પાસે છે.` : `${n}ની કોઈ બાકી નથી.`),
  notFound: (n) => `${n} નામનું કોઈ ખાતું મળ્યું નહીં.`,
  daySummary: (c, p, e) => `આજે ${e} એન્ટ્રી: ઉધાર ${r(c)} રૂપિયા, જમા ${r(p)} રૂપિયા.`,
  monthSummary: (c, p, e) => `આ મહિને ${e} એન્ટ્રી: ઉધાર ${r(c)} રૂપિયા, જમા ${r(p)} રૂપિયા.`,
  dues: (n, t) => `${n} લોકોની કુલ બાકી ${r(t)} રૂપિયા. યાદી સ્ક્રીન પર છે.`,
  noDues: () => 'અત્યારે કોઈની બાકી નથી.',
  undone: () => 'બરાબર, છેલ્લી એન્ટ્રી કાઢી નાખી.',
  nothingToUndo: () => 'કાઢવા માટે કોઈ એન્ટ્રી નથી.',
  corrected: (n, a, d) => `સુધાર્યું: ${n}, ${r(a)} રૂપિયા ${d === 'credit' ? 'ઉધાર' : 'જમા'}.`,
  notSaved: () => 'બરાબર, ન લખ્યું.',
  didNotCatch: () => 'માફ કરશો, સમજાયું નહીં. ફરી બોલો.',
  noisyRepeat: () => 'ઘોંઘાટને કારણે બરાબર સંભળાયું નહીં. ફોન નજીક રાખીને ફરી બોલો.',
  privacy: () => 'હું એક AI સહાયક છું. તમારું ખાતું આ ફોનમાં તાળું મારીને રહે છે. અવાજને લખાણમાં ફેરવવા Gnaniની સેવા વપરાય છે, રેકોર્ડિંગ રાખવામાં આવતું નથી. બેકઅપ ફક્ત તમારી મરજીથી, તમારા PINથી બંધ કરીને. "બધો ડેટા ભૂંસી નાખો" કહેશો તો બધું ભૂંસાઈ જશે.',
  deleteAsk: () => 'આખું ખાતું કાયમ માટે ભૂંસાઈ જશે. પાકું? હા કે ના બોલો.',
  deleted: () => 'બધો ડેટા ભૂંસી નાખ્યો.',
  remindReady: (n) => `${n} માટે WhatsApp સંદેશ તૈયાર છે. મોકલવા બટન દબાવો.`,
  remindNotAllowed: (n) => `${n}એ યાદ અપાવવાની મંજૂરી આપી નથી, એટલે સંદેશ બનાવ્યો નથી.`,
  reminderText: (n, o, s) => `નમસ્તે ${n}, ${s} પર તમારો ${r(o)} રૂપિયાનો હિસાબ છે. અનુકૂળતાએ જોઈ લેજો. આભાર! (આવા સંદેશ ન જોઈએ તો "બંધ" લખો.)`,
  savedWithBalance: (n, a, d, b) => `${n}ના ${r(a)} રૂપિયા ${d === 'credit' ? 'ઉધાર લખ્યા' : 'જમા કર્યા'}. હવે ${GU.balance(n, b)}`,
  showCustomer: (n, b, l) => GU.balance(n, b) + (l ? ` છેલ્લી એન્ટ્રી ${r(l.amt)} રૂપિયા ${l.dir === 'credit' ? 'ઉધાર' : 'જમા'}.` : ''),
  showDues: (c, t) => `અત્યારે ${c} લોકોની કુલ બાકી ${r(t)} રૂપિયા છે.`,
  showHistory: (l, c) => `${l}ની ${c} એન્ટ્રી સ્ક્રીન પર છે.`,
  showToday: (c, p) => `આજે ઉધાર ${r(c)} રૂપિયા, જમા ${r(p)} રૂપિયા.`,
  searchResult: (t, c) => (c > 0 ? `"${t}" માટે ${c} પરિણામ મળ્યા, સ્ક્રીન પર છે.` : `"${t}" માટે કંઈ મળ્યું નહીં.`),
  topDebtors: (ns) => (ns.length ? `વધારે બાકી હોય તેવા: ${ns.join(', ')}.` : GU.noDues()),
  closed: () => 'બરાબર, બંધ કરી દીધું.',
  customerAdded: (n) => `${n}નું નવું ખાતું ખોલી દીધું.`,
  renamed: (o, n) => `${o}નું નામ બદલીને ${n} કરી દીધું.`,
  mergeAsk: (a, b) => `${a} અને ${b} એક જ છે? બંને ખાતાં એક કરી દઉં?`,
  merged: (a, b) => `${a} અને ${b}ના ખાતાં એક કરી દીધાં.`,
  phoneSet: (n) => `${n}નો ફોન નંબર લખી લીધો.`,
  reminderReady: (n) => `${n} માટે યાદ અપાવવાનો સંદેશ તૈયાર છે.`,
  statementReady: (n) => `${n}ની હિસાબ ચિઠ્ઠી તૈયાર છે.`,
  noConsent: (n) => `${n}એ સંદેશની મંજૂરી આપી નથી, એટલે મોકલી શકાશે નહીં.`,
  languageSet: (l) => `બરાબર, હવે ${l}માં વાત કરીશ.`,
  readBackSet: (on) => (on ? 'બરાબર, લખતા પહેલાં વાંચી સંભળાવીશ.' : 'બરાબર, હવે સીધું લખીશ, વાંચી સંભળાવીશ નહીં.'),
  speedSet: (f) => (f ? 'બરાબર, હવે ઝડપથી બોલીશ.' : 'બરાબર, હવે ધીમે બોલીશ.'),
  shopNameSet: (n) => `દુકાનનું નામ ${n} રાખ્યું.`,
  privacyOpen: () => 'ગોપનીયતાની માહિતી સ્ક્રીન પર ખોલી છે.',
  backupReady: () => 'બેકઅપ તૈયાર છે, સેવ કરવા બટન દબાવો.',
  eraseAsk: () => 'બધો ડેટા ભૂંસી નાખું? પાકું હોય તો હા બોલો.',
  eraseTap: () => 'બરાબર, ભૂંસવા માટે સ્ક્રીન પરનું બટન દબાવો.',
  awakeHello: () => 'હા, બોલો.',
  sleeping: () => 'બરાબર, જરૂર પડે તો બોલાવજો.',
}

const PA: Replies = {
  resent: () => 'ਨੈੱਟਵਰਕ ਟੁੱਟ ਗਿਆ ਸੀ, ਮੁੜ ਲਿਖ ਰਿਹਾ ਹਾਂ।',
  ack: () => 'ਲਿਖ ਲਿਆ।',
  disclosure: () => 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ! ਮੈਂ ਖਾਤਾ ਭਾਈ ਹਾਂ, ਇੱਕ AI ਸਹਾਇਕ। ਤੁਹਾਡਾ ਹਿਸਾਬ ਸਿਰਫ਼ ਇਸੇ ਫ਼ੋਨ ਵਿੱਚ ਰਹਿੰਦਾ ਹੈ। ਦੱਸੋ, ਕਿਸਦਾ ਕਿੰਨਾ ਲਿਖਾਂ?',
  saved: (n, a, d) => `${n}, ${r(a)} ਰੁਪਏ ${d === 'credit' ? 'ਉਧਾਰ' : 'ਜਮ੍ਹਾ'}।`,
  savedPromise: (n, a, o) => `${n} ${o <= 0 ? 'ਅੱਜ' : o === 1 ? 'ਕੱਲ੍ਹ' : `${o} ਦਿਨਾਂ ਵਿੱਚ`} ${r(a)} ਰੁਪਏ ਦੇਣਗੇ, ਯਾਦ ਰੱਖਾਂਗੀ।`,
  newCustomer: (n) => `${n} ਦਾ ਨਵਾਂ ਖਾਤਾ ਖੋਲ੍ਹਿਆ।`,
  confirm: (n, a, d) => `${n}, ${r(a)} ਰੁਪਏ ${d === 'credit' ? 'ਉਧਾਰ' : 'ਜਮ੍ਹਾ'}, ਠੀਕ ਹੈ?`,
  confirmNew: (n, a, d) => `ਨਵਾਂ ਗਾਹਕ ${n}: ${r(a)} ਰੁਪਏ ${d === 'credit' ? 'ਉਧਾਰ' : 'ਜਮ੍ਹਾ'}, ਠੀਕ ਹੈ?`,
  askAmount: (n) => `${n}, ਕਿੰਨੇ ਰੁਪਏ?`,
  noisyConfirm: (n, a, d) => `ਰੌਲਾ ਬਹੁਤ ਹੈ। ${n}, ${r(a)} ਰੁਪਏ ${d === 'credit' ? 'ਉਧਾਰ' : 'ਜਮ੍ਹਾ'}, ਠੀਕ ਹੈ?`,
  confusable: (a, b) => `${r(a)} ਰੁਪਏ ਜਾਂ ${r(b)} ਰੁਪਏ?`,
  askName: (a) => `${r(a)} ਰੁਪਏ ਕਿਸਦੇ ਨਾਮ ਲਿਖਾਂ?`,
  askDirection: (n, a) => `${n}, ${r(a)} ਰੁਪਏ, ਉਧਾਰ ਦਿੱਤੇ ਜਾਂ ਉਹਨਾਂ ਨੇ ਜਮ੍ਹਾ ਕੀਤੇ?`,
  askWhich: (a, b) => `ਕੌਣ, ${a} ਜਾਂ ${b}?`,
  balance: (n, o) => (o > 0 ? `${n} ਦਾ ਕੁੱਲ ਬਾਕੀ ${r(o)} ਰੁਪਏ ਹੈ।` : o < 0 ? `${n} ਦੇ ${r(-o)} ਰੁਪਏ ਪੇਸ਼ਗੀ ਤੁਹਾਡੇ ਕੋਲ ਹਨ।` : `${n} ਦਾ ਕੋਈ ਬਾਕੀ ਨਹੀਂ।`),
  notFound: (n) => `${n} ਨਾਮ ਦਾ ਕੋਈ ਖਾਤਾ ਨਹੀਂ ਮਿਲਿਆ।`,
  daySummary: (c, p, e) => `ਅੱਜ ${e} ਐਂਟਰੀਆਂ: ਉਧਾਰ ${r(c)} ਰੁਪਏ, ਜਮ੍ਹਾ ${r(p)} ਰੁਪਏ।`,
  monthSummary: (c, p, e) => `ਇਸ ਮਹੀਨੇ ${e} ਐਂਟਰੀਆਂ: ਉਧਾਰ ${r(c)} ਰੁਪਏ, ਜਮ੍ਹਾ ${r(p)} ਰੁਪਏ।`,
  dues: (n, t) => `${n} ਲੋਕਾਂ ਦਾ ਕੁੱਲ ਬਾਕੀ ${r(t)} ਰੁਪਏ ਹੈ। ਸੂਚੀ ਸਕਰੀਨ ਉੱਤੇ ਹੈ।`,
  noDues: () => 'ਹਾਲੇ ਕਿਸੇ ਦਾ ਕੁਝ ਬਾਕੀ ਨਹੀਂ।',
  undone: () => 'ਠੀਕ ਹੈ, ਪਿਛਲੀ ਐਂਟਰੀ ਹਟਾ ਦਿੱਤੀ।',
  nothingToUndo: () => 'ਹਟਾਉਣ ਲਈ ਕੋਈ ਐਂਟਰੀ ਨਹੀਂ।',
  corrected: (n, a, d) => `ਠੀਕ ਕੀਤਾ: ${n}, ${r(a)} ਰੁਪਏ ${d === 'credit' ? 'ਉਧਾਰ' : 'ਜਮ੍ਹਾ'}।`,
  notSaved: () => 'ਠੀਕ ਹੈ, ਨਹੀਂ ਲਿਖਿਆ।',
  didNotCatch: () => 'ਮਾਫ਼ ਕਰਨਾ, ਸਮਝ ਨਹੀਂ ਆਇਆ। ਦੁਬਾਰਾ ਬੋਲੋ।',
  noisyRepeat: () => 'ਰੌਲੇ ਕਰਕੇ ਠੀਕ ਸੁਣਾਈ ਨਹੀਂ ਦਿੱਤਾ। ਫ਼ੋਨ ਨੇੜੇ ਰੱਖ ਕੇ ਦੁਬਾਰਾ ਬੋਲੋ।',
  privacy: () => 'ਮੈਂ ਇੱਕ AI ਸਹਾਇਕ ਹਾਂ। ਤੁਹਾਡਾ ਖਾਤਾ ਇਸੇ ਫ਼ੋਨ ਵਿੱਚ ਤਾਲੇ ਵਿੱਚ ਰਹਿੰਦਾ ਹੈ। ਆਵਾਜ਼ ਨੂੰ ਲਿਖਤ ਵਿੱਚ ਬਦਲਣ ਲਈ Gnani ਦੀ ਸੇਵਾ ਵਰਤੀ ਜਾਂਦੀ ਹੈ, ਰਿਕਾਰਡਿੰਗ ਨਹੀਂ ਰੱਖੀ ਜਾਂਦੀ। ਬੈਕਅੱਪ ਸਿਰਫ਼ ਤੁਹਾਡੀ ਮਰਜ਼ੀ ਨਾਲ, ਤੁਹਾਡੇ PIN ਨਾਲ ਬੰਦ ਕਰਕੇ। "ਸਾਰਾ ਡਾਟਾ ਮਿਟਾ ਦਿਓ" ਕਹੋ ਤਾਂ ਸਭ ਮਿਟ ਜਾਵੇਗਾ।',
  deleteAsk: () => 'ਸਾਰਾ ਖਾਤਾ ਹਮੇਸ਼ਾ ਲਈ ਮਿਟ ਜਾਵੇਗਾ। ਪੱਕਾ? ਹਾਂ ਜਾਂ ਨਾ ਬੋਲੋ।',
  deleted: () => 'ਸਾਰਾ ਡਾਟਾ ਮਿਟਾ ਦਿੱਤਾ।',
  remindReady: (n) => `${n} ਲਈ WhatsApp ਸੁਨੇਹਾ ਤਿਆਰ ਹੈ। ਭੇਜਣ ਲਈ ਬਟਨ ਦਬਾਓ।`,
  remindNotAllowed: (n) => `${n} ਨੇ ਯਾਦ ਕਰਾਉਣ ਦੀ ਇਜਾਜ਼ਤ ਨਹੀਂ ਦਿੱਤੀ, ਇਸ ਲਈ ਸੁਨੇਹਾ ਨਹੀਂ ਬਣਾਇਆ।`,
  reminderText: (n, o, s) => `ਸਤ ਸ੍ਰੀ ਅਕਾਲ ${n} ਜੀ, ${s} ਉੱਤੇ ਤੁਹਾਡਾ ${r(o)} ਰੁਪਏ ਦਾ ਹਿਸਾਬ ਹੈ। ਸਹੂਲਤ ਅਨੁਸਾਰ ਦੇਖ ਲੈਣਾ। ਧੰਨਵਾਦ! (ਅਜਿਹੇ ਸੁਨੇਹੇ ਨਹੀਂ ਚਾਹੀਦੇ ਤਾਂ "ਬੰਦ" ਲਿਖੋ।)`,
  savedWithBalance: (n, a, d, b) => `${n} ਦੇ ${r(a)} ਰੁਪਏ ${d === 'credit' ? 'ਉਧਾਰ ਲਿਖ ਲਏ' : 'ਜਮ੍ਹਾ ਕਰ ਲਏ'}। ਹੁਣ ${PA.balance(n, b)}`,
  showCustomer: (n, b, l) => PA.balance(n, b) + (l ? ` ਆਖ਼ਰੀ ਐਂਟਰੀ ${r(l.amt)} ਰੁਪਏ ${l.dir === 'credit' ? 'ਉਧਾਰ' : 'ਜਮ੍ਹਾ'} ਦੀ ਹੈ।` : ''),
  showDues: (c, t) => `ਹੁਣ ${c} ਲੋਕਾਂ ਦਾ ਕੁੱਲ ਬਾਕੀ ${r(t)} ਰੁਪਏ ਹੈ।`,
  showHistory: (l, c) => `${l} ਦੀਆਂ ${c} ਐਂਟਰੀਆਂ ਸਕਰੀਨ ਉੱਤੇ ਹਨ।`,
  showToday: (c, p) => `ਅੱਜ ਉਧਾਰ ${r(c)} ਰੁਪਏ, ਜਮ੍ਹਾ ${r(p)} ਰੁਪਏ।`,
  searchResult: (t, c) => (c > 0 ? `"${t}" ਲਈ ${c} ਨਤੀਜੇ ਮਿਲੇ, ਸਕਰੀਨ ਉੱਤੇ ਹਨ।` : `"${t}" ਲਈ ਕੁਝ ਨਹੀਂ ਮਿਲਿਆ।`),
  topDebtors: (ns) => (ns.length ? `ਵੱਧ ਬਾਕੀ ਵਾਲੇ: ${ns.join(', ')}।` : PA.noDues()),
  closed: () => 'ਠੀਕ ਹੈ, ਬੰਦ ਕਰ ਦਿੱਤਾ।',
  customerAdded: (n) => `${n} ਦਾ ਨਵਾਂ ਖਾਤਾ ਖੋਲ੍ਹ ਦਿੱਤਾ।`,
  renamed: (o, n) => `${o} ਦਾ ਨਾਮ ਬਦਲ ਕੇ ${n} ਕਰ ਦਿੱਤਾ।`,
  mergeAsk: (a, b) => `${a} ਅਤੇ ${b} ਇੱਕੋ ਹੀ ਹਨ? ਦੋਵੇਂ ਖਾਤੇ ਇੱਕ ਕਰ ਦਿਆਂ?`,
  merged: (a, b) => `${a} ਅਤੇ ${b} ਦੇ ਖਾਤੇ ਇੱਕ ਕਰ ਦਿੱਤੇ।`,
  phoneSet: (n) => `${n} ਦਾ ਫ਼ੋਨ ਨੰਬਰ ਲਿਖ ਲਿਆ।`,
  reminderReady: (n) => `${n} ਲਈ ਯਾਦ ਕਰਾਉਣ ਵਾਲਾ ਸੁਨੇਹਾ ਤਿਆਰ ਹੈ।`,
  statementReady: (n) => `${n} ਦੀ ਹਿਸਾਬ ਪਰਚੀ ਤਿਆਰ ਹੈ।`,
  noConsent: (n) => `${n} ਨੇ ਸੁਨੇਹੇ ਦੀ ਇਜਾਜ਼ਤ ਨਹੀਂ ਦਿੱਤੀ, ਇਸ ਲਈ ਭੇਜ ਨਹੀਂ ਸਕਦਾ।`,
  languageSet: (l) => `ਠੀਕ ਹੈ, ਹੁਣ ${l} ਵਿੱਚ ਗੱਲ ਕਰਾਂਗਾ।`,
  readBackSet: (on) => (on ? 'ਠੀਕ ਹੈ, ਲਿਖਣ ਤੋਂ ਪਹਿਲਾਂ ਪੜ੍ਹ ਕੇ ਸੁਣਾਵਾਂਗਾ।' : 'ਠੀਕ ਹੈ, ਹੁਣ ਸਿੱਧਾ ਲਿਖਾਂਗਾ, ਪੜ੍ਹ ਕੇ ਨਹੀਂ ਸੁਣਾਵਾਂਗਾ।'),
  speedSet: (f) => (f ? 'ਠੀਕ ਹੈ, ਹੁਣ ਤੇਜ਼ ਬੋਲਾਂਗਾ।' : 'ਠੀਕ ਹੈ, ਹੁਣ ਹੌਲੀ ਬੋਲਾਂਗਾ।'),
  shopNameSet: (n) => `ਦੁਕਾਨ ਦਾ ਨਾਮ ${n} ਰੱਖ ਦਿੱਤਾ।`,
  privacyOpen: () => 'ਪਰਦੇਦਾਰੀ ਦੀ ਜਾਣਕਾਰੀ ਸਕਰੀਨ ਉੱਤੇ ਖੋਲ੍ਹ ਦਿੱਤੀ ਹੈ।',
  backupReady: () => 'ਬੈਕਅੱਪ ਤਿਆਰ ਹੈ, ਸੇਵ ਕਰਨ ਲਈ ਬਟਨ ਦਬਾਓ।',
  eraseAsk: () => 'ਸਾਰਾ ਡਾਟਾ ਮਿਟਾਉਣਾ ਹੈ? ਪੱਕਾ ਹੋਵੇ ਤਾਂ ਹਾਂ ਬੋਲੋ।',
  eraseTap: () => 'ਠੀਕ ਹੈ, ਮਿਟਾਉਣ ਲਈ ਸਕਰੀਨ ਦਾ ਬਟਨ ਦਬਾਓ।',
  awakeHello: () => 'ਹਾਂ, ਬੋਲੋ।',
  sleeping: () => 'ਠੀਕ ਹੈ, ਲੋੜ ਪਵੇ ਤਾਂ ਸੱਦ ਲਿਓ।',
}

export const REPLIES: Record<Lang, Replies> = { hi: HI, en: EN, kn: KN, ta: TA, te: TE, ml: ML, mr: MR, bn: BN, gu: GU, pa: PA }
export const say = (lang: Lang): Replies => REPLIES[lang]

/**
 * Guardrail for any free-text reply (the LLM path only fills slots today, but this keeps a
 * future open answer honest): no lending offers, no pressure, no judging customers.
 * Returns null if the text must not be spoken; the caller falls back to a template.
 */
const BANNED = [
  /\bloan\b/i, /\blend\b/i, /\binterest\b/i, /\bcredit (score|limit|rating)\b/i, /\bpenalt/i, /\blegal action\b/i,
  /\bdefault(er)?\b/i, /\bblacklist/i, /\bshame\b/i, /\btrust(worthy)?\b/i, /\brisky?\b/i, /\bimmediately\b/i,
  /ब्याज/, /कर्ज़ा? दे/, /जुर्माना/, /कानूनी/, /बेईमान/, /तुरंत चुकाओ/, /ಬಡ್ಡಿ/, /வட்டி/, /వడ్డీ/,
]
export function guardReply(text: string): string | null {
  if (!text || text.length > 400) return null
  return BANNED.some((re) => re.test(text)) ? null : text
}

/** Replies for lists and for changing older entries. */
export interface MoreReplies {
  /** "Ramesh 200, Suresh 300, Geeta 150: all on credit?" */
  batchAsk: (items: { name: string; amt: number }[], dir: Dir) => string
  /** read back a change to an older entry before applying it */
  removeAsk: (name: string, amt: number, dir: Dir) => string
  removed: (name: string, amt: number) => string
  changeAsk: (name: string, amt: number, dir: Dir) => string
  /** ask before making a reminder message for a customer who agreed to them */
  reminderAsk: (name: string) => string
  /** read a phone number back before saving it (digits spaced 5 + 5) */
  phoneAsk: (name: string, phone: string) => string
  /** ask before opening an account with no entry for a name not in the ledger */
  addAsk: (name: string) => string
}
/** Timbre v3.0 audio tag for a short silence; stripped before text reaches the screen. */
export const PAUSE = '<pauses>'
/** Spoken-only markup (Timbre audio tags) removed, for the screen and for echo matching. */
export const stripTags = (s: string) => s.replace(/\s*<[a-z][a-z ]*>\s*/g, ' ').replace(/ +([,.?!।])/g, '$1').replace(/ {2,}/g, ' ').trim()
const list = (items: { name: string; amt: number }[]) => items.map((i) => `${i.name} ${r(i.amt)}`).join(`, ${PAUSE} `)
const MORE: Record<Lang, MoreReplies> = {
  hi: {
    batchAsk: (i, d) => `${list(i)}, सब ${d === 'credit' ? 'उधार' : 'जमा'}?`,
    removeAsk: (n, a, d) => `${n} की ${r(a)} रुपये ${d === 'credit' ? 'उधार' : 'जमा'} वाली एंट्री हटाऊँ?`,
    removed: (n, a) => `ठीक है, ${n} की ${r(a)} रुपये वाली एंट्री हटा दी।`,
    changeAsk: (n, a, d) => `बदल कर ${n}, ${r(a)} रुपये ${d === 'credit' ? 'उधार' : 'जमा'} कर दूँ?`,
    reminderAsk: (n) => `${n} को याद दिलाने वाला संदेश भेजूँ?`,
    phoneAsk: (n, p) => `${n} का नंबर ${p}, सही है?`,
    addAsk: (n) => `नया ग्राहक ${n}, खाता खोलूँ?`,
  },
  en: {
    batchAsk: (i, d) => `${list(i)}. All ${d === 'credit' ? 'on credit' : 'paid'}?`,
    removeAsk: (n, a, d) => `Remove ${n}'s ${r(a)} rupees ${d === 'credit' ? 'credit' : 'payment'}?`,
    removed: (n, a) => `Okay, removed ${n}'s ${r(a)} rupees entry.`,
    changeAsk: (n, a, d) => `Change it to ${n}, ${r(a)} rupees ${d === 'credit' ? 'on credit' : 'paid'}?`,
    reminderAsk: (n) => `Send ${n} a reminder message?`,
    phoneAsk: (n, p) => `${n}'s number is ${p}, correct?`,
    addAsk: (n) => `Open a new account for ${n}?`,
  },
  kn: {
    batchAsk: (i, d) => `${list(i)}, ಎಲ್ಲಾ ${d === 'credit' ? 'ಸಾಲ' : 'ಜಮಾ'}ನಾ?`,
    removeAsk: (n, a, d) => `${n} ಅವರ ${r(a)} ರೂಪಾಯಿ ${d === 'credit' ? 'ಸಾಲ' : 'ಜಮಾ'} ಎಂಟ್ರಿ ತೆಗೆಯಲಾ?`,
    removed: (n, a) => `ಸರಿ, ${n} ಅವರ ${r(a)} ರೂಪಾಯಿ ಎಂಟ್ರಿ ತೆಗೆದಿದ್ದೇನೆ.`,
    changeAsk: (n, a, d) => `${n}, ${r(a)} ರೂಪಾಯಿ ${d === 'credit' ? 'ಸಾಲ' : 'ಜಮಾ'} ಅಂತ ಬದಲಾಯಿಸಲಾ?`,
    reminderAsk: (n) => `${n} ಅವರಿಗೆ ನೆನಪಿನ ಸಂದೇಶ ಕಳುಹಿಸಲಾ?`,
    phoneAsk: (n, p) => `${n} ಅವರ ನಂಬರ್ ${p}, ಸರಿನಾ?`,
    addAsk: (n) => `ಹೊಸ ಗ್ರಾಹಕ ${n}, ಖಾತೆ ತೆರೆಯಲಾ?`,
  },
  ta: {
    batchAsk: (i, d) => `${list(i)}, எல்லாம் ${d === 'credit' ? 'கடனா' : 'வரவா'}?`,
    removeAsk: (n, a, d) => `${n} ${r(a)} ரூபாய் ${d === 'credit' ? 'கடன்' : 'வரவு'} பதிவை நீக்கவா?`,
    removed: (n, a) => `சரி, ${n} ${r(a)} ரூபாய் பதிவை நீக்கினேன்.`,
    changeAsk: (n, a, d) => `${n}, ${r(a)} ரூபாய் ${d === 'credit' ? 'கடன்' : 'வரவு'} என்று மாற்றவா?`,
    reminderAsk: (n) => `${n} அவர்களுக்கு நினைவூட்டல் செய்தி அனுப்பட்டுமா?`,
    phoneAsk: (n, p) => `${n} அவர்களின் எண் ${p}, சரியா?`,
    addAsk: (n) => `புதிய வாடிக்கையாளர் ${n}, கணக்கு திறக்கட்டுமா?`,
  },
  te: {
    batchAsk: (i, d) => `${list(i)}, అన్నీ ${d === 'credit' ? 'అప్పు' : 'జమ'}నా?`,
    removeAsk: (n, a, d) => `${n} ${r(a)} రూపాయల ${d === 'credit' ? 'అప్పు' : 'జమ'} ఎంట్రీ తీసేయనా?`,
    removed: (n, a) => `సరే, ${n} ${r(a)} రూపాయల ఎంట్రీ తీసేశాను.`,
    changeAsk: (n, a, d) => `${n}, ${r(a)} రూపాయలు ${d === 'credit' ? 'అప్పు' : 'జమ'} అని మార్చనా?`,
    reminderAsk: (n) => `${n} గారికి రిమైండర్ సందేశం పంపనా?`,
    phoneAsk: (n, p) => `${n} గారి నంబర్ ${p}, సరేనా?`,
    addAsk: (n) => `కొత్త కస్టమర్ ${n}, ఖాతా తెరవనా?`,
  },
  ml: {
    batchAsk: (i, d) => `${list(i)}, എല്ലാം ${d === 'credit' ? 'കടം' : 'വരവ്'} ആണോ?`,
    removeAsk: (n, a, d) => `${n}-ന്റെ ${r(a)} രൂപ ${d === 'credit' ? 'കടം' : 'വരവ്'} എൻട്രി മാറ്റട്ടെ?`,
    removed: (n, a) => `ശരി, ${n}-ന്റെ ${r(a)} രൂപ എൻട്രി മാറ്റി.`,
    changeAsk: (n, a, d) => `${n}, ${r(a)} രൂപ ${d === 'credit' ? 'കടം' : 'വരവ്'} എന്ന് മാറ്റട്ടെ?`,
    reminderAsk: (n) => `${n} ന് ഓർമ്മപ്പെടുത്തൽ സന്ദേശം അയക്കട്ടെ?`,
    phoneAsk: (n, p) => `${n} ന്റെ നമ്പർ ${p}, ശരിയാണോ?`,
    addAsk: (n) => `പുതിയ ഉപഭോക്താവ് ${n}, അക്കൗണ്ട് തുറക്കട്ടെ?`,
  },
  mr: {
    batchAsk: (i, d) => `${list(i)}, सगळे ${d === 'credit' ? 'उधार' : 'जमा'}?`,
    removeAsk: (n, a, d) => `${n} ची ${r(a)} रुपये ${d === 'credit' ? 'उधार' : 'जमा'} नोंद काढू?`,
    removed: (n, a) => `ठीक आहे, ${n} ची ${r(a)} रुपयांची नोंद काढली.`,
    changeAsk: (n, a, d) => `${n}, ${r(a)} रुपये ${d === 'credit' ? 'उधार' : 'जमा'} असे बदलू?`,
    reminderAsk: (n) => `${n} यांना आठवण संदेश पाठवू का?`,
    phoneAsk: (n, p) => `${n} यांचा नंबर ${p}, बरोबर?`,
    addAsk: (n) => `नवीन ग्राहक ${n}, खाते उघडू का?`,
  },
  bn: {
    batchAsk: (i, d) => `${list(i)}, সব ${d === 'credit' ? 'বাকি' : 'জমা'}?`,
    removeAsk: (n, a, d) => `${n}-এর ${r(a)} টাকা ${d === 'credit' ? 'বাকি' : 'জমা'} এন্ট্রি মুছব?`,
    removed: (n, a) => `ঠিক আছে, ${n}-এর ${r(a)} টাকার এন্ট্রি মুছে দিলাম।`,
    changeAsk: (n, a, d) => `${n}, ${r(a)} টাকা ${d === 'credit' ? 'বাকি' : 'জমা'} করে দিই?`,
    reminderAsk: (n) => `${n}-কে মনে করানোর বার্তা পাঠাব?`,
    phoneAsk: (n, p) => `${n}-এর নম্বর ${p}, ঠিক আছে?`,
    addAsk: (n) => `নতুন গ্রাহক ${n}, খাতা খুলব?`,
  },
  gu: {
    batchAsk: (i, d) => `${list(i)}, બધું ${d === 'credit' ? 'ઉધાર' : 'જમા'}?`,
    removeAsk: (n, a, d) => `${n} ની ${r(a)} રૂપિયા ${d === 'credit' ? 'ઉધાર' : 'જમા'} એન્ટ્રી કાઢું?`,
    removed: (n, a) => `બરાબર, ${n} ની ${r(a)} રૂપિયાની એન્ટ્રી કાઢી નાખી.`,
    changeAsk: (n, a, d) => `${n}, ${r(a)} રૂપિયા ${d === 'credit' ? 'ઉધાર' : 'જમા'} કરી દઉં?`,
    reminderAsk: (n) => `${n} ને યાદ અપાવવાનો સંદેશ મોકલું?`,
    phoneAsk: (n, p) => `${n} નો નંબર ${p}, બરાબર?`,
    addAsk: (n) => `નવા ગ્રાહક ${n}, ખાતું ખોલું?`,
  },
  pa: {
    batchAsk: (i, d) => `${list(i)}, ਸਾਰੇ ${d === 'credit' ? 'ਉਧਾਰ' : 'ਜਮ੍ਹਾ'}?`,
    removeAsk: (n, a, d) => `${n} ਦੀ ${r(a)} ਰੁਪਏ ${d === 'credit' ? 'ਉਧਾਰ' : 'ਜਮ੍ਹਾ'} ਵਾਲੀ ਐਂਟਰੀ ਹਟਾਵਾਂ?`,
    removed: (n, a) => `ਠੀਕ ਹੈ, ${n} ਦੀ ${r(a)} ਰੁਪਏ ਵਾਲੀ ਐਂਟਰੀ ਹਟਾ ਦਿੱਤੀ।`,
    changeAsk: (n, a, d) => `${n}, ${r(a)} ਰੁਪਏ ${d === 'credit' ? 'ਉਧਾਰ' : 'ਜਮ੍ਹਾ'} ਕਰ ਦਿਆਂ?`,
    reminderAsk: (n) => `${n} ਨੂੰ ਯਾਦ ਕਰਾਉਣ ਵਾਲਾ ਸੁਨੇਹਾ ਭੇਜਾਂ?`,
    phoneAsk: (n, p) => `${n} ਦਾ ਨੰਬਰ ${p}, ਠੀਕ ਹੈ?`,
    addAsk: (n) => `ਨਵਾਂ ਗਾਹਕ ${n}, ਖਾਤਾ ਖੋਲ੍ਹਾਂ?`,
  },
}
export const sayMore = (lang: Lang): MoreReplies => MORE[lang]
