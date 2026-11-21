/**
 * Deterministic Indic + English spoken-amount parser.
 *
 * Input: an STT transcript (Prisma v3.0 `transcribe` gives digits, `codemix` gives number
 * words, and real speech mixes both). Output: every amount span with its value in rupees,
 * the tokens it came from, and flags that tell the agent when to confirm instead of saving.
 *
 * Lexicons follow the research tables (Hindi 0-100 is irregular, so it is listed in full;
 * Dravidian languages fuse hundreds and suffix the half: ಮೂರುವರೆ / மூன்றரை / మూడున్నర = 3.5).
 */

export type AmountFlag =
  | 'from-context' // copied from a recent entry ("same for Suresh"), not spoken in this turn
  | 'elided_scale' // "teen chaalis" read as 340 (scale word not spoken)
  | 'bare_fraction' // "saadhe teen" with no sau/hazaar: 3.5? 350? 3500?
  | 'confusable' // contains a word with a sound-alike number (saath/saat, fifteen/fifty...)
  | 'digit_sequence' // "teen chaar zero" read digit by digit
  | 'fractional_rupee' // value has paise
  | 'approx_range' // "do teen sau" = 200-300, never a single exact amount

export interface AmountSpan {
  value: number // rupees, may include paise (e.g. 3.5)
  start: number // token index (inclusive)
  end: number // token index (exclusive)
  text: string // the surface text of the span
  hasCurrency: boolean // ₹ / rs / rupaye adjacent
  flags: AmountFlag[]
  alternatives: number[] // other plausible values (for confusable / ambiguous spans)
}

type Kind = 'num' | 'scale' | 'pre_frac' | 'mult' | 'currency' | 'paise' | 'and'
interface Lex {
  kind: Kind
  v: number
  confusable?: number // value of the sound-alike partner
}

// ---------------------------------------------------------------- lexicon
const LEX = new Map<string, Lex>()
const add = (kind: Kind, v: number, ...words: string[]) => {
  for (const w of words) LEX.set(fold(w), { kind, v })
}

