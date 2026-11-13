/**
 * Deterministic fast path: transcript -> ledger intent, no LLM.
 *
 * Handles the common shapes of shop talk in ~1 ms so most turns never wait on a model:
 *   "Ramesh ka 340 udhaar, kal 200 diya tha"      -> credit 340 today, payment 200 yesterday
 *   "ರಮೇಶ್ ಮುನ್ನೂರ ನಲವತ್ತು ರೂಪಾಯಿ ಕೊಟ್ಟ"            -> payment 340
 *   "nahi, 430" / "galat, hata do" / "Ramesh ka total?" / "haan"
 * Anything it is not sure about comes back with confidence 'low' (or type 'unknown') and the
 * server hands it to the LLM. Direction rules follow the research priority order:
 *   1. explicit credit marker (udhaar, baaki, saala, kadan, appu) 2. clear/cancel marker (jama,
 *   chuka, kattida, katta) 3. case marker / verb person (ne/ko, -ge/-kku/-ki, kottaru/kotte).
 */
import { type AmountSpan, fold, isNumberWord, parseAmounts, tokenize } from './numbers.js'

export type Direction = 'credit' | 'payment'

export interface EntryIntent {
  name: string | null // as heard; null = inherit / ask
  amount: AmountSpan
  direction: Direction | null
  dayOffset: number // 0 today, -1 yesterday ...
  promise: boolean // future payment ("kal de dega"): tracked, not posted to balance
  confidence: 'high' | 'low'
  reasons: string[] // why low (for the confirm question and the audit log)
}

export type Intent =
  | { type: 'entries'; entries: EntryIntent[] }
  | { type: 'correct'; amount?: AmountSpan; direction?: Direction; name?: string }
  /** Change or remove an earlier entry (not necessarily the last). ref = 1-based index into snapshot.recent. */
  | { type: 'modify'; ref: number; amount?: AmountSpan; direction?: Direction; name?: string; remove?: boolean }
  | { type: 'undo' }
  | { type: 'yes' }
  | { type: 'no' }
  | { type: 'query'; name: string | null; scope: 'customer' | 'today_credit' | 'today_payment' | 'dues' }
  | { type: 'summary'; period: 'today' | 'month' }
  | { type: 'remind'; name: string | null }
  | { type: 'privacy' }
  | { type: 'delete_all' }
  | { type: 'unknown' }

const S = (...w: string[]): Set<string> => new Set(w.map((x) => fold(x)))

// ----------------------------------------------------------------- lexicons
const CREDIT = S('udhaar', 'udhar', 'udhari', 'उधार', 'उधारी', 'baaki', 'baki', 'बाकी', 'बाक़ी', 'bakaya', 'बकाया',
  'khate', 'खाते', 'khata', 'खाता', 'chadha', 'चढ़ा', 'चढ़ाओ', 'credit', 'owes', 'owe', 'due', 'loan',
  'put', 'write', 'note', 'record', 'enter', 'tab', 'account', 'borrowed', 'borrow', 'bought', 'buy', 'purchased', 'spent', 'tab', 'outstanding', 'unpaid', 'dues', 'add', 'added',
  'ಸಾಲ', 'ಉದ್ರಿ', 'ಬಾಕಿ', 'saala', 'udri', 'கடன்', 'கடனுக்கு', 'பாக்கி', 'kadan', 'అప్పు', 'బాకీ', 'ఉద్దెర', 'appu',
  'उधारी', 'ধার', 'বাকি', 'ઉધાર', 'બાકી', 'ਉਧਾਰ', 'ਬਾਕੀ', 'കടം', 'ബാക്കി', 'उधार')
const PAYMENT = S('jama', 'जमा', 'chuka', 'चुका', 'chukaya', 'चुकाया', 'chukta', 'चुकता', 'wapas', 'वापस', 'vapas',
  'paid', 'pay', 'payment', 'returned', 'repaid', 'cleared', 'nakad', 'नकद', 'cash', 'bhar', 'भर', 'bhara', 'भरा',
  'mile', 'mila', 'mili', 'मिले', 'मिला', 'मिली', 'aaye', 'aaya', 'आए', 'आये', 'आया', 'deposited', 'deposit', 'received', 'settled', 'settle', 'collected', 'repay',
  'ಕಟ್ಟಿದ', 'ಕಟ್ಟಿದರು', 'ಕಟ್ಟಿದ್ರು', 'ತೀರಿಸಿದ', 'ತೀರಿಸಿದರು', 'ಜಮಾ', 'கட்டினார்', 'கட்டினான்', 'செலுத்தினார்', 'அடைத்தார்',
  'வரவு', 'కట్టాడు', 'కట్టారు', 'తీర్చాడు', 'తీర్చారు', 'జమ', 'জমা', 'শোধ', 'જમા', 'ચૂકવ્યા', 'ਜਮ੍ਹਾ', 'ജമ')
// verbs of giving: direction then comes from who gave (case marker / person ending)
const GIVE = S('diya', 'diye', 'di', 'de', 'दिया', 'दिए', 'दिये', 'दी', 'दे', 'gave', 'given', 'दिले', 'दिलं', 'দিয়েছে',
  'আপ્યા', 'આપ્યા', 'ਦਿੱਤੇ', 'ਦਿੱਤਾ')
