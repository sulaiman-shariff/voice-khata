import { describe, expect, it } from 'vitest'
import { amountsIn, formatINR, parseAmounts } from './numbers.js'

// [transcript, expected amounts in order]
const CASES: [string, number[]][] = [
  // --- Prisma `transcribe` output seen live (digits inside Devanagari / Kannada / English)
  ['रमेश का 340 रुपये उधार लिख दो।', [340]],
  ['सुरेश ने 60 रुपये जमा किए।', [60]],
  ['मोहन का 175 उधार।', [175]],
  ['Sunita took 1,500 rupees on credit.', [1500]],
  ['ಲಕ್ಷ್ಮೀ 2,500 ರೂಪಾಯಿ ಕೊಟ್ಟರು.', [2500]],
  ['रमेश का 340 रुपये उधार लिख दो और सुरेश ने कल 500 जमा किए थे।', [340, 500]],
  ['Ramesh ka 340 rupaye udhaar likh liya.', [340]],
  ['नरेश का 1,20,000 बाकी', [120000]],
  ['₹340 udhaar', [340]],
  ['Rs.250 diye', [250]],
  ['340/- likh do', [340]],
  ['सीमा ने ५०० दिए', [500]], // Devanagari digits
  ['ರಮೇಶ್ ೨೫೦ ಕೊಟ್ಟ', [250]], // Kannada digits
  ['ரமேஷ் ௩௪௦ கொடுத்தார்', [340]], // Tamil digits

  // --- Hindi words (codemix output / romanised speech)
  ['रमेश का तीन सौ चालीस रुपये उधार', [340]],
  ['Ramesh ne teen sau chaalis diye', [340]],
  ['Suresh ke khate mein dedh sau likh do', [150]],
  ['Geeta ne dhai hazaar jama kiye', [2500]],
  ['Mohan ka paune do sau baaki hai', [175]],
  ['पौने दो सौ', [175]],
  ['Anil ko sawa sau udhaar diya kal', [125]],
  ['Rajesh ne saadhe teen sau chuka diye parso', [350]],
  ['साढ़े तीन हज़ार', [3500]],
  ['Ravi ne baarah sau diye', [1200]],
  ['पच्चीस सौ', [2500]],
  ['Sunil ne sawa lakh diya', [125000]],
  ['Naresh ka do lakh pachaas hazaar baaki', [250000]],
  ['दो हज़ार पाँच सौ', [2500]],
  ['एक हज़ार आठ सौ सत्तर', [1870]],
  ['दो सौ साठ रुपये', [260]],
  ['ek lakh bees hazaar', [120000]],
  ['डेढ़ लाख', [150000]],
  ['सवा हज़ार', [1250]],
  ['पौने तीन सौ', [275]],

  // --- English / mixed
  ['Vimla ka ek thousand two hundred baaki', [1200]],
  ['Mehta ne two sau diye aaj', [200]],
  ['fifteen hundred', [1500]],
  ['two thousand five hundred', [2500]],
  ['one hundred and five', [105]],
  ['forty two', [42]],
  ['three forty', [340]],
  ['three hundred forty', [340]],

  // --- Dravidian
  ['ರಮೇಶ್ ಮುನ್ನೂರ ನಲವತ್ತು ರೂಪಾಯಿ ಕೊಟ್ಟ', [340]],
  ['ರಮೇಶ್ ಎರಡೂವರೆ ಸಾವಿರ ಕೊಟ್ಟರು ನಿನ್ನೆ', [2500]],
  ['ರಮೇಶ್ ನಾಳೆ ಇನ್ನೂರು ಕೊಡ್ತಾರೆ', [200]],
  ['ಲಕ್ಷ್ಮಿ ಎರಡು ಸಾವಿರದ ಐನೂರು ರೂಪಾಯಿ ಕೊಟ್ಟರು', [2500]],
  ['ರಮೇಶ್ ನೂರ ಐವತ್ತು', [150]],
  ['ரமேஷ் முந்நூற்று நாற்பது ரூபாய் கொடுத்தார்', [340]],
  ['ரமேஷுக்கு ஒன்றரை ஆயிரம் கடன் கொடுத்தேன்', [1500]],
  ['ஐநூறு ரூபாய்', [500]],
  ['రమేష్ మూడు వందల నలభై ఇచ్చాడు', [340]],
  ['రమేష్‌కి రెండున్నర వేలు అప్పు ఇచ్చాను', [2500]],
  ['నూట పాతిక', [125]],
  ['రెండొందలు', [200]],
  ['രമേശ് ഇരുനൂറ് തന്നു', [200]],
  ['മുന്നൂറ്റി നാൽപ്പത്', [340]],

  // --- other Indo-Aryan
  ['रमेशने तीनशे चाळीस दिले', [340]],
  ['रमेशला साडेतीनशे उधार दिले', [350]],
  ['রমেশ তিনশো চল্লিশ টাকা দিয়েছে', [340]],
  ['રમેશે અઢીસો રૂપિયા આપ્યા', [250]],
  ['ਰਮੇਸ਼ ਨੇ ਢਾਈ ਸੌ ਦਿੱਤੇ', [250]],

  // --- paise
  ['Pooja ne teen rupaye pachaas paise diye', [3.5]],

  // --- traps: no amount at all
  ['Ramesh ka hisaab likh do', []],
  ['likh do', []],
  ['de do bhai', []],
  ['Ramesh ka total kitna hai', []],
  ['no, galat hai', []],
]