// Hindi / Hindustani 0..100, Devanagari + common romanisations (index = value).
const HI: string[][] = [
  ['शून्य', 'सिफ़र', 'shunya', 'sifar', 'zero'],
  ['एक', 'ek', 'ik'],
  ['दो', 'do', 'doh'],
  ['तीन', 'teen', 'tin'],
  ['चार', 'chaar', 'char', 'chār'],
  ['पाँच', 'पांच', 'paanch', 'panch', 'paanch'],
  ['छह', 'छः', 'छे', 'छै', 'chhah', 'chhe', 'che', 'chah', 'chheh'],
  ['सात', 'saat', 'sat'],
  ['आठ', 'aath', 'aat', 'ath'],
  ['नौ', 'nau'],
  ['दस', 'das', 'dus'],
  ['ग्यारह', 'gyarah', 'gyaarah', 'gyara'],
  ['बारह', 'barah', 'baarah', 'bara', 'baara'],
  ['तेरह', 'terah', 'tera'],
  ['चौदह', 'chaudah', 'chauda', 'chodah'],
  ['पंद्रह', 'पन्द्रह', 'pandrah', 'pandraah', 'pandra'],
  ['सोलह', 'solah', 'sola'],
  ['सत्रह', 'satrah', 'satra'],
  ['अठारह', 'atharah', 'athara', 'attharah'],
  ['उन्नीस', 'unnees', 'unnis', 'unees'],
  ['बीस', 'bees', 'bis'],
  ['इक्कीस', 'ikkees', 'ikkis'],
  ['बाईस', 'baaees', 'baais', 'bais'],
  ['तेईस', 'teyees', 'teis', 'teyis'],
  ['चौबीस', 'chaubees', 'chaubis'],
  ['पच्चीस', 'pachchees', 'pachees', 'pacchis', 'pachis'],
  ['छब्बीस', 'chhabbees', 'chabbis'],
  ['सत्ताईस', 'sattaees', 'sattaais', 'sattais'],
  ['अट्ठाईस', 'atthaees', 'athais', 'atthais'],
  ['उनतीस', 'untees', 'untis'],
  ['तीस', 'tees', 'tis'],
  ['इकतीस', 'ikattees', 'iktees', 'ikatis'],
  ['बत्तीस', 'battees', 'battis'],
  ['तैंतीस', 'taintees', 'tentis', 'taintis'],
  ['चौंतीस', 'chauntees', 'chontis', 'chauntis'],
  ['पैंतीस', 'paintees', 'pentis', 'paintis'],
  ['छत्तीस', 'chhattees', 'chattis', 'chhattis'],
  ['सैंतीस', 'saintees', 'saintis', 'sentis'],
  ['अड़तीस', 'अडतीस', 'adtees', 'artis', 'adtis'],
  ['उनतालीस', 'untaalees', 'untalis'],
  ['चालीस', 'chaalees', 'chalis', 'chaalis', 'chalees'],
  ['इकतालीस', 'iktaalees', 'iktalis'],
  ['बयालीस', 'bayaalees', 'bayalis'],
  ['तैंतालीस', 'taintaalees', 'tentalis', 'taintalis'],
  ['चौवालीस', 'चवालीस', 'chauvaalees', 'chavalis', 'chauvalis'],
  ['पैंतालीस', 'paintaalees', 'pentalis', 'paintalis'],
  ['छियालीस', 'chhiyaalees', 'chiyalis', 'chhiyalis'],
  ['सैंतालीस', 'saintaalees', 'saintalis', 'sentalis'],
  ['अड़तालीस', 'अडतालीस', 'adtaalees', 'artalis', 'adtalis'],
  ['उनचास', 'unchaas', 'unchas'],
  ['पचास', 'pachaas', 'pachas'],
  ['इक्यावन', 'ikyaavan', 'ikyavan'],
  ['बावन', 'baavan', 'bavan'],
  ['तिरपन', 'तिरेपन', 'tirpan', 'tirepan'],
  ['चौवन', 'chauvan', 'chovan'],
  ['पचपन', 'pachpan'],
  ['छप्पन', 'chhappan', 'chappan'],
  ['सत्तावन', 'sattaavan', 'sattavan'],
  ['अट्ठावन', 'atthaavan', 'athavan', 'atthavan'],
  ['उनसठ', 'unsath', 'unsat'],
  ['साठ', 'saath'],
  ['इकसठ', 'iksath'],
  ['बासठ', 'baasath', 'basath'],
  ['तिरसठ', 'tirsath', 'tiresath'],
  ['चौंसठ', 'chaunsath', 'chausath', 'chonsath'],
  ['पैंसठ', 'painsath', 'pensath'],
  ['छियासठ', 'chhiyaasath', 'chiyasath'],
  ['सड़सठ', 'सडसठ', 'sadsath', 'sarsath'],
  ['अड़सठ', 'अडसठ', 'adsath', 'arsath'],
  ['उनहत्तर', 'unhattar'],
  ['सत्तर', 'sattar'],
  ['इकहत्तर', 'ikhattar'],
  ['बहत्तर', 'bahattar'],
  ['तिहत्तर', 'tihattar'],
  ['चौहत्तर', 'chauhattar'],
  ['पचहत्तर', 'pachhattar', 'pachattar'],
  ['छिहत्तर', 'chhihattar', 'chihattar'],
  ['सतहत्तर', 'satahattar', 'sathattar'],
  ['अठहत्तर', 'athhattar', 'athattar'],
  ['उनासी', 'उन्यासी', 'unaasi', 'unasi'],
  ['अस्सी', 'assi', 'asi'],
  ['इक्यासी', 'ikyaasi', 'ikyasi'],
  ['बयासी', 'bayaasi', 'bayasi'],
  ['तिरासी', 'tiraasi', 'tirasi'],
  ['चौरासी', 'chauraasi', 'chaurasi'],
  ['पचासी', 'pachaasi', 'pachasi'],
  ['छियासी', 'chhiyaasi', 'chiyasi'],
  ['सत्तासी', 'sattaasi', 'sattasi'],
  ['अट्ठासी', 'atthaasi', 'athasi'],
  ['नवासी', 'navaasi', 'navasi'],
  ['नब्बे', 'nabbe'],
  ['इक्यानवे', 'ikyaanave', 'ikyanve'],
  ['बानवे', 'baanave', 'banve'],
  ['तिरानवे', 'tiraanave', 'tiranve'],
  ['चौरानवे', 'chauraanave', 'chauranve'],
  ['पंचानवे', 'panchaanave', 'panchanve'],
  ['छियानवे', 'chhiyaanave', 'chiyanve'],
  ['सत्तानवे', 'sattaanave', 'sattanve'],
  ['अट्ठानवे', 'atthaanave', 'athanve'],
  ['निन्यानवे', 'ninyaanave', 'ninyanve'],
]
HI.forEach((ws, v) => add('num', v, ...ws))

// English
const EN_UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
EN_UNITS.forEach((w, v) => add('num', v, w))
;['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'].forEach((w, i) =>
  add('num', (i + 2) * 10, w))
add('num', 40, 'fourty')

// Scales (all languages). Combining forms included (ನೂರ, நூற்று, వందల, ആയിരത്തി ...).
add('scale', 100, 'सौ', 'सैकड़ा', 'sau', 'sao', 'hundred', 'शंभर', 'শো', 'সো', 'সৌ', 'સો', 'ਸੌ',
  'ನೂರು', 'ನೂರ', 'நூறு', 'நூற்று', 'நூத்தி', 'వంద', 'వందలు', 'వందల', 'నూట', 'നൂറ്', 'നൂറ്റി', 'nooru', 'nuru', 'vanda', 'noor')
