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
}

const HI: Replies = {
  resent: () => 'नेटवर्क टूट गया था, फिर से लिख रहा हूँ।',
  ack: () => 'लिख दिया।',
  disclosure: () => 'नमस्ते! मैं वॉइस खाता हूँ, एक AI सहायक। आपका हिसाब सिर्फ़ इसी फ़ोन पर रहता है। बोलिए, किसका कितना लिखूँ?',
  saved: (n, a, d) => `${n}, ${r(a)} रुपये ${d === 'credit' ? 'उधार' : 'जमा'}।`,
  savedPromise: (n, a, o) => `${n} ${o <= 0 ? 'आज' : o === 1 ? 'कल' : o === 2 ? 'परसों' : `${o} दिन में`} ${r(a)} रुपये देंगे, याद रखूँगी।`,
  newCustomer: (n) => `${n} का नया खाता खोला।`,
  confirm: (n, a, d) => `${n}, ${r(a)} रुपये ${d === 'credit' ? 'उधार' : 'जमा'}, सही है?`,
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
}

const EN: Replies = {
  resent: () => 'The network dropped, saving that again.',
  ack: () => 'Noted.',
  disclosure: () => 'Hello! I am Voice Khata, an AI assistant. Your ledger stays only on this phone. Tell me, whose amount should I write?',
  saved: (n, a, d) => `${n}, ${r(a)} rupees ${d === 'credit' ? 'on credit' : 'paid'}.`,
  savedPromise: (n, a, o) => `${n} will pay ${r(a)} rupees ${o <= 0 ? 'today' : o === 1 ? 'tomorrow' : `in ${o} days`}. I will remember.`,
  newCustomer: (n) => `Opened a new account for ${n}.`,
  confirm: (n, a, d) => `${n}, ${r(a)} rupees ${d === 'credit' ? 'on credit' : 'paid'}, correct?`,
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
}

const KN: Replies = {
  resent: () => 'ನೆಟ್‌ವರ್ಕ್ ಕಡಿತವಾಗಿತ್ತು, ಮತ್ತೆ ಬರೆಯುತ್ತಿದ್ದೇನೆ.',
  ack: () => 'ಬರೆದೆ.',
  disclosure: () => 'ನಮಸ್ಕಾರ! ನಾನು ವಾಯ್ಸ್ ಖಾತಾ, ಒಂದು AI ಸಹಾಯಕಿ. ನಿಮ್ಮ ಲೆಕ್ಕ ಈ ಫೋನಿನಲ್ಲೇ ಇರುತ್ತದೆ. ಹೇಳಿ, ಯಾರದು ಎಷ್ಟು ಬರೆಯಲಿ?',
  saved: (n, a, d) => `${n}, ${r(a)} ರೂಪಾಯಿ ${d === 'credit' ? 'ಸಾಲ' : 'ಜಮಾ'}.`,
  savedPromise: (n, a, o) => `${n} ${o <= 0 ? 'ಇವತ್ತು' : o === 1 ? 'ನಾಳೆ' : `${o} ದಿನದಲ್ಲಿ`} ${r(a)} ರೂಪಾಯಿ ಕೊಡುತ್ತಾರೆ, ನೆನಪಿಟ್ಟುಕೊಳ್ಳುತ್ತೇನೆ.`,
  newCustomer: (n) => `${n} ಅವರ ಹೊಸ ಖಾತೆ ತೆರೆದಿದ್ದೇನೆ.`,
  confirm: (n, a, d) => `${n}, ${r(a)} ರೂಪಾಯಿ ${d === 'credit' ? 'ಸಾಲ' : 'ಜಮಾ'}, ಸರಿನಾ?`,
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
}

const TA: Replies = {
  resent: () => 'நெட்வொர்க் துண்டிக்கப்பட்டது, மீண்டும் எழுதுகிறேன்.',
  ack: () => 'எழுதிட்டேன்.',
  disclosure: () => 'வணக்கம்! நான் வாய்ஸ் கட்டா, ஒரு AI உதவியாளர். உங்கள் கணக்கு இந்த போனில் மட்டுமே இருக்கும். சொல்லுங்கள், யாருக்கு எவ்வளவு எழுதட்டும்?',
  saved: (n, a, d) => `${n}, ${r(a)} ரூபாய் ${d === 'credit' ? 'கடன்' : 'வரவு'}.`,
  savedPromise: (n, a, o) => `${n} ${o <= 0 ? 'இன்று' : o === 1 ? 'நாளை' : `${o} நாளில்`} ${r(a)} ரூபாய் தருவார், நினைவில் வைக்கிறேன்.`,
  newCustomer: (n) => `${n} அவர்களுக்குப் புதிய கணக்கு திறந்தேன்.`,
  confirm: (n, a, d) => `${n}, ${r(a)} ரூபாய் ${d === 'credit' ? 'கடன்' : 'வரவு'}, சரியா?`,
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
}