// customer-gave verb forms (3rd person / toward speaker) -> payment
const GAVE_3P = S('ಕೊಟ್ಟ', 'ಕೊಟ್ಟರು', 'ಕೊಟ್ರು', 'ಕೊಟ್ಟನು', 'ಕೊಟ್ಟಳು', 'kotta', 'kottaru', 'kottru',
  'கொடுத்தார்', 'கொடுத்தான்', 'கொடுத்தாள்', 'தந்தார்', 'தந்தான்', 'koduthaar', 'ఇచ్చాడు', 'ఇచ్చారు', 'ఇచ్చింది', 'ichchadu',
  'തന്നു', 'thannu', 'দিয়েছে')
// shopkeeper-gave forms (1st person / away) -> credit
const GAVE_1P = S('ಕೊಟ್ಟೆ', 'ಕೊಟ್ಟಿದ್ದೇನೆ', 'கொடுத்தேன்', 'ఇచ్చాను', 'ఇచ్చా', 'കൊടുത്തു', 'দিয়েছি')
const TOOK = S('liya', 'liye', 'लिया', 'लिए', 'took', 'taken', 'घेतले', 'ತಗೊಂಡ', 'ತೆಗೆದುಕೊಂಡ', 'வாங்கினார்', 'తీసుకున్నాడు')
const GAYA = S('gaya', 'gayi', 'gaye', 'गया', 'गई', 'गए', 'gai')

const MARK_AGENT = S('ne', 'ने', 'नी') // "Ramesh ne 200 diya" -> he gave -> payment
const MARK_RECIP = S('ko', 'को', 'ला', 'কে', 'ને', 'ਨੂੰ') // "Ramesh ko 200 diya" -> credit
const MARK_POSS = S('ka', 'ki', 'ke', 'का', 'की', 'के', 'cha', 'चा', 'ची', 'चे', 'ਦਾ', 'ਦੀ', 'ਦੇ', 'નો', 'ની', 'ના', 'er', 'এর')
const MARK_SRC = S('se', 'से', 'from')
const CASE = new Set([...MARK_AGENT, ...MARK_RECIP, ...MARK_POSS, ...MARK_SRC])
const EN_PREP = new Set(['from', 'to', 'for', 'against', 'on', 'under', 'in', 'by'])

const PAST = S('tha', 'thi', 'the', 'था', 'थी', 'थे', 'diya', 'diye', 'दिया', 'दिए', 'दिये', 'liya', 'लिया', 'liye', 'लिए',
  'gaya', 'gaye', 'gayi', 'गया', 'गए', 'गई', 'kiya', 'kiye', 'किया', 'किए', 'chukaya', 'चुकाया', 'paid', 'gave', 'took',
  'returned', 'yesterday', 'दिले', 'घेतले')
const FUTURE = S('dega', 'degi', 'denge', 'dunga', 'dungi', 'देगा', 'देगी', 'देंगे', 'दूंगा', 'दूँगा', 'karega', 'करेगा',
  'aayega', 'aaega', 'आएगा', 'आयेगा', 'jayega', 'jaega', 'जाएगा', 'जायेगा', 'lautayega', 'लौटाएगा', 'will', 'tomorrow',
  'ಕೊಡ್ತಾರೆ', 'ಕೊಡುತ್ತಾರೆ', 'ಕೊಡ್ತಾನೆ', 'கொடுப்பார்', 'கொடுப்பான்', 'தருவார்', 'ఇస్తాడు', 'ఇస్తారు', 'తరും', 'തരും')

const D_TODAY = S('aaj', 'आज', 'today', 'ಇವತ್ತು', 'ಇಂದು', 'இன்று', 'இன்னைக்கு', 'ఈరోజు', 'ఇవాళ', 'ഇന്ന്', 'আজ', 'આજે', 'ਅੱਜ')
const D_KAL = S('kal', 'कल', 'কাল', 'કાલે', 'ਕੱਲ੍ਹ', 'ਕੱਲ') // yesterday OR tomorrow, by tense
const D_PARSO = S('parso', 'parson', 'परसों', 'परसो', 'পরশু', 'ਪਰਸੋਂ')
const D_YEST = S('yesterday', 'ನಿನ್ನೆ', 'நேற்று', 'நேத்து', 'నిన్న', 'ഇന്നലെ', 'गतकाल', 'গতকাল', 'ગઈકાલે', 'काल')
const D_TOMORROW = S('tomorrow', 'ನಾಳೆ', 'நாளை', 'நாளைக்கு', 'రేపు', 'നാളെ', 'उद्या', 'আগামীকাল', 'આવતીકાલે')
const D_DAYBEFORE = S('ಮೊನ್ನೆ', 'முந்தாநாள்', 'మొన్న', 'മിനിഞ്ഞാന്ന്')
const DATE_WORDS = new Set([...D_TODAY, ...D_KAL, ...D_PARSO, ...D_YEST, ...D_TOMORROW, ...D_DAYBEFORE])