add('scale', 1000, 'हज़ार', 'हजार', 'hazaar', 'hazar', 'hajar', 'hajaar', 'thousand', 'हज़ार', 'হাজার', 'હજાર',
  'ਹਜ਼ਾਰ', 'ਹਜਾਰ', 'ಸಾವಿರ', 'ಸಾವಿರದ', 'ஆயிரம்', 'ஆயிரத்து', 'ஆயிரத்தி', 'వెయ్యి', 'వేల', 'వేలు', 'ആയിരം',
  'ആയിരത്തി', 'saavira', 'savira', 'aayiram', 'ayiram', 'veyyi', 'velu')
add('scale', 100000, 'लाख', 'lakh', 'laakh', 'lac', 'lakhs', 'লাখ', 'লক্ষ', 'લાખ', 'ਲੱਖ', 'ಲಕ್ಷ', 'இலட்சம்',
  'லட்சம்', 'లక్ష', 'లక్షలు', 'ലക്ഷം', 'laksha')
add('scale', 10000000, 'करोड़', 'करोड', 'crore', 'karod', 'karor', 'crores', 'কোটি', 'કરોડ', 'ਕਰੋੜ', 'ಕೋಟಿ',
  'கோடி', 'కోటి', 'കോടി', 'कोटी')

// Fraction prefixes (Indo-Aryan put the fraction word BEFORE the number).
add('pre_frac', 0.5, 'साढ़े', 'साढे', 'saadhe', 'sadhe', 'saade', 'saare', 'साडे', 'সাড়ে', 'સાડા', 'ਸਾਢੇ')
add('pre_frac', 0.25, 'सवा', 'sawa', 'sava', 'सव्वा', 'সওয়া', 'સવા', 'ਸਵਾ')
add('pre_frac', -0.25, 'पौने', 'paune', 'pone', 'paune', 'पावणे', 'পৌনে', 'પોણા', 'ਪੌਣੇ')
// Fixed multipliers: these set the coefficient themselves (dedh sau = 150).
add('mult', 1.5, 'डेढ़', 'डेढ', 'dedh', 'derh', 'ded', 'दीड', 'দেড়', 'દોઢ', 'ਡੇਢ', 'ಒಂದೂವರೆ', 'ஒன்றரை',
  'ஒண்ணரை', 'ఒకటిన్నర', 'ഒന്നര')
add('mult', 2.5, 'ढाई', 'अढ़ाई', 'dhai', 'dhaai', 'adhai', 'अडीच', 'আড়াই', 'અઢી', 'ਢਾਈ', 'ಎರಡೂವರೆ',
  'இரண்டரை', 'ரெண்டரை', 'రెండున్నర', 'രണ്ടര')
add('mult', 3.5, 'ಮೂರೂವರೆ', 'ಮೂರುವರೆ', 'மூன்றரை', 'மூணரை', 'మూడున్నర', 'മൂന്നര')
add('mult', 4.5, 'ನಾಲ್ಕೂವರೆ', 'நாலரை', 'நான்கரை', 'నాలుగున్నర', 'നാലര')
add('mult', 5.5, 'ಐದೂವರೆ', 'ஐந்தரை', 'அஞ்சரை', 'ఐదున్నర', 'അഞ്ചര')
add('mult', 0.5, 'आधा', 'आधे', 'adha', 'aadha', 'half', 'ಅರ್ಧ', 'அரை', 'అర', 'അര')

