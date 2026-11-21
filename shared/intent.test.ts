/**
 * The fast parser: who, how much, which way (credit = they owe more, payment = they paid), when.
 * One row per cue that decides the direction, per language; "ask" = no cue, so the agent must ask.
 */
import { describe, expect, it } from 'vitest'
import { midList, parseFast, turnComplete } from './intent.js'
import { phoneticKey } from './names.js'

type Want = { name: string; rs: number; dir: 'credit' | 'payment' | 'ask'; day?: number; promise?: boolean }
const W = (name: string, rs: number, dir: Want['dir'], extra: Partial<Want> = {}): Want => ({ name, rs, dir, ...extra })

function check(text: string, wants: Want[]) {
  const r = parseFast(text)
  expect(r.type, JSON.stringify(r)).toBe('entries')
  if (r.type !== 'entries') return
  expect(r.entries.map((e) => ({
    name: phoneticKey(e.name ?? ''), rs: e.amount.value, dir: e.direction ?? 'ask',
    ...(wants.some((w) => w.day !== undefined) ? { day: e.dayOffset } : {}), promise: e.promise,
  }))).toEqual(wants.map((w) => ({
    name: phoneticKey(w.name), rs: w.rs, dir: w.dir,
    ...(wants.some((x) => x.day !== undefined) ? { day: w.day ?? 0 } : {}), promise: w.promise ?? false,
  })))
}

describe('one entry: the words that decide credit or payment', () => {
  it.each<[string, Want]>([
    // Hindi / Hinglish: ne vs ko, le gaya vs de gaya, jama overriding ka
    ['Ramesh ne teen sau chaalis diye', W('Ramesh', 340, 'payment')],
    ['Ramesh ko teen sau chaalis diye', W('Ramesh', 340, 'credit')],
    ['Gopal le gaya dedh sau ka saaman', W('Gopal', 150, 'credit')],
    ['Gopal de gaya dedh sau', W('Gopal', 150, 'payment')],
    ['Suresh se 500 mile', W('Suresh', 500, 'payment')],
    ['Suresh ka 500 jama karo', W('Suresh', 500, 'payment')],
    ['Lakhan ne udhaar liya do sau', W('Lakhan', 200, 'credit')],
    ['सुरेश के खाते में 500 लिखो', W('सुरेश', 500, 'credit')],
    ['Anil ko sawa sau udhaar diya kal', W('Anil', 125, 'credit', { day: -1 })],
    ['Anil kal sawa sau de jayega', W('Anil', 125, 'payment', { day: 1, promise: true })],
    ['Rajesh ne saadhe teen sau chuka diye parso', W('Rajesh', 350, 'payment', { day: -2 })],
    // English: "gave" flips on who gave
    ['I gave Suresh 500', W('suresh', 500, 'credit')],
    ['Suresh gave me 500', W('suresh', 500, 'payment')],
    ['Suresh owes me 500', W('suresh', 500, 'credit')],
    ['Suresh took groceries worth 500', W('suresh', 500, 'credit')],
    ['received 500 from Suresh', W('suresh', 500, 'payment')],
    ['Suresh paid back 500', W('suresh', 500, 'payment')],
    ['Ramesh paid 340 yesterday', W('ramesh', 340, 'payment', { day: -1 })],
    ['Suresh will pay 500 tomorrow', W('suresh', 500, 'payment', { promise: true })],
    ['Ramesh Kumar 1200 credit', W('ramesh kumar', 1200, 'credit')],
    // no cue: must be asked, never guessed
    ['Suresh 500', W('suresh', 500, 'ask')],
    ['Suresh, 500 rupees.', W('suresh', 500, 'ask')],
    // Kannada / Tamil / Telugu / Malayalam / Marathi
    ['ರಮೇಶ್ ಮುನ್ನೂರ ನಲವತ್ತು ರೂಪಾಯಿ ಕೊಟ್ಟ', W('ರಮೇಶ್', 340, 'payment')],
    ['ರಮೇಶ್ ನಾಳೆ ಇನ್ನೂರು ಕೊಡ್ತಾರೆ', W('ರಮೇಶ್', 200, 'payment', { day: 1, promise: true })],
    ['ரமேஷுக்கு ஒன்றரை ஆயிரம் கடன் கொடுத்தேன் நேத்து', W('ரமேஷ', 1500, 'credit', { day: -1 })],
    ['ரமேஷ் முந்நூற்று நாற்பது ரூபாய் கொடுத்தார்', W('ரமேஷ்', 340, 'payment')],
    ['రమేష్‌కి రెండున్నర వేలు అప్పు ఇచ్చాను నిన్న', W('రమేష్', 2500, 'credit', { day: -1 })],
    ['రమేష్ మూడు వందల నలభై ఇచ్చాడు', W('రమేష్', 340, 'payment')],
    ['രമേശ് ഇരുനൂറ് തന്നു', W('രമേശ്', 200, 'payment')],
    ['रमेशला साडेतीनशे उधार दिले', W('रमेश', 350, 'credit')],
  ])('%s', (text, want) => check(text, [want]))
})