const UNITS = S('kilo', 'kg', 'किलो', 'gram', 'gm', 'ग्राम', 'litre', 'liter', 'लीटर', 'packet', 'पैकेट', 'dozen', 'दर्जन',
  'piece', 'pcs', 'पीस', 'bottle', 'बोतल', 'ಕೆಜಿ', 'ಕಿಲೋ', 'ಲೀಟರ್', 'ಪ್ಯಾಕೆಟ್', 'கிலோ', 'லிட்டர்', 'పాకెట్', 'కిలో', 'లీటర్')
const CONJ = S('aur', 'और', 'and', 'phir', 'फिर', 'then', 'ಮತ್ತು', 'மற்றும்', 'మరియు', 'ആൻഡ്', 'আর', 'અને', 'ਅਤੇ', 'ani', 'आणि')
const NEG = S('nope', 'nah', 'incorrect', 'nahi', 'nahin', 'नहीं', 'नही', 'na', 'ना', 'no', 'not', 'galat', 'गलत', 'wrong', 'ಇಲ್ಲ', 'ಅಲ್ಲ', 'இல்லை',
  'இல்ல', 'కాదు', 'లేదు', 'അല്ല', 'ഇല്ല', 'না', 'ના', 'ਨਹੀਂ')
const YES = S('haan', 'han', 'ha', 'हाँ', 'हां', 'हा', 'ji', 'जी', 'sahi', 'सही', 'theek', 'ठीक', 'thik', 'yes', 'ok',
  'okay', 'correct', 'right', 'ஆமாம்', 'ஆமாங்க', 'ஆமா', 'சரிங்க', 'ಹೂಂ', 'ಹೌದು', 'ಸರಿ', 'హా', 'ఔను', 'అవును', 'సరే', 'హాఁ', 'ஓகே', 'ಓಕೆ', 'ఓకే', 'ओके', 'हम्म', 'हाँजी', 'जी हाँ', 'ji haan', 'yeah', 'yea', 'yep', 'yup', 'sure', 'done', 'fine', 'alright', 'exactly', 'perfect', 'haanji', 'हाँजी', 'theek', 'ठीक', 'bilkul', 'बिल्कुल', 'ಹೌದು', 'ಸರಿ', 'ஆமா', 'ஆம்', 'சரி', 'అవును', 'సరే', 'ശരി', 'അതെ',
  'হ্যাঁ', 'ঠিক', 'હા', 'ਹਾਂ', 'होय')
const UNDO = S('undo', 'cancel', 'hata', 'हटा', 'mita', 'मिटा', 'kaat', 'काट', 'delete', 'remove', 'ರದ್ದು', 'அழி',
  'రద్దు', 'वापस')
const QUERY = S('total', 'kitna', 'kitne', 'कितना', 'कितने', 'कितनी', 'hisaab', 'hisab', 'हिसाब', 'balance', 'how',
  'much', 'எவ்வளோ', 'எவ்ளோ', 'எவ்வளவுங்க', 'ಎಷ್ಟಿದೆ', 'ಎಷ್ಟು', 'ఎంతుంది', 'ఎంత', 'balance', 'kitni', 'kitta', 'எவ்வளவு', 'ఎంత', 'എത്ര', 'কত', 'કેટલા', 'ਕਿੰਨਾ', 'किती')
const REMIND = S('yaad', 'याद', 'remind', 'reminder', 'ನೆನಪಿಸು', 'நினைவூட்டு', 'గుర్తుచేయి')
const PRIVACY = S('privacy', 'data', 'डेटा', 'डाटा')
const ALL = S('sab', 'सब', 'saara', 'सारा', 'all', 'everything', 'poora', 'पूरा', 'everyone', 'sabka', 'सबका', 'sabko', 'सबको', 'ella', 'ಎಲ್ಲಾ', 'ಎಲ್ಲ', 'எல்லாம்', 'అన్నీ', 'అందరికీ')
const BOTH = S('dono', 'दोनों', 'donon', 'both', 'teeno', 'तीनों', 'teenon', 'chaaron', 'चारों')
const BACKREF = S('uska', 'uski', 'uske', 'usko', 'usne', 'उसका', 'उसकी', 'उसके', 'उसको', 'उसने', 'unka', 'unki', 'unke', 'unko', 'उनका',
  'उनकी', 'उनके', 'उनको', 'iska', 'इसका', 'his', 'her', 'him', 'their', 'them', 'same', 'wahi', 'वही', 'bhi', 'भी', 'too', 'also',
  'another', 'more', 'aur', 'और', 'phir', 'फिर', 'again', 'ಅವನ', 'ಅವರ', 'ಅವಳ', 'ಅವರಿಗೆ', 'ಇನ್ನೂ', 'அவர்', 'அவருக்கு', 'இன்னும்', 'అతని',
  'ఆయనకు', 'ఇంకా')