// Kannada / Tamil / Telugu / Malayalam units, teens, tens, fused hundreds.
const DRAV: [number, ...string[]][] = [
  [0, 'ಸೊನ್ನೆ', 'பூஜ்யம்', 'சுழியம்', 'సున్న', 'പൂജ്യം'],
  [1, 'ಒಂದು', 'ஒன்று', 'ஒண்ணு', 'ఒకటి', 'ఒక', 'ഒന്ന്', 'ondu', 'onnu', 'okati'],
  [2, 'ಎರಡು', 'இரண்டு', 'ரெண்டு', 'రెండు', 'രണ്ട്', 'eradu', 'rendu', 'irandu'],
  [3, 'ಮೂರು', 'மூன்று', 'மூணு', 'మూడు', 'മൂന്ന്', 'mooru', 'moonu', 'moodu'],
  [4, 'ನಾಲ್ಕು', 'நான்கு', 'நாலு', 'నాలుగు', 'നാല്', 'naalku', 'nalku', 'naalu', 'nalugu'],
  [5, 'ಐದು', 'ஐந்து', 'அஞ்சு', 'ఐదు', 'അഞ്ച്', 'aidu', 'ainthu', 'anju', 'aidu'],
  [6, 'ಆರು', 'ஆறு', 'ఆరు', 'ആറ്', 'aaru', 'aaru'],
  [7, 'ಏಳು', 'ஏழு', 'ఏడు', 'ഏഴ്', 'ഏഴു', 'elu', 'ezhu', 'edu'],
  [8, 'ಎಂಟು', 'எட்டு', 'ఎనిమిది', 'എട്ട്', 'entu', 'ettu', 'enimidi'],
  [9, 'ಒಂಬತ್ತು', 'ஒன்பது', 'தொம்பது', 'తొమ్మిది', 'ഒമ്പത്', 'ombattu', 'onbathu', 'tommidi'],
  [10, 'ಹತ್ತು', 'பத்து', 'పది', 'പത്ത്', 'hattu', 'pathu', 'padi'],
  [11, 'ಹನ್ನೊಂದು', 'பதினொன்று', 'పదకొండు', 'പതിനൊന്ന്'],
  [12, 'ಹನ್ನೆರಡು', 'பன்னிரண்டு', 'పన్నెండు', 'പന്ത്രണ്ട്'],
  [13, 'ಹದಿಮೂರು', 'பதின்மூன்று', 'పదమూడు', 'പതിമൂന്ന്'],
  [14, 'ಹದಿನಾಲ್ಕು', 'பதினான்கு', 'పద్నాలుగు', 'പതിനാല്', 'പതിനാൽ'],
  [15, 'ಹದಿನೈದು', 'பதினைந்து', 'పదిహేను', 'പതിനഞ്ച്'],
  [16, 'ಹದಿನಾರು', 'பதினாறு', 'పదహారు', 'പതിനാറ്'],
  [17, 'ಹದಿನೇಳು', 'பதினேழு', 'పదిహేడు', 'പതിനേഴ്'],
  [18, 'ಹದಿನೆಂಟು', 'பதினெட்டு', 'పద్దెనిమిది', 'പതിനെട്ട്'],
  [19, 'ಹತ್ತೊಂಬತ್ತು', 'பத்தொன்பது', 'పంతొమ్మిది', 'പത്തൊമ്പത്', 'പത്തൊൻപത്'],
  [20, 'ಇಪ್ಪತ್ತು', 'இருபது', 'ఇరవై', 'ഇരുപത്', 'ippattu', 'irubathu', 'iravai'],
  [25, 'ಇಪ್ಪತ್ತೈದು', 'இருபத்தைந்து', 'పాతిక'],
  [30, 'ಮೂವತ್ತು', 'முப்பது', 'ముప్పై', 'മുപ്പത്', 'moovattu', 'muppathu', 'muppai'],
  [40, 'ನಲವತ್ತು', 'நாற்பது', 'நாப்பது', 'నలభై', 'നാൽപ്പത്', 'നാല്പത്', 'നാൽപത്', 'nalavattu', 'naarpathu', 'nalabhai'],
  [50, 'ಐವತ್ತು', 'ஐம்பது', 'அம்பது', 'యాభై', 'యాబై', 'അൻപത്', 'അമ്പത്', 'aivattu', 'aimbathu', 'yaabhai'],
  [60, 'ಅರವತ್ತು', 'அறுபது', 'అరవై', 'അറുപത്', 'aravattu', 'arubathu', 'aravai'],
  [70, 'ಎಪ್ಪತ್ತು', 'எழுபது', 'எழுவது', 'డెబ్బై', 'എഴുപത്', 'eppattu', 'ezhubathu', 'debbai'],
  [80, 'ಎಂಬತ್ತು', 'எண்பது', 'ఎనభై', 'എൺപത്', 'embattu', 'enbathu', 'enabhai'],
  [90, 'ತೊಂಬತ್ತು', 'தொண்ணூறு', 'తొంభై', 'തൊണ്ണൂറ്', 'tombattu', 'thonnooru', 'tombhai'],
  // fused hundreds
  [200, 'ಇನ್ನೂರು', 'ಇನ್ನೂರ', 'இருநூறு', 'இருநூற்று', 'రెండొందలు', 'ഇരുനൂറ്', 'ഇരുന്നൂറ്', 'innooru'],
  [300, 'ಮುನ್ನೂರು', 'ಮುನ್ನೂರ', 'முந்நூறு', 'முன்னூறு', 'முந்நூற்று', 'முன்னூற்று', 'మూడొందలు', 'മുന്നൂറ്', 'മുന്നൂറ്റി', 'munnooru'],
  [400, 'ನಾನೂರು', 'ನಾನೂರ', 'நானூறு', 'நானூற்று', 'నాలుగొందలు', 'നാനൂറ്', 'നാന്നൂറ്', 'naanooru'],
  [500, 'ಐನೂರು', 'ಐನೂರ', 'ஐநூறு', 'ஐநூற்று', 'ఐదొందలు', 'అయిదొందలు', 'അഞ്ഞൂറ്', 'ainooru'],
  [600, 'ಆರುನೂರು', 'ಆರುನೂರ', 'அறுநூறு', 'அறுநூற்று', 'ఆరొందలు', 'അറുനൂറ്', 'അറുനൂറ്റി'],
  [700, 'ಏಳುನೂರು', 'ಏಳುನೂರ', 'எழுநூறு', 'எழுநூற்று', 'ఏడొందలు', 'എഴുനൂറ്', 'എഴുനൂറ്റി'],
  [800, 'ಎಂಟುನೂರು', 'ಎಂಟುನೂರ', 'எண்ணூறு', 'எண்ணூற்று', 'ఎనిమిదొందలు', 'എണ്ണൂറ്', 'എണ്ണൂറ്റി'],
  [900, 'ಒಂಬೈನೂರು', 'ಒಂಬೈನೂರ', 'ಒಂಬತ್ತುನೂರು', 'தொள்ளாயிரம்', 'தொள்ளாயிரத்து', 'తొమ్మిదొందలు', 'തൊള്ളായിരം'],
]
for (const [v, ...ws] of DRAV) add('num', v, ...ws)