describe('parseAmounts', () => {
  it.each(CASES)('%s', (text, expected) => {
    expect(amountsIn(text)).toEqual(expected)
  })
})

describe('flags', () => {
  const span = (t: string) => parseAmounts(t)[0]

  it('"do sau" after a verb is still 200', () => {
    expect(amountsIn('likh do sau rupaye')).toEqual([200])
  })
  it('confusable 60 offers 7', () => {
    const s = span('Deepak ne saath rupaye diye')
    expect(s.value).toBe(60)
    expect(s.flags).toContain('confusable')
    expect(s.alternatives).toContain(7)
  })
  it('confusable 17 offers 70', () => {
    const s = span('Meena ka satrah rupaye baaki')
    expect(s.alternatives).toContain(70)
  })
  it('fifteen hundred offers fifty hundred=5000', () => {
    const s = span('fifteen hundred')
    expect(s.value).toBe(1500)
    expect(s.alternatives).toContain(5000)
  })
  it('elided scale is flagged with the split reading', () => {
    const s = span('Hari ka teen chaalis baaki')
    expect(s.value).toBe(340)
    expect(s.flags).toContain('elided_scale')
  })
  it('bare fraction is flagged with alternatives', () => {
    const s = span('Dinesh ka saadhe teen baaki')
    expect(s.value).toBe(3.5)
    expect(s.flags).toContain('bare_fraction')
    expect(s.alternatives).toEqual(expect.arrayContaining([350, 3500]))
  })
  it('"do teen sau" is an approximate range 200-300', () => {
    const s = span('Ramesh ka do teen sau baaki')
    expect(s.flags).toContain('approx_range')
    expect(s.value).toBe(300)
    expect(s.alternatives).toContain(200)
  })
  it('digits from STT are not confusable', () => {
    expect(span('सुरेश ने 60 रुपये जमा किए').flags).toEqual([])
  })
  it('currency adjacency is detected', () => {
    expect(span('340 rupaye').hasCurrency).toBe(true)
    expect(span('Ramesh 340').hasCurrency).toBe(false)
  })
})

describe('formatINR', () => {
  it('uses Indian grouping', () => {
    expect(formatINR(125000)).toBe('1,25,000')
    expect(formatINR(3.5)).toBe('3.5')
  })
})

describe('Dravidian combining hundreds (600-900)', () => {
  it.each([
    ['ಏಳುನೂರ ಐವತ್ತು', 750], ['ಎಂಟುನೂರ ಐವತ್ತು', 850], ['ಆರುನೂರ ಇಪ್ಪತ್ತು', 620], ['ಒಂಬೈನೂರ ಹತ್ತು', 910],
    ['எழுநூற்று ஐம்பது', 750], ['எண்ணூற்று இருபது', 820], ['அறுநூற்று பத்து', 610],
  ])('%s -> %d', (t, want) => expect(parseAmounts(t)[0]?.value).toBe(want))
})

describe('Marathi / Bengali / Gujarati / Punjabi teens and hundreds (from the Timbre round trip)', () => {
  it.each([
    ['एक हजार आठशे सत्तर', 1870], ['रमेश सतरा रुपये', 17], ['এক হাজার আটশো সত্তর টাকা', 1870], ['সতেরো টাকা', 17],
    ['સત્તર રૂપિયા', 17], ['સિત્તેર રૂપિયા', 70], ['ਸਤਾਰਾਂ ਰੁਪਏ', 17], ['ஆயிரத்தி எண்ணூற்று எழுபது', 1870],
    ['सातशे पन्नास', 750], ['નવસો', 900], ['এক হাজার আটশ সত্তর', 1870], ['ਸਤਾਰ੍ਹਾਂ ਰੁਪਏ', 17],
    ['പതിനേഴ് രൂപ', 17], ['ഏഴു രൂപ', 7], ['മുന്നൂറ്റി നാല്പത് രൂപ', 340], ['ആയിരത്തി എണ്ണൂറ്റി എഴുപത്', 1870],
    ['முன்னூற்று நாற்பது', 340],
  ])('%s -> %d', (t, want) => expect(parseAmounts(t)[0]?.value).toBe(want))
  it('Gujarati 17 and 70 are flagged as confusable with each other', () => {
    expect(parseAmounts('સત્તર રૂપિયા')[0].alternatives).toEqual([70])
    expect(parseAmounts('સિત્તેર રૂપિયા')[0].alternatives).toEqual([17])
  })
  it('Hindi "तेरा" (your) is not a number', () => {
    expect(parseAmounts('तेरा हिसाब')).toEqual([])
  })
})