const MONTH = S('mahine', 'mahina', 'महीने', 'महीना', 'month', 'monthly', 'ತಿಂಗಳ', 'மாத', 'నెల')
const SUMMARY = S('summary', 'report', 'sales', 'saransh', 'सारांश', 'ಸಾರಾಂಶ', 'சுருக்கம்', 'సారాంశం')
const WHO = S('kaun', 'कौन', 'who', 'kisko', 'किसको', 'kiska', 'किसका')
const FILLER = S('hua', 'हुआ', 'hui', 'हुई', 'hue', 'हुए', 'bana', 'बना', 'banta', 'बनता', 'bhai', 'भाई', 'bhaiya', 'भैया', 'arre', 'अरे', 'achha', 'अच्छा', 'haan', 'to', 'तो', 'toh', 'ab', 'अब',
  'please', 'zara', 'ज़रा', 'jara', 'likh', 'लिख', 'likho', 'लिखो', 'lo', 'लो', 'do', 'दो', 'rupaye', 'रुपये', 'रुपए',
  'rs', '₹', 'ಅವರು', 'avaru', 'அவர்', 'ఆయన', 'mein', 'में', 'ka', 'hai', 'है', 'ho', 'kar', 'कर', 'gaya', 'diya',
  'ji', 'जी', 'customer', 'naya', 'नया', 'batao', 'bata', 'बताओ', 'बता', 'bolo', 'बोलो', 'sunao', 'सुनाओ', 'dikhao',
  'दिखाओ', 'i', 'we', 'me', 'my', 'us', 'put', 'write', 'note', 'record', 'enter', 'mark', 'for', 'from', 'on', 'against',
  'account', 'worth', 'things', 'groceries', 'items', 'stuff', 'has', 'have', 'had', 'needs', 'need', 'must', 'should', 'the', 'a',
  'an', 'of', 'his', 'her', 'their', 'in', 'into', 'at', 'got', 'get', 'rupees', 'rupee', 'just', 'by', 'with', 'amount', 'is', 'was',
  'and', 'he', 'she', 'they', 'it', 'this', 'that', 's', 'give', 'giving', 'goods', 'ration', 'made', 'make', 'did', 'done', 'kindly', 'also', 'more', 'extra', 'today', 'rupaya', 'rupay', 'only', 'total', 'him', 'them', 'mr', 'mrs', 'saaman', 'सामान', 'saman', 'maal', 'माल', 'ki', 'ke', 'le', 'ले', 'lena', 'लेना', 'dena', 'देना', 'wala', 'wale', 'वाले', 'वाला', 'ರೂಪಾಯಿ', 'ரூபாய்', 'రూపాయలు', 'sir', 'madam')

// Case suffixes glued to the name (Dravidian, Marathi): dative marks the recipient (credit),
// Marathi -ने marks the agent. Longest first so ுக்கு wins over க்கு.
const byLen = (a: string[]): string[] => a.map((w) => fold(w)).sort((x, y) => y.length - x.length)
const DATIVE_SUFFIX = byLen(['ಿಗೆ', 'ಗೆ', 'ுக்கு', 'க்கு', 'కి', 'కు', 'ന്', 'നു', 'ला', 'ને', 'কে'])
const AGENT_SUFFIX = byLen(['ने'])
const OTHER_SUFFIX = byLen(['ರವರು', 'ಇಂದ', 'கிட்ட', 'இடம்', 'నుంచి', 'చే'])

// ----------------------------------------------------------------- helpers
const has = (set: Set<string>, toks: string[]) => toks.some((t) => set.has(t))
const isNumberish = (t: string) => /^\d/.test(t)

function stripSuffix(tok: string): { base: string; marker: 'dative' | 'agent' | null } {
  const cut = (list: string[]) => list.find((f) => tok.length > f.length + 1 && tok.endsWith(f))
  let f = cut(DATIVE_SUFFIX)
  if (f) return { base: tok.slice(0, -f.length), marker: 'dative' }
  f = cut(AGENT_SUFFIX)
  if (f) return { base: tok.slice(0, -f.length), marker: 'agent' }
  f = cut(OTHER_SUFFIX)
  if (f) return { base: tok.slice(0, -f.length), marker: null }
  return { base: tok, marker: null }
}

/** Words that can never be part of a name. */
function stopWord(t: string): boolean {
  return CREDIT.has(t) || PAYMENT.has(t) || GIVE.has(t) || TOOK.has(t) || GAYA.has(t) || CASE.has(t) ||
    DATE_WORDS.has(t) || CONJ.has(t) || NEG.has(t) || YES.has(t) || QUERY.has(t) || FILLER.has(t) ||
    PAST.has(t) || FUTURE.has(t) || GAVE_3P.has(t) || GAVE_1P.has(t) || UNDO.has(t) || isNumberish(t) || MONTH.has(t) || SUMMARY.has(t) || BACKREF.has(t) || ALL.has(t) || BOTH.has(t) || CHANGE.has(t) ||
    isNumberWord(t)
}

interface NameHit {
  name: string
  marker: 'agent' | 'recip' | 'poss' | 'src' | 'dative' | null
}