// Marathi / Bengali / Gujarati / Punjabi core forms + fused hundreds.
const IA: [number, ...string[]][] = [
  [1, 'এক', 'એક', 'ਇੱਕ', 'ਇਕ'], [2, 'दोन', 'দুই', 'দু', 'બે', 'ਦੋ'], [3, 'তিন', 'ત્રણ', 'ਤਿੰਨ'],
  [4, 'চার', 'ચાર', 'ਚਾਰ'], [5, 'पाच', 'পাঁচ', 'પાંચ', 'ਪੰਜ'], [6, 'सहा', 'ছয়', 'છ', 'ਛੇ'],
  [7, 'সাত', 'સાત', 'ਸੱਤ'], [8, 'আট', 'આઠ', 'ਅੱਠ'], [9, 'नऊ', 'নয়', 'નવ', 'ਨੌਂ'],
  [10, 'दहा', 'দশ', 'દસ', 'ਦਸ'], [20, 'वीस', 'কুড়ি', 'বিশ', 'વીસ', 'ਵੀਹ'], [30, 'ত্রিশ', 'ત્રીસ', 'ਤੀਹ'],
  [40, 'चाळीस', 'চল্লিশ', 'ચાલીસ', 'ਚਾਲੀ'], [50, 'पन्नास', 'পঞ্চাশ', 'પચાસ', 'ਪੰਜਾਹ'],
  [60, 'ষাট', 'સાઠ', 'ਸੱਠ'], [70, 'সত্তর', 'સિત્તેર', 'ਸੱਤਰ'], [80, 'ऐंशी', 'আশি', 'એંસી', 'ਅੱਸੀ'],
  [90, 'नव्वद', 'নব্বই', 'નેવું', 'ਨੱਬੇ'],
  [100, 'একশো', 'একশ'], [200, 'दोनशे', 'দুশো', 'দুইশো', 'બસો'], [300, 'तीनशे', 'তিনশো', 'ત્રણસો'],
  [400, 'चारशे', 'চারশো', 'ચારસો'], [500, 'पाचशे', 'পাঁচশো', 'પાંચસો'], [250, 'अडीचशे', 'আড়াইশো', 'અઢીસો'],
  [150, 'दीडशे', 'দেড়শো', 'દોઢસો'], [350, 'साडेतीनशे'], [125, 'सव्वाशे', 'સવાસો'],
  // teens (Marathi "तेरा" left out: in Hindi it is "your")
  [11, 'अकरा', 'এগারো', 'અગિયાર', 'ਗਿਆਰਾਂ'], [12, 'बारा', 'বারো', 'બાર', 'ਬਾਰਾਂ'], [13, 'তেরো', 'તેર', 'ਤੇਰਾਂ'],
  [14, 'चौदा', 'চোদ্দ', 'চৌদ্দ', 'ચૌદ', 'ਚੌਦਾਂ'], [15, 'पंधरा', 'পনেরো', 'પંદર', 'ਪੰਦਰਾਂ'], [16, 'सोळा', 'ষোলো', 'ষোল', 'સોળ', 'ਸੋਲਾਂ'],
  [17, 'सतरा', 'সতেরো', 'સત્તર', 'ਸਤਾਰਾਂ', 'ਸਤਾਰ੍ਹਾਂ'], [18, 'अठरा', 'আঠারো', 'અઢાર', 'ਅਠਾਰਾਂ'], [19, 'एकोणीस', 'উনিশ', 'ઓગણીસ', 'ਉੱਨੀ'],
  // fused hundreds 100 and 600-900 (Marathi -शे, Bengali -শো, Gujarati -સો)
  [100, 'एकशे', 'એકસો'], [600, 'सहाशे', 'ছশো', 'ছয়শো', 'છસો'], [700, 'सातशे', 'সাতশো', 'સાતસો'],
  [800, 'आठशे', 'আটশো', 'আটশ', 'આઠસો'], [900, 'नऊशे', 'নশো', 'নয়শো', 'નવસો'],
]
for (const [v, ...ws] of IA) add('num', v, ...ws)