const TE: Replies = {
  resent: () => 'నెట్‌వర్క్ తెగిపోయింది, మళ్ళీ రాస్తున్నాను.',
  ack: () => 'రాశాను.',
  disclosure: () => 'నమస్కారం! నేను వాయిస్ ఖాతా, ఒక AI సహాయకురాలిని. మీ లెక్క ఈ ఫోన్‌లోనే ఉంటుంది. చెప్పండి, ఎవరిది ఎంత రాయాలి?',
  saved: (n, a, d) => `${n}, ${r(a)} రూపాయలు ${d === 'credit' ? 'అప్పు' : 'జమ'}.`,
  savedPromise: (n, a, o) => `${n} ${o <= 0 ? 'ఈరోజు' : o === 1 ? 'రేపు' : `${o} రోజుల్లో`} ${r(a)} రూపాయలు ఇస్తారు, గుర్తుంచుకుంటాను.`,
  newCustomer: (n) => `${n} గారికి కొత్త ఖాతా తెరిచాను.`,
  confirm: (n, a, d) => `${n}, ${r(a)} రూపాయలు ${d === 'credit' ? 'అప్పు' : 'జమ'}, సరేనా?`,
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
}

const ML: Replies = {
  resent: () => 'നെറ്റ്‌വർക്ക് മുറിഞ്ഞു, വീണ്ടും എഴുതുന്നു.',
  ack: () => 'എഴുതി.',
  disclosure: () => 'നമസ്കാരം! ഞാൻ വോയ്സ് ഖാത, ഒരു AI സഹായി. നിങ്ങളുടെ കണക്ക് ഈ ഫോണിൽ മാത്രമേ ഉള്ളൂ. പറയൂ, ആരുടെ എത്ര എഴുതണം?',
  saved: (n, a, d) => `${n}, ${r(a)} രൂപ ${d === 'credit' ? 'കടം' : 'വരവ്'}.`,
  savedPromise: (n, a, o) => `${n} ${o <= 0 ? 'ഇന്ന്' : o === 1 ? 'നാളെ' : `${o} ദിവസത്തിനുള്ളിൽ`} ${r(a)} രൂപ തരും, ഓർത്തുവെക്കാം.`,
  newCustomer: (n) => `${n} എന്നയാൾക്ക് പുതിയ കണക്ക് തുറന്നു.`,
  confirm: (n, a, d) => `${n}, ${r(a)} രൂപ ${d === 'credit' ? 'കടം' : 'വരവ്'}, ശരിയാണോ?`,
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
}

const MR: Replies = {
  resent: () => 'नेटवर्क तुटले होते, पुन्हा लिहितो.',
  ack: () => 'लिहिलं.',
  disclosure: () => 'नमस्कार! मी व्हॉइस खाता, एक AI सहाय्यक. तुमचा हिशोब फक्त याच फोनवर राहतो. सांगा, कोणाचे किती लिहू?',
  saved: (n, a, d) => `${n}, ${r(a)} रुपये ${d === 'credit' ? 'उधार' : 'जमा'}.`,
  savedPromise: (n, a, o) => `${n} ${o <= 0 ? 'आज' : o === 1 ? 'उद्या' : `${o} दिवसांत`} ${r(a)} रुपये देतील, लक्षात ठेवते.`,
  newCustomer: (n) => `${n} यांचे नवीन खाते उघडले.`,
  confirm: (n, a, d) => `${n}, ${r(a)} रुपये ${d === 'credit' ? 'उधार' : 'जमा'}, बरोबर?`,
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
}

const BN: Replies = {
  resent: () => 'নেটওয়ার্ক কেটে গিয়েছিল, আবার লিখছি।',
  ack: () => 'লিখে নিলাম।',
  disclosure: () => 'নমস্কার! আমি ভয়েস খাতা, একজন AI সহায়ক। আপনার হিসাব শুধু এই ফোনেই থাকে। বলুন, কার কত লিখব?',
  saved: (n, a, d) => `${n}, ${r(a)} টাকা ${d === 'credit' ? 'বাকি' : 'জমা'}।`,
  savedPromise: (n, a, o) => `${n} ${o <= 0 ? 'আজ' : o === 1 ? 'কাল' : `${o} দিনের মধ্যে`} ${r(a)} টাকা দেবেন, মনে রাখব।`,
  newCustomer: (n) => `${n}-এর নতুন খাতা খুললাম।`,
  confirm: (n, a, d) => `${n}, ${r(a)} টাকা ${d === 'credit' ? 'বাকি' : 'জমা'}, ঠিক তো?`,
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
}