/** Find the customer name in a clause (tokens without the amount span). */
function findName(toks: string[], amountStart: number): NameHit | null {
  // 1. Hindi-style: NAME (+ji) + case marker
  for (let i = 1; i < toks.length; i++) {
    const t = toks[i]
    if (!CASE.has(t)) continue
    const parts: string[] = []
    for (let k = i - 1; k >= 0 && parts.length < 3; k--) {
      const w = toks[k]
      if (w === 'ji' || w === 'जी') {
        parts.unshift(w)
        continue
      }
      if (stopWord(w)) break
      parts.unshift(w)
    }
    if (parts.length && parts.some((p) => p !== 'ji' && p !== 'जी')) {
      const marker = MARK_AGENT.has(t) ? 'agent' : MARK_RECIP.has(t) ? 'recip' : MARK_SRC.has(t) ? 'src' : 'poss'
      return { name: parts.join(' '), marker }
    }
  }
  // 1b. English prepositions put the name after them: "500 from Suresh", "add 500 to Suresh's account"
  for (let i = 0; i + 1 < toks.length; i++) {
    if (!EN_PREP.has(toks[i])) continue
    let j = i + 1
    while (j < toks.length && (toks[j] === 'the' || toks[j] === 'mr' || toks[j] === 'mrs')) j++
    const w = toks[j]?.replace(/'s$/, '')
    if (!w || !/^[a-z]+$/.test(w) || stopWord(w)) continue
    const next = toks[j + 1]?.replace(/'s$/, '')
    const name = next && /^[a-z]+$/.test(next) && !stopWord(next) ? `${w} ${next}` : w
    return { name, marker: toks[i] === 'from' ? 'src' : toks[i] === 'by' ? 'agent' : toks[i] === 'to' ? 'recip' : 'poss' }
  }
  // 2. Dravidian / English: first content word before the amount (suffix-stripped).
  for (let i = 0; i < Math.max(amountStart, 1) && i < toks.length; i++) {
    const t = toks[i]
    if (stopWord(t)) continue
    const { base, marker } = stripSuffix(t)
    if (stopWord(base)) continue
    // two-word names in English ("Ramesh Kumar paid")
    const next = toks[i + 1]
    const name = next && i + 1 < amountStart && !stopWord(next) && /^[a-z]+$/.test(t) && /^[a-z]+$/.test(next)
      ? `${t} ${next}` : base
    return { name, marker }
  }
  // 3. Name after the amount: "credit 500 Suresh", "₹500 udhaar Suresh"
  for (let i = amountStart + 1; i < toks.length; i++) {
    const t = toks[i]
    if (stopWord(t)) continue
    const { base, marker } = stripSuffix(t)
    if (stopWord(base)) continue
    return { name: base, marker }
  }
  return null
}

function resolveDirection(toks: string[], marker: NameHit['marker']): { dir: Direction | null; why: string } {
  // English phrasing first: word order carries the meaning here
  const at = (w: string) => toks.indexOf(w)
  if (/(?:^| )(?:has|have|needs?|must|should) to (?:pay|give|return)/.test(toks.join(' '))) return { dir: 'credit', why: 'has-to-pay' }
  if (at('from') > 0 && ['got', 'get', 'received', 'collected', 'came', 'took'].some((w) => toks.includes(w)))
    return { dir: 'payment', why: 'received-from' }
  if (['i', 'we'].some((w) => ['gave', 'given', 'sold'].includes(toks[at(w) + 1] ?? ''))) return { dir: 'credit', why: 'shop-gave' }
  const credit = has(CREDIT, toks)
  const payment = has(PAYMENT, toks)
  // "udhaar chuka diya" / "baaki jama kiya": clearing words win
  if (payment) return { dir: 'payment', why: 'payment-marker' }
  if (credit) return { dir: 'credit', why: 'credit-marker' }
  // le gaya (took away goods) vs de gaya (gave and left)
  for (let i = 0; i + 1 < toks.length; i++) {
    if (GAYA.has(toks[i + 1]) && (toks[i] === 'le' || toks[i] === 'ले')) return { dir: 'credit', why: 'le-gaya' }
    if (GAYA.has(toks[i + 1]) && (toks[i] === 'de' || toks[i] === 'दे')) return { dir: 'payment', why: 'de-gaya' }
  }
  if (has(TOOK, toks)) return { dir: 'credit', why: 'took' }
  if (has(GAVE_1P, toks) || marker === 'dative') return { dir: 'credit', why: 'shop-gave' }
  if (has(GAVE_3P, toks)) return { dir: 'payment', why: 'customer-gave' }
  if (has(GIVE, toks)) {
    if (marker === 'recip') return { dir: 'credit', why: 'ko-diya' }
    if (marker === 'agent' || marker === 'src') return { dir: 'payment', why: 'ne-diya' }
    // "Ramesh ka 340 udhaar, kal 200 diya tha": a bare "diya" about the customer = he paid
    return { dir: 'payment', why: 'bare-diya' }
  }
  if (toks.includes('owes')) return { dir: 'credit', why: 'owes' }
  return { dir: null, why: 'no-direction-cue' }
}

function resolveDate(toks: string[]): { dayOffset: number; future: boolean; ambiguous: boolean } {
  const future = has(FUTURE, toks)
  const past = has(PAST, toks)
  if (has(D_YEST, toks)) return { dayOffset: -1, future: false, ambiguous: false }
  if (has(D_TOMORROW, toks)) return { dayOffset: 1, future: true, ambiguous: false }
  if (has(D_DAYBEFORE, toks)) return { dayOffset: -2, future: false, ambiguous: false }
  if (has(D_KAL, toks)) {
    if (future && !past) return { dayOffset: 1, future: true, ambiguous: false }
    return { dayOffset: -1, future: false, ambiguous: !past }
  }
  if (has(D_PARSO, toks)) {
    if (future && !past) return { dayOffset: 2, future: true, ambiguous: false }
    return { dayOffset: -2, future: false, ambiguous: !past }
  }
  return { dayOffset: 0, future: future && !past, ambiguous: false }
}

/** Split the utterance into clauses; each amount gets its own segment. */
function segments(text: string): { toks: string[]; spans: AmountSpan[] }[] {
  // hard boundaries: punctuation and conjunctions
  // keep digit grouping (1,500) and decimals (3.50) intact while splitting on punctuation
  const kept = text.replace(/(\d),(?=\d)/g, '$1').replace(/(\d)\.(?=\d)/g, '$1․')
  const raw = kept.split(/[,।;.!?\n]+/).map((c) => c.replace(/․/g, '.')).flatMap((c) => {
    const toks = tokenize(c)
    const out: string[][] = [[]]
    for (const t of toks) {
      if (CONJ.has(t) && out[out.length - 1].length) out.push([])
      else out[out.length - 1].push(t)
    }
    return out.filter((x) => x.length)
  })
  // re-join clauses without an amount onto their neighbour ("Ramesh ka, 340 udhaar")
  const clauses: string[][] = []
  for (const toks of raw) {
    const n = parseAmounts(toks.join(' ')).length
    if (n === 0 && clauses.length && parseAmounts(clauses[clauses.length - 1].join(' ')).length === 0)
      clauses[clauses.length - 1].push(...toks)
    else if (n === 0 && clauses.length) clauses.push(toks) // trailing words (e.g. "likh do") stay separate
    else clauses.push(toks)
  }
  // fold amount-less clauses into the previous (or next) clause that has an amount
  const merged: string[][] = []
  let carry: string[] = []
  for (const c of clauses) {
    if (parseAmounts(c.join(' ')).length === 0) {
      if (merged.length) merged[merged.length - 1].push(...c)
      else carry.push(...c)
    } else {
      merged.push([...carry, ...c])
      carry = []
    }
  }
  if (carry.length) merged.push(carry)

  // split clauses holding several amounts at the first date word / name after each amount
  const out: { toks: string[]; spans: AmountSpan[] }[] = []
  for (const c of merged) {
    const spans = parseAmounts(c.join(' '))
    if (spans.length <= 1) {
      out.push({ toks: c, spans })
      continue
    }
    let from = 0
    for (let k = 0; k < spans.length; k++) {
      let to = c.length
      if (k + 1 < spans.length) {
        to = spans[k + 1].start
        for (let i = spans[k].end; i < spans[k + 1].start; i++) {
          if (DATE_WORDS.has(c[i]) || (!stopWord(c[i]) && CASE.has(c[i + 1] ?? ''))) {
            to = i
            break
          }
        }
      }
      const seg = c.slice(from, to)
      out.push({ toks: seg, spans: parseAmounts(seg.join(' ')) })
      from = to
    }
  }
  return out
}

// ----------------------------------------------------------------- main
export function parseFast(text: string): Intent {
  const all = tokenize(text)
  if (!all.length) return { type: 'unknown' }
  const amounts = parseAmounts(text)

  // short confirmations
  if (all.length <= 3 && !amounts.length) {
    if (all.some((t) => NEG.has(t)) && all.every((t) => NEG.has(t) || FILLER.has(t) || t === 'hai' || t === 'है'))
      return { type: 'no' }
    if (all.every((t) => YES.has(t) || FILLER.has(t)) && has(YES, all)) return { type: 'yes' }
    // "jaise ki, haan" / "haan, pehle": a yes at either end with a couple of stray words (noise) is
    // still a yes, as long as nothing in it says no
    if (all.length <= 3 && (YES.has(all[0]) || YES.has(all[all.length - 1])) && !all.some((t) => NEG.has(t) || UNDO.has(t)))
      return { type: 'yes' }
  }
  // privacy / delete-all (delete-all is confirmed by the server before acting)
  if (has(PRIVACY, all) && has(ALL, all) && has(UNDO, all)) return { type: 'delete_all' }
  if (has(PRIVACY, all) || /\bai\b|kaun ho|कौन हो/.test(fold(text))) return { type: 'privacy' }

  const lead = all[0]
  // corrections: "nahi, 430" / "nahi, jama tha" / "galat, hata do"
  if (NEG.has(lead) || (all.length > 1 && NEG.has(all[1]) && !amounts.length)) {
    if (has(UNDO, all) && !amounts.length) return { type: 'undo' }
    const rest = all.slice(1)
    if (amounts.length === 1) return { type: 'correct', amount: amounts[amounts.length - 1] }
    if (amounts.length > 1) return { type: 'correct', amount: amounts[amounts.length - 1] } // "340 nahi 430"
    const dir = has(PAYMENT, rest) ? 'payment' : has(CREDIT, rest) ? 'credit' : undefined
    if (dir) return { type: 'correct', direction: dir }
    const nm = rest.filter((t) => !stopWord(t))
    if (nm.length && nm.length <= 3) return { type: 'correct', name: nm.join(' ') }
    return { type: 'no' }
  }
  // "340 nahi 430" / "Ramesh ko 500 nahi 300 udhaar" / "Ramesh 500 udhaar, nahi 300": a slip corrected in the same breath
  const negIdx = all.findIndex((t) => NEG.has(t))
  if (amounts.length === 2 && negIdx >= amounts[0].end && negIdx < amounts[1].start &&
    all.slice(amounts[0].end, amounts[1].start).every((t) => NEG.has(t) || CREDIT.has(t) || PAYMENT.has(t) || FILLER.has(t) || CASE.has(t))) {
    const before = all.slice(0, amounts[0].start).filter((t) => !stopWord(t))
    // nobody named before the slip: it fixes the last entry
    if (!before.length) return { type: 'correct', amount: amounts[1] }
    // a name was said: this is one new entry with the second amount (keep the direction words, drop the slip)
    const kept = all.filter((_t, i) => (i < amounts[0].start || i >= amounts[0].end) && i !== negIdx)
    return parseFast(kept.join(' '))
  }
  if (has(UNDO, all) && !amounts.length) return { type: 'undo' }

  if (!amounts.length) {
    if (has(REMIND, all)) {
      const n = findName(all, all.length)
      return { type: 'remind', name: n?.name ?? null }
    }
    if (has(SUMMARY, all)) return { type: 'summary', period: has(MONTH, all) ? 'month' : 'today' }
    if (has(QUERY, all) || has(WHO, all)) {
      const n = findName(all, all.length)
      if (has(WHO, all)) return { type: 'query', name: null, scope: 'dues' }
      if (n && !has(D_TODAY, [n.name])) return { type: 'query', name: n.name, scope: 'customer' }
      if (has(MONTH, all)) return { type: 'summary', period: 'month' }
      if (has(D_TODAY, all) && has(CREDIT, all)) return { type: 'query', name: null, scope: 'today_credit' }
      if (has(D_TODAY, all) && (has(PAYMENT, all) || has(GIVE, all))) return { type: 'query', name: null, scope: 'today_payment' }
      if (has(D_TODAY, all) || all.includes('hisaab') || all.includes('हिसाब')) return { type: 'summary', period: 'today' }
      return { type: 'query', name: null, scope: 'dues' }
    }
    return { type: 'unknown' }
  }

  // ledger entries
  const entries: EntryIntent[] = []
  let lastName: string | null = null
  for (const seg of segments(text)) {
    for (const span of seg.spans) {
      // "do kilo cheeni", "2 packet doodh": a quantity of goods, not money
      if (UNITS.has(seg.toks[span.end] ?? '')) continue
      const reasons: string[] = []
      const hit = findName(seg.toks, span.start)
      const name: string | null = hit?.name ?? lastName
      if (!hit && lastName) reasons.push('name-inherited')
      if (!name) reasons.push('no-name')
      const { dir, why } = resolveDirection(seg.toks, hit?.marker ?? null)
      if (!dir) reasons.push(why)
      const date = resolveDate(seg.toks)
      if (date.ambiguous) reasons.push('kal-tense-unclear')
      const promise = date.future && dir !== 'credit'
      for (const f of span.flags) if (f !== 'fractional_rupee') reasons.push(f)
      const lowReasons = reasons.filter((r) => r !== 'name-inherited')
      entries.push({
        name,
        amount: span,
        direction: dir ?? (promise ? 'payment' : null),
        dayOffset: date.dayOffset,
        promise,
        confidence: lowReasons.length ? 'low' : 'high',
        reasons,
      })
      if (name) lastName = name
    }
  }
  // no name AND no direction cue: too weak to be a ledger line (usually talk to a customer)
  const real = entries.filter((e) => e.name || e.direction)
  if (!real.length) return { type: 'unknown' }
  // A list with one direction word ("Ramesh 200, Suresh 300, Geeta 150 udhaar", "sab udhaar: ..."):
  // the word covers the whole list. With an explicit "all" it is certain; without, the agent asks once.
  const dirs = new Set(real.map((e) => e.direction).filter(Boolean))
  // The word covers the list only when it closes the list ("..., Geeta 150 udhaar") or "sab/all" is said;
  // "Anil ka 150 udhaar aur Ravi 1200" leaves Ravi unknown.
  const isAll = has(ALL, all) || has(BOTH, all)
  const closing = !!real[real.length - 1].direction && real.slice(0, -1).every((e) => !e.direction)
  if (real.length > 1 && dirs.size === 1 && real.some((e) => !e.direction) && (isAll || closing)) {
    const dir = [...dirs][0] as Direction
    for (const e of real) {
      if (e.direction) continue
      e.direction = dir
      e.reasons = e.reasons.filter((r) => r !== 'no-direction-cue')
      e.reasons.push(isAll ? 'dir-all' : 'dir-shared')
      if (!e.reasons.some((r) => r !== 'name-inherited' && r !== 'dir-all' && r !== 'dir-shared')) e.confidence = 'high'
    }
  }
  return { type: 'entries', entries: real }
}

const CHANGE = S('badlo', 'बदलो', 'badal', 'बदल', 'change', 'edit', 'modify', 'update', 'wala', 'वाला', 'wali', 'वाली', 'wale', 'वाले',
  'galat', 'गलत', 'asal', 'असल', 'actually', 'instead', 'entry', 'एंट्री', 'ಬದಲಾಯಿಸು', 'ಬದಲಿಸು', 'மாற்று', 'మార్చు')
/** The shopkeeper is fixing or removing something already written ("Geeta wali entry hata do"). */
export function mentionsChange(text: string): boolean {
  return tokenize(text).some((t) => CHANGE.has(t) || UNDO.has(t) || NEG.has(t))
}

/** Words that point back at the conversation: "uska", "him", "same", "bhi", "another". */
export function refersBack(text: string): boolean {
  return tokenize(text).some((t) => BACKREF.has(t))
}

// ----------------------------------------------------------------- end of turn
// Verbs that a closing "do/de/lo" can follow ("likh do", "jod do", "chadha do", "hata do").
const AUX_BEFORE_DO = S('likh', 'लिख', 'jod', 'जोड़', 'जोड', 'chadha', 'चढ़ा', 'kar', 'कर', 'hata', 'हटा', 'mita', 'मिटा',
  'daal', 'डाल', 'note', 'save', 'chuka', 'चुका', 'de', 'दे', 'bata', 'बता')
const CLOSERS = new Set([...CREDIT, ...PAYMENT, ...GIVE, ...GAVE_3P, ...GAVE_1P, ...TOOK, ...GAYA, ...PAST, ...FUTURE,
  ...S('hai', 'है', 'hain', 'हैं', 'kiye', 'किए', 'kiya', 'किया', 'karo', 'करो', 'dena', 'देना', 'lena', 'लेना', 'gayi', 'gaye',
    'please', 'ji', 'जी', 'ಬರೆ', 'ಬರೆಯಿರಿ', 'எழுது', 'రాయి', 'ಇದೆ', 'இருக்கு', 'ఉంది')])

const QUERY_END = S('kitna', 'kitne', 'कितना', 'कितने', 'hai', 'है', 'batao', 'बताओ', 'bolo', 'बोलो', 'sunao', 'सुनाओ',
  'dilao', 'दिलाओ', 'karo', 'करो', 'ಎಷ್ಟು', 'எவ்வளவு', 'ఎంత', 'എത്ര', 'please')

/**
 * Does this (partial) transcript read as a finished turn? Used with a short audio pause to
 * send Prisma's `commit` early instead of waiting for its silence timer. Conservative: when
 * in doubt it says no, and Prisma's own silence detection ends the turn as usual.
 */
export function turnComplete(text: string): boolean {
  const toks = tokenize(text)
  if (!toks.length) return false
  const last = toks[toks.length - 1]
  const prev = toks[toks.length - 2]
  const closingDo = (last === 'do' || last === 'दो' || last === 'lo' || last === 'लो' || last === 'de' || last === 'दे') &&
    !!prev && AUX_BEFORE_DO.has(prev)
  const intent = parseFast(text)
  // a correction ending in digits ("nahi, 430") is final: Prisma emits digits only for whole numbers
  if (intent.type === 'correct' && intent.amount && isNumberish(last)) return true
  // still mid-phrase: a number (could grow: "teen sau ... chaalis"), case marker, conjunction, date
  if (!closingDo && (isNumberWord(last) || isNumberish(last) || CASE.has(last) || CONJ.has(last) || DATE_WORDS.has(last)))
    return false
  switch (intent.type) {
    case 'yes':
    case 'no':
    case 'undo':
    case 'privacy':
    case 'delete_all':
      return true
    case 'correct':
      return !!(intent.amount || intent.direction || intent.name)
    case 'query':
    case 'summary':
    case 'remind':
      return QUERY_END.has(last) || closingDo || /[?？]\s*$/.test(text)
    case 'entries': {
      if (!intent.entries.every((e) => e.name && (e.direction || e.promise))) return false
      if (closingDo) return true
      return CLOSERS.has(last) || /[।.!]\s*$/.test(text)
    }
    default:
      return false
  }
}

// ----------------------------------------------------------------- answers to follow-up questions
/** "udhaar" / "jama kiya" / "ಕೊಟ್ಟರು" on its own: the direction asked for, or null. */
export function directionAnswer(text: string): Direction | null {
  const toks = tokenize(text)
  if (!toks.length) return null
  return resolveDirection(toks, null).dir
}

/** A bare name answer ("Ramesh", "रमेश वाले", "Sharma ji"): content words with fillers removed. */
export function nameAnswer(text: string): string | null {
  const words = tokenize(text).filter((t) => !stopWord(t) || t === 'ji' || t === 'जी')
  const name = words.filter((w, i) => !(i === 0 && (w === 'ji' || w === 'जी'))).slice(0, 3).join(' ')
  return name || null
}

/** Does the text mention an amount of money (not "do kilo", not a bare number word in chatter)? */
export function mentionsMoney(text: string): boolean {
  const toks = tokenize(text)
  return parseAmounts(text).some((a) => !UNITS.has(toks[a.end] ?? '') && (a.hasCurrency || /\d/.test(a.text) || a.end - a.start > 1))
}

/**
 * True when the sentence has words the fast path could not place (not a name, number, currency,
 * filler or known ledger word). Only then can an LLM add anything; "Ramesh, 300" has none, so
 * the agent should just ask the missing part.
 */
export function hasUnplacedWords(text: string, names: (string | null)[]): boolean {
  const nameToks = new Set(names.filter((n): n is string => !!n).flatMap((n) => tokenize(n)))
  return tokenize(text).some((t) => !stopWord(t) && !nameToks.has(t) && !nameToks.has(stripSuffix(t).base))
}