// Currency + glue.
for (const w of ['₹', 'rs', 'rs.', 'inr', 'रु', 'रू', 'रुपया', 'रुपये', 'रुपए', 'रूपये', 'rupaye', 'rupees', 'rupee',
  'rupiya', 'rupaiya', 'rupay', 'ரூ', 'ரூபாய்', 'ரூபா', 'ರೂ', 'ರೂಪಾಯಿ', 'రూ', 'రూపాయలు', 'రూపాయి', 'రూపాయల', 'টাকা', 'রুপি',
  'રૂપિયા', 'ਰੁਪਏ', 'രൂപ', 'rupayi']) add('currency', 0, w)
for (const w of ['पैसे', 'पैसा', 'paise', 'paisa', 'பைசா', 'ಪೈಸೆ', 'పైసలు']) add('paise', 0, w)
for (const w of ['and']) add('and', 0, w) // only English "and" glues inside a number ("one hundred and five")

// Confusable pairs (one phoneme apart; noise erases the difference).
const CONFUSE: [string[], number, number][] = [
  [['साठ', 'saath'], 60, 7],
  [['सात', 'saat', 'sat'], 7, 60],
  [['सत्तर', 'sattar'], 70, 17],
  [['सत्रह', 'satrah', 'satra'], 17, 70],
  [['तीन', 'teen', 'tin'], 3, 30],
  [['तीस', 'tees', 'tis'], 30, 3],
  [['पचास', 'pachaas', 'pachas'], 50, 25],
  [['पच्चीस', 'pachchees', 'pachees', 'pacchis', 'pachis'], 25, 50],
  [['नौ', 'nau'], 9, 90],
  [['नब्बे', 'nabbe'], 90, 9],
  [['चौदह', 'chaudah', 'chauda'], 14, 40],
  [['चालीस', 'chaalees', 'chalis', 'chaalis'], 40, 14],
  [['thirteen'], 13, 30], [['thirty'], 30, 13], [['fourteen'], 14, 40], [['forty', 'fourty'], 40, 14],
  [['fifteen'], 15, 50], [['fifty'], 50, 15], [['sixteen'], 16, 60], [['sixty'], 60, 16],
  [['seventeen'], 17, 70], [['seventy'], 70, 17], [['eighteen'], 18, 80], [['eighty'], 80, 18],
  [['nineteen'], 19, 90], [['ninety'], 90, 19],
  // 17 / 70 in Marathi, Bengali, Gujarati (where સત્તર is 17, not 70), Punjabi
  [['सतरा', 'সতেরো', 'સત્તર', 'ਸਤਾਰਾਂ', 'ਸਤਾਰ੍ਹਾਂ'], 17, 70], [['সত্তর', 'સિત્તેર', 'ਸੱਤਰ'], 70, 17],
  [['ಏಳು', 'ஏழு'], 7, 70], [['ಎಪ್ಪತ್ತು', 'எழுபது'], 70, 7], [['ಐದು', 'ஐந்து'], 5, 50], [['ಐವತ್ತು', 'ஐம்பது'], 50, 5],
]
for (const [ws, v, partner] of CONFUSE) for (const w of ws) {
  const e = LEX.get(fold(w))
  if (e && e.v === v) e.confusable = partner
}

// Words after which "do"/"दो" is the verb "give/do" ("likh do", "de do"), not the number 2.
const VERB_BEFORE_DO = new Set(['लिख', 'likh', 'लिखो', 'de', 'दे', 'kar', 'कर', 'rakh', 'रख', 'bata', 'बता', 'chadha', 'चढ़ा',
  'chada', 'daal', 'डाल', 'dal', 'ghata', 'घटा', 'kaat', 'काट', 'kat', 'hata', 'हटा', 'jod', 'जोड़', 'जोड', 'mita', 'मिटा',
  'bhej', 'भेज', 'sun', 'सुन', 'dekh', 'देख', 'bol', 'बोल', 'sudhaar', 'सुधार', 'badal', 'बदल', 'ho', 'हो', 'jaane', 'जाने'].map(fold))
const DO = new Set(['दो', 'do'])

// ---------------------------------------------------------------- normalise
const DIGIT_ZEROS = [0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66]

/** Script normalisation: NFC, zero-widths out, native digits to ASCII, lower-case Latin. */
export function fold(s: string): string {
  let out = s.normalize('NFC').replace(/[​-‍﻿]/g, '').toLowerCase()
  out = out.replace(/[०-९০-৯੦-੯૦-૯୦-୯௦-௯౦-౯೦-೯൦-൯]/g,
    (c) => {
      const cp = c.codePointAt(0)!
      const z = DIGIT_ZEROS.find((z0) => cp >= z0 && cp <= z0 + 9)!
      return String(cp - z)
    })
  return out
}

