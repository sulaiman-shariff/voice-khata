/**
 * Spoken amounts: one row per tricky form in each language, not every easy number.
 */
import { describe, expect, it } from 'vitest'
import { amountsIn, formatINR, parseAmounts } from './numbers.js'

describe('amounts heard in a sentence', () => {
  it.each<[string, number[]]>([
    // recogniser digits: Indian grouping, currency marks, native-script digits
    ['नरेश का 1,20,000 बाकी', [120000]],
    ['₹340 udhaar, Rs.250 diye, 340/- likh do', [340, 250, 340]],
    ['सीमा ने ५०० दिए', [500]],
    ['ರಮೇಶ್ ೨೫೦ ಕೊಟ್ಟ', [250]],
    ['रमेश का 340 रुपये उधार लिख दो और सुरेश ने कल 500 जमा किए थे।', [340, 500]],
    // Hindi fractions and compounds
    ['Suresh ke khate mein dedh sau likh do', [150]],
    ['Geeta ne dhai hazaar jama kiye', [2500]],
    ['Mohan ka paune do sau baaki hai', [175]],
    ['Anil ko sawa sau udhaar diya', [125]],
    ['साढ़े तीन हज़ार', [3500]],
    ['Sunil ne sawa lakh diya', [125000]],
    ['Ravi ne baarah sau diye', [1200]],
    ['पच्चीस सौ', [2500]],
    ['एक हज़ार आठ सौ सत्तर', [1870]],
    ['Naresh ka do lakh pachaas hazaar baaki', [250000]],
    ['Pooja ne teen rupaye pachaas paise diye', [3.5]],
    ['likh do sau rupaye', [200]], // "do" after a verb is still two
    // English and mixed
    ['Mehta ne two sau diye aaj', [200]],
    ['one hundred and five', [105]],
    ['three forty', [340]],
    // Dravidian compounds, including the combining 600-900 hundreds
    ['ರಮೇಶ್ ಮುನ್ನೂರ ನಲವತ್ತು ರೂಪಾಯಿ ಕೊಟ್ಟ', [340]],
    ['ರಮೇಶ್ ಎರಡೂವರೆ ಸಾವಿರ ಕೊಟ್ಟರು', [2500]],
    ['ಲಕ್ಷ್ಮಿ ಎರಡು ಸಾವಿರದ ಐನೂರು ರೂಪಾಯಿ ಕೊಟ್ಟರು', [2500]],
    ['ಒಂಬೈನೂರ ಹತ್ತು', [910]],
    ['ரமேஷுக்கு ஒன்றரை ஆயிரம் கடன் கொடுத்தேன்', [1500]],
    ['எழுநூற்று ஐம்பது', [750]],
    ['రమేష్‌కి రెండున్నర వేలు అప్పు ఇచ్చాను', [2500]],
    ['నూట పాతిక', [125]],
    ['ആയിരത്തി എണ്ണൂറ്റി എഴുപത്', [1870]],
    // other Indo-Aryan
    ['रमेशला साडेतीनशे उधार दिले', [350]],
    ['এক হাজার আটশো সত্তর টাকা', [1870]],
    ['રમેશે અઢીસો રૂપિયા આપ્યા', [250]],
    ['ਰਮੇਸ਼ ਨੇ ਢਾਈ ਸੌ ਦਿੱਤੇ', [250]],
    // no money at all
    ['Ramesh ka hisaab likh do', []],
    ['de do bhai', []],
    ['तेरा हिसाब', []], // "your", not thirteen
  ])('%s', (text, want) => expect(amountsIn(text)).toEqual(want))
})

describe('amounts that must be asked about', () => {
  // [text, value read, flag, an alternative that must be offered]
  it.each<[string, number, string, number]>([
    ['Deepak ne saath rupaye diye', 60, 'confusable', 7],
    ['Meena ka satrah rupaye baaki', 17, 'confusable', 70],
    ['સત્તર રૂપિયા', 17, 'confusable', 70],
    ['fifteen hundred', 1500, 'confusable', 5000],
    ['Hari ka teen chaalis baaki', 340, 'elided_scale', 314],
    ['Dinesh ka saadhe teen baaki', 3.5, 'bare_fraction', 350],
    ['Ramesh ka do teen sau baaki', 300, 'approx_range', 200],
  ])('%s -> %d, flagged %s, offers %d', (text, value, flag, alt) => {
    const [a] = parseAmounts(text)
    expect(a.value).toBe(value)
    expect(a.flags).toContain(flag)
    expect(a.alternatives).toContain(alt)
  })

  it('digits from the recogniser are taken as said (not confusable)', () => {
    expect(parseAmounts('सुरेश ने 60 रुपये जमा किए').map((a) => a.flags)).toEqual([[]])
  })
})

it('formatINR groups the Indian way', () => {
  expect(formatINR(125000)).toBe('1,25,000')
  expect(formatINR(3.5)).toBe('3.5')
})