describe('several entries in one breath', () => {
  it.each<[string, Want[]]>([
    ['Ramesh ka 340 udhaar kal 200 diya tha', [W('Ramesh', 340, 'credit', { day: 0 }), W('Ramesh', 200, 'payment', { day: -1 })]],
    ['Anil ka dedh sau udhaar aur Ravi ne 1200 de diye', [W('Anil', 150, 'credit'), W('Ravi', 1200, 'payment')]],
    ['Suresh 500 credit and Ramesh paid 200', [W('suresh', 500, 'credit'), W('ramesh', 200, 'payment')]],
    ['रमेश का 340 रुपये उधार लिख दो और सुरेश ने कल 500 जमा किए थे।', [W('रमेश', 340, 'credit', { day: 0 }), W('सुरेश', 500, 'payment', { day: -1 })]],
  ])('%s', check)
})

describe('confidence: what makes an entry low (read back or asked)', () => {
  it.each([
    ['Ramesh ka 340 udhaar', 'high'],
    ['Deepak ne saath rupaye diye', 'low'], // confusable word amount
    ['Ramesh 340', 'low'], // no direction cue
    ['मोहन का पानी 200 धान ले', 'low'], // noisy hallucination, no ledger words
    ['Ramesh ka do teen sau udhaar', 'low'], // a range
  ])('%s -> %s', (text, want) => {
    const r = parseFast(text)
    expect(r.type === 'entries' && r.entries[0].confidence).toBe(want)
  })
})

describe('answers, commands and chatter', () => {
  it.each([
    ['haan', 'yes'], ['ಹೌದು', 'yes'], ['Correct, correct.', 'yes'], ['हाँ, बदल दो', 'yes'], ['change it', 'yes'],
    ['nahi', 'no'], ['ಇಲ್ಲ', 'no'], ['wrong', 'no'], ['not correct', 'no'],
    ['galat hai, hata do', 'undo'], ['cancel that', 'undo'], ['delete last entry', 'undo'],
    ['sab data mita do', 'delete_all'],
    ['tum kaun ho, AI ho?', 'privacy'],
    ['how much does Suresh owe', 'query'], ['aaj ka hisaab batao', 'summary'], ['kisko yaad dilana hai', 'remind'],
    ['do kilo cheeni dena', 'unknown'], ['give me two kilo sugar', 'unknown'], ['aaj mausam accha hai', 'unknown'],
  ])('%s -> %s', (text, type) => expect(parseFast(text).type).toBe(type))

  it.each(['हटा दो', 'नहीं, मत बदलो', 'cancel kar do'])('"%s" is never a yes', (text) => expect(parseFast(text).type).not.toBe('yes'))

  it.each<[string, { amount?: number; direction?: string; name?: string }]>([
    ['nahi, 430', { amount: 430 }],
    ['340 nahi 430', { amount: 430 }],
    ['nahi, jama tha', { direction: 'payment' }],
    ['nahi, Suresh', { name: 'suresh' }],
  ])('"%s" corrects the last entry', (text, want) => {
    const r = parseFast(text)
    expect(r.type).toBe('correct')
    if (r.type !== 'correct') return
    expect({ amount: r.amount?.value, direction: r.direction ?? undefined, name: r.name ?? undefined }).toEqual({ amount: undefined, direction: undefined, name: undefined, ...want })
  })

  it('a balance question names the customer', () => {
    expect(parseFast('Ramesh ka total kitna hai')).toEqual({ type: 'query', name: 'ramesh', scope: 'customer' })
  })
})

describe('end of turn: is the sentence finished?', () => {
  it.each([
    ['Ramesh ka 340 udhaar', true], ['ರಮೇಶ್ ಮುನ್ನೂರ ನಲವತ್ತು ರೂಪಾಯಿ ಕೊಟ್ಟರು', true], ['nahi, 430', true], ['haan', true],
    ['Ramesh ka 340', false], ['Ramesh ka do', false], ['Ramesh ne kal', false], ['रमेश का 340 रुपये उधार लिख', false], ['Ramesh ka 340 udhaar aur', false],
  ])('%s -> %s', (text, want) => expect(turnComplete(text)).toBe(want))

  it.each([
    ['सुरेश 200,', true], ['Suresh 200 aur', true], ['रमेश का 340 उधार', false], ['नहीं, 430', false],
  ])('mid-list "%s" -> %s', (text, want) => expect(midList(text)).toBe(want))
})