/** Split into tokens; digit groups like 1,20,000 / 2,500 / 340/- / ₹340 become clean numerals. */
export function tokenize(text: string): string[] {
  let t = fold(text)
  t = t.replace(/(\d),(?=\d)/g, '$1') // Indian or Western grouping commas
  t = t.replace(/\/-/g, ' ') // 340/-
  t = t.replace(/₹/g, ' ₹ ')
  t = t.replace(/\b(rs|inr)\.?(?=\d)/g, '$1 ') // rs340 -> rs 340
  t = t.replace(/(\d)([^\d\s.])/g, '$1 $2').replace(/([^\d\s.₹])(\d)/g, '$1 $2') // 340rs, रु340
  return t
    .split(/[\s\-–—,;:!?।॥"'“”‘’()[\]{}]+/)
    .map((w) => w.replace(/^\.+|\.+$/g, ''))
    .filter(Boolean)
}

// ---------------------------------------------------------------- parse
interface Tok {
  w: string
  lex?: Lex
  num?: number // literal digits
}

function lexOf(w: string): Lex | undefined {
  if (/^\d+(\.\d+)?$/.test(w)) return { kind: 'num', v: Number(w) }
  return LEX.get(w)
}

/** Value of a run of number tokens. Returns null if the run is not a number. */
function evaluate(run: Tok[]): { value: number; flags: AmountFlag[] } | null {
  let total = 0
  let cur = 0
  let curDigits = false
  let lastKind: 'unit' | 'tens' | 'teen' | 'hundreds' | 'scale' | 'mult' | null = null
  let pending: number | null = null
  const flags: AmountFlag[] = []
  let any = false

  for (const t of run) {
    const e = t.lex!
    if (e.kind === 'and') continue
    if (e.kind === 'pre_frac') {
      pending = e.v
      continue
    }
    if (e.kind === 'mult') {
      cur = e.v
      lastKind = 'mult'
      any = true
      continue
    }
    if (e.kind === 'num') {
      const v = e.v
      const isDigits = /^\d/.test(t.w)
      const cls = v >= 100 ? 'hundreds' : v >= 20 && v % 10 === 0 ? 'tens' : v >= 10 ? 'teen' : 'unit'
      any = true
      if (cur === 0 && lastKind !== 'mult') {
        cur = v
      } else if (lastKind === 'hundreds' || (lastKind === 'scale' && cur % 100 === 0 && cur > 0)) {
        if (v < 100) cur += v // ಮುನ್ನೂರ ನಲವತ್ತು, three hundred forty
        else return null
      } else if (lastKind === 'tens' && cls === 'unit' && !isDigits) {
        cur += v // forty two, ఇరవై ఐదు
      } else if (lastKind === 'unit' && (cls === 'tens' || cls === 'teen') && !curDigits) {
        cur = cur * 100 + v // "teen chaalis" = 340, "three forty" = 340
        flags.push('elided_scale')
      } else if (lastKind === 'unit' && cls === 'unit' && !isDigits && !curDigits && v === cur + 1 && cur > 0) {
        cur = v // "do teen sau" = 200-300: keep the upper bound, caller adds the lower as an alternative
        flags.push('approx_range')
      } else if (lastKind === 'unit' && cls === 'unit' && !isDigits && !curDigits) {
        cur = cur * 10 + v // "teen chaar zero" digit by digit
        flags.push('digit_sequence')
      } else if (isDigits && curDigits) {
        return null // two separate numerals ("340 200") are two spans, handled by caller
      } else {
        return null
      }
      curDigits = isDigits
      lastKind = cls === 'hundreds' ? 'hundreds' : cls
      continue
    }
    if (e.kind === 'scale') {
      let base = cur === 0 ? 1 : cur
      if (pending !== null) {
        base += pending
        pending = null
      }
      if (e.v === 100) {
        // "N sau" with N up to 99 (baarah sau = 1200); hundreds inside a thousands block.
        cur = base * 100
        lastKind = 'scale'
      } else {
        if (cur >= e.v) return null // "500 हज़ार 2 लाख": malformed order
        total += base * e.v
        cur = 0
        lastKind = 'scale'
      }
      any = true
      curDigits = false
      continue
    }
  }
  if (!any) return null
  if (pending !== null) {
    cur += pending // "saadhe teen" with no scale
    flags.push('bare_fraction')
  }
  return { value: total + cur, flags }
}

/** Find every amount span in a transcript. */
export function parseAmounts(text: string): AmountSpan[] {
  const words = tokenize(text)
  const toks: Tok[] = words.map((w) => ({ w, lex: lexOf(w) }))
  const isNumTok = (i: number): boolean => {
    const e = toks[i]?.lex
    if (!e) return false
    if (e.kind === 'currency' || e.kind === 'paise') return false
    if (e.kind === 'and') return isNumTok(i - 1) && isNumTok(i + 1)
    // "likh do" / "de do": the verb, unless a scale/number follows ("do sau", "do hazaar").
    if (DO.has(toks[i].w) && i > 0 && VERB_BEFORE_DO.has(toks[i - 1].w)) {
      const nx = toks[i + 1]?.lex
      return !!nx && (nx.kind === 'scale' || nx.kind === 'num' || nx.kind === 'currency')
    }
    return true
  }

  const spans: AmountSpan[] = []
  let i = 0
  while (i < toks.length) {
    if (!isNumTok(i)) {
      i++
      continue
    }
    // grow a maximal run, then split greedily where evaluation fails (e.g. "340 200").
    let j = i
    while (j < toks.length && isNumTok(j)) j++
    let s = i
    while (s < j) {
      let e = j
      let ev = evaluate(toks.slice(s, e))
      while (!ev && e > s + 1) {
        e--
        ev = evaluate(toks.slice(s, e))
      }
      if (!ev) {
        s++
        continue
      }
      spans.push(makeSpan(toks, s, e, ev))
      s = e
    }
    i = j
  }

  // Attach paise: "teen rupaye pachaas paise" -> 3.50
  for (let k = 0; k + 1 < spans.length; k++) {
    const a = spans[k]
    const b = spans[k + 1]
    const between = toks.slice(a.end, b.start).map((t) => t.lex?.kind)
    const after = toks[b.end]?.lex?.kind
    if (after === 'paise' && b.value < 100 && between.length <= 1 && between.every((x) => x === 'currency')) {
      a.value = Math.round((a.value + b.value / 100) * 100) / 100
      a.end = b.end + 1
      a.text = words.slice(a.start, a.end).join(' ')
      a.flags.push('fractional_rupee')
      spans.splice(k + 1, 1)
    }
  }
  return spans
}

function makeSpan(toks: Tok[], s: number, e: number, ev: { value: number; flags: AmountFlag[] }): AmountSpan {
  const run = toks.slice(s, e)
  const flags = [...ev.flags]
  const alternatives: number[] = []
  // Confusable alternatives: re-evaluate with each risky word swapped for its sound-alike.
  run.forEach((t, k) => {
    const partner = t.lex?.confusable
    if (partner === undefined) return
    const swapped = run.map((x, m) => (m === k ? { w: x.w, lex: { kind: 'num' as const, v: partner } } : x))
    const alt = evaluate(swapped)
    if (alt && alt.value !== ev.value && !alternatives.includes(alt.value)) alternatives.push(alt.value)
  })
  if (alternatives.length) flags.push('confusable')
  if (flags.includes('elided_scale')) {
    // "teen chaalis" could also be 3 and 40 said separately.
    const parts = run.map((t) => t.lex?.v ?? 0)
    if (parts.length === 2) alternatives.push(parts[0], parts[1])
  }
  if (flags.includes('bare_fraction')) alternatives.push(ev.value * 100, ev.value * 1000)
  if (flags.includes('approx_range')) {
    // lower bound: evaluate without the upper unit of the range
    const k = run.findIndex((t, m) => m > 0 && t.lex?.kind === 'num' && run[m - 1].lex?.kind === 'num'
      && t.lex.v === (run[m - 1].lex?.v ?? 0) + 1)
    const low = k > 0 ? evaluate(run.filter((_, m) => m !== k)) : null
    if (low) alternatives.unshift(low.value)
  }
  if (!Number.isInteger(ev.value) && !flags.includes('fractional_rupee') && !flags.includes('bare_fraction'))
    flags.push('fractional_rupee')
  const hasCurrency = [toks[s - 1], toks[e], toks[e + 1]].some((t) => t?.lex?.kind === 'currency')
  return { value: ev.value, start: s, end: e, text: run.map((t) => t.w).join(' '), hasCurrency,
    flags: [...new Set(flags)], alternatives: [...new Set(alternatives)].filter((a) => a !== ev.value) }
}

/** True if the (folded) token is a number word, scale, fraction or numeral. */
/** Rupee / paise words in any language ("ரூபா", "రూపాయల", "रुपये"): part of an amount, never a name. */
export function isCurrencyWord(t: string): boolean {
  const e = LEX.get(t)
  return !!e && (e.kind === 'currency' || e.kind === 'paise')
}

export function isNumberWord(t: string): boolean {
  if (/^\d/.test(t)) return true
  const e = LEX.get(t)
  return !!e && e.kind !== 'currency' && e.kind !== 'and'
}

/** Convenience: the distinct amount values found, in order. */
export function amountsIn(text: string): number[] {
  return parseAmounts(text).map((s) => s.value)
}

/** Format rupees in Indian grouping: 125000 -> "1,25,000". */
export function formatINR(v: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(v)
}