const GU: Replies = {
  resent: () => 'નેટવર્ક તૂટી ગયું હતું, ફરી લખું છું.',
  ack: () => 'લખી દીધું.',
  disclosure: () => 'નમસ્તે! હું વૉઇસ ખાતા છું, એક AI સહાયક. તમારો હિસાબ ફક્ત આ ફોનમાં જ રહે છે. બોલો, કોનું કેટલું લખું?',
  saved: (n, a, d) => `${n}, ${r(a)} રૂપિયા ${d === 'credit' ? 'ઉધાર' : 'જમા'}.`,
  savedPromise: (n, a, o) => `${n} ${o <= 0 ? 'આજે' : o === 1 ? 'કાલે' : `${o} દિવસમાં`} ${r(a)} રૂપિયા આપશે, યાદ રાખીશ.`,
  newCustomer: (n) => `${n}નું નવું ખાતું ખોલ્યું.`,
  confirm: (n, a, d) => `${n}, ${r(a)} રૂપિયા ${d === 'credit' ? 'ઉધાર' : 'જમા'}, બરાબર?`,
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
}

const PA: Replies = {
  resent: () => 'ਨੈੱਟਵਰਕ ਟੁੱਟ ਗਿਆ ਸੀ, ਮੁੜ ਲਿਖ ਰਿਹਾ ਹਾਂ।',
  ack: () => 'ਲਿਖ ਲਿਆ।',
  disclosure: () => 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ! ਮੈਂ ਵੌਇਸ ਖਾਤਾ ਹਾਂ, ਇੱਕ AI ਸਹਾਇਕ। ਤੁਹਾਡਾ ਹਿਸਾਬ ਸਿਰਫ਼ ਇਸੇ ਫ਼ੋਨ ਵਿੱਚ ਰਹਿੰਦਾ ਹੈ। ਦੱਸੋ, ਕਿਸਦਾ ਕਿੰਨਾ ਲਿਖਾਂ?',
  saved: (n, a, d) => `${n}, ${r(a)} ਰੁਪਏ ${d === 'credit' ? 'ਉਧਾਰ' : 'ਜਮ੍ਹਾ'}।`,
  savedPromise: (n, a, o) => `${n} ${o <= 0 ? 'ਅੱਜ' : o === 1 ? 'ਕੱਲ੍ਹ' : `${o} ਦਿਨਾਂ ਵਿੱਚ`} ${r(a)} ਰੁਪਏ ਦੇਣਗੇ, ਯਾਦ ਰੱਖਾਂਗੀ।`,
  newCustomer: (n) => `${n} ਦਾ ਨਵਾਂ ਖਾਤਾ ਖੋਲ੍ਹਿਆ।`,
  confirm: (n, a, d) => `${n}, ${r(a)} ਰੁਪਏ ${d === 'credit' ? 'ਉਧਾਰ' : 'ਜਮ੍ਹਾ'}, ਠੀਕ ਹੈ?`,
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
  },
  en: {
    batchAsk: (i, d) => `${list(i)}. All ${d === 'credit' ? 'on credit' : 'paid'}?`,
    removeAsk: (n, a, d) => `Remove ${n}'s ${r(a)} rupees ${d === 'credit' ? 'credit' : 'payment'}?`,
    removed: (n, a) => `Okay, removed ${n}'s ${r(a)} rupees entry.`,
    changeAsk: (n, a, d) => `Change it to ${n}, ${r(a)} rupees ${d === 'credit' ? 'on credit' : 'paid'}?`,
  },
  kn: {
    batchAsk: (i, d) => `${list(i)}, ಎಲ್ಲಾ ${d === 'credit' ? 'ಸಾಲ' : 'ಜಮಾ'}ನಾ?`,
    removeAsk: (n, a, d) => `${n} ಅವರ ${r(a)} ರೂಪಾಯಿ ${d === 'credit' ? 'ಸಾಲ' : 'ಜಮಾ'} ಎಂಟ್ರಿ ತೆಗೆಯಲಾ?`,
    removed: (n, a) => `ಸರಿ, ${n} ಅವರ ${r(a)} ರೂಪಾಯಿ ಎಂಟ್ರಿ ತೆಗೆದಿದ್ದೇನೆ.`,
    changeAsk: (n, a, d) => `${n}, ${r(a)} ರೂಪಾಯಿ ${d === 'credit' ? 'ಸಾಲ' : 'ಜಮಾ'} ಅಂತ ಬದಲಾಯಿಸಲಾ?`,
  },
  ta: {
    batchAsk: (i, d) => `${list(i)}, எல்லாம் ${d === 'credit' ? 'கடனா' : 'வரவா'}?`,
    removeAsk: (n, a, d) => `${n} ${r(a)} ரூபாய் ${d === 'credit' ? 'கடன்' : 'வரவு'} பதிவை நீக்கவா?`,
    removed: (n, a) => `சரி, ${n} ${r(a)} ரூபாய் பதிவை நீக்கினேன்.`,
    changeAsk: (n, a, d) => `${n}, ${r(a)} ரூபாய் ${d === 'credit' ? 'கடன்' : 'வரவு'} என்று மாற்றவா?`,
  },
  te: {
    batchAsk: (i, d) => `${list(i)}, అన్నీ ${d === 'credit' ? 'అప్పు' : 'జమ'}నా?`,
    removeAsk: (n, a, d) => `${n} ${r(a)} రూపాయల ${d === 'credit' ? 'అప్పు' : 'జమ'} ఎంట్రీ తీసేయనా?`,
    removed: (n, a) => `సరే, ${n} ${r(a)} రూపాయల ఎంట్రీ తీసేశాను.`,
    changeAsk: (n, a, d) => `${n}, ${r(a)} రూపాయలు ${d === 'credit' ? 'అప్పు' : 'జమ'} అని మార్చనా?`,
  },
  ml: {
    batchAsk: (i, d) => `${list(i)}, എല്ലാം ${d === 'credit' ? 'കടം' : 'വരവ്'} ആണോ?`,
    removeAsk: (n, a, d) => `${n}-ന്റെ ${r(a)} രൂപ ${d === 'credit' ? 'കടം' : 'വരവ്'} എൻട്രി മാറ്റട്ടെ?`,
    removed: (n, a) => `ശരി, ${n}-ന്റെ ${r(a)} രൂപ എൻട്രി മാറ്റി.`,
    changeAsk: (n, a, d) => `${n}, ${r(a)} രൂപ ${d === 'credit' ? 'കടം' : 'വരവ്'} എന്ന് മാറ്റട്ടെ?`,
  },
  mr: {
    batchAsk: (i, d) => `${list(i)}, सगळे ${d === 'credit' ? 'उधार' : 'जमा'}?`,
    removeAsk: (n, a, d) => `${n} ची ${r(a)} रुपये ${d === 'credit' ? 'उधार' : 'जमा'} नोंद काढू?`,
    removed: (n, a) => `ठीक आहे, ${n} ची ${r(a)} रुपयांची नोंद काढली.`,
    changeAsk: (n, a, d) => `${n}, ${r(a)} रुपये ${d === 'credit' ? 'उधार' : 'जमा'} असे बदलू?`,
  },
  bn: {
    batchAsk: (i, d) => `${list(i)}, সব ${d === 'credit' ? 'বাকি' : 'জমা'}?`,
    removeAsk: (n, a, d) => `${n}-এর ${r(a)} টাকা ${d === 'credit' ? 'বাকি' : 'জমা'} এন্ট্রি মুছব?`,
    removed: (n, a) => `ঠিক আছে, ${n}-এর ${r(a)} টাকার এন্ট্রি মুছে দিলাম।`,
    changeAsk: (n, a, d) => `${n}, ${r(a)} টাকা ${d === 'credit' ? 'বাকি' : 'জমা'} করে দিই?`,
  },
  gu: {
    batchAsk: (i, d) => `${list(i)}, બધું ${d === 'credit' ? 'ઉધાર' : 'જમા'}?`,
    removeAsk: (n, a, d) => `${n} ની ${r(a)} રૂપિયા ${d === 'credit' ? 'ઉધાર' : 'જમા'} એન્ટ્રી કાઢું?`,
    removed: (n, a) => `બરાબર, ${n} ની ${r(a)} રૂપિયાની એન્ટ્રી કાઢી નાખી.`,
    changeAsk: (n, a, d) => `${n}, ${r(a)} રૂપિયા ${d === 'credit' ? 'ઉધાર' : 'જમા'} કરી દઉં?`,
  },
  pa: {
    batchAsk: (i, d) => `${list(i)}, ਸਾਰੇ ${d === 'credit' ? 'ਉਧਾਰ' : 'ਜਮ੍ਹਾ'}?`,
    removeAsk: (n, a, d) => `${n} ਦੀ ${r(a)} ਰੁਪਏ ${d === 'credit' ? 'ਉਧਾਰ' : 'ਜਮ੍ਹਾ'} ਵਾਲੀ ਐਂਟਰੀ ਹਟਾਵਾਂ?`,
    removed: (n, a) => `ਠੀਕ ਹੈ, ${n} ਦੀ ${r(a)} ਰੁਪਏ ਵਾਲੀ ਐਂਟਰੀ ਹਟਾ ਦਿੱਤੀ।`,
    changeAsk: (n, a, d) => `${n}, ${r(a)} ਰੁਪਏ ${d === 'credit' ? 'ਉਧਾਰ' : 'ਜਮ੍ਹਾ'} ਕਰ ਦਿਆਂ?`,
  },
}
export const sayMore = (lang: Lang): MoreReplies => MORE[lang]
