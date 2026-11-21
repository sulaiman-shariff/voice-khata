import { describe, expect, it } from 'vitest'
import { type EntryIntent, midList, parseFast } from './intent.js'
import { phoneticKey } from './names.js'

type Exp = { name: string; amount: number; dir: 'credit' | 'payment' | null; day?: number; promise?: boolean }

function entries(text: string): EntryIntent[] {
  const r = parseFast(text)
  if (r.type !== 'entries') throw new Error(`expected entries, got ${JSON.stringify(r)}`)
  return r.entries
}

// From the research test set (anchor: today) + live Prisma transcripts.
const CASES: [string, Exp[]][] = [
  ['Ramesh ne teen sau chaalis diye', [{ name: 'Ramesh', amount: 340, dir: 'payment' }]],
  ['Ramesh ko teen sau chaalis diye', [{ name: 'Ramesh', amount: 340, dir: 'credit' }]],
  ['रमेश का 340 रुपये उधार', [{ name: 'रमेश', amount: 340, dir: 'credit' }]],
  ['रमेश का 340 रुपये उधार लिख दो।', [{ name: 'रमेश', amount: 340, dir: 'credit' }]],
  ['Suresh ke khate mein dedh sau likh do', [{ name: 'Suresh', amount: 150, dir: 'credit' }]],
  ['Geeta ne dhai hazaar jama kiye', [{ name: 'Geeta', amount: 2500, dir: 'payment' }]],
  ['Mohan ka paune do sau baaki hai', [{ name: 'Mohan', amount: 175, dir: 'credit' }]],
  ['Anil ko sawa sau udhaar diya kal', [{ name: 'Anil', amount: 125, dir: 'credit', day: -1 }]],
  ['Anil kal sawa sau de jayega', [{ name: 'Anil', amount: 125, dir: 'payment', day: 1, promise: true }]],
  ['Rajesh ne saadhe teen sau chuka diye parso', [{ name: 'Rajesh', amount: 350, dir: 'payment', day: -2 }]],
  ['Vimla ka ek thousand two hundred baaki', [{ name: 'Vimla', amount: 1200, dir: 'credit' }]],
  ['Ravi ne baarah sau diye', [{ name: 'Ravi', amount: 1200, dir: 'payment' }]],
  ['सीमा ने ५०० दिए', [{ name: 'सीमा', amount: 500, dir: 'payment' }]],
  ['Lakhan ne udhaar liya do sau', [{ name: 'Lakhan', amount: 200, dir: 'credit' }]],
  ['Gopal le gaya dedh sau ka saaman', [{ name: 'Gopal', amount: 150, dir: 'credit' }]],
  ['Gopal de gaya dedh sau', [{ name: 'Gopal', amount: 150, dir: 'payment' }]],
  ['Ramesh paid 340 yesterday', [{ name: 'ramesh', amount: 340, dir: 'payment', day: -1 }]],
  ['Sunita took fifteen hundred on credit', [{ name: 'sunita', amount: 1500, dir: 'credit' }]],
  ['Sunita took 1,500 rupees on credit.', [{ name: 'sunita', amount: 1500, dir: 'credit' }]],
  ['Mehta ne two sau diye aaj', [{ name: 'Mehta', amount: 200, dir: 'payment', day: 0 }]],
  ['सुरेश ने 60 रुपये जमा किए।', [{ name: 'सुरेश', amount: 60, dir: 'payment' }]],
  // English word order: the shopkeeper is "I"; present tense reads like past
  ['I give 340 to Ramesh.', [{ name: 'ramesh', amount: 340, dir: 'credit' }]],
  ['I gave 340 to Ramesh', [{ name: 'ramesh', amount: 340, dir: 'credit' }]],
  ['I have given Ramesh 500', [{ name: 'ramesh', amount: 500, dir: 'credit' }]],
  ['We sold 250 to Geeta', [{ name: 'geeta', amount: 250, dir: 'credit' }]],
  ['Ramesh gave me 200', [{ name: 'ramesh', amount: 200, dir: 'payment' }]],
  ['Maine Ramesh ko 200 diye', [{ name: 'Ramesh', amount: 200, dir: 'credit' }]],
  // multi-clause
  ['Ramesh ka 340 udhaar, kal 200 diya tha', [
    { name: 'Ramesh', amount: 340, dir: 'credit', day: 0 },
    { name: 'Ramesh', amount: 200, dir: 'payment', day: -1 }]],
  ['Ramesh ka 340 udhaar kal 200 diya tha', [
    { name: 'Ramesh', amount: 340, dir: 'credit', day: 0 },
    { name: 'Ramesh', amount: 200, dir: 'payment', day: -1 }]],
  ['Anil ka dedh sau udhaar aur Ravi ne 1200 de diye', [
    { name: 'Anil', amount: 150, dir: 'credit' },
    { name: 'Ravi', amount: 1200, dir: 'payment' }]],
  ['रमेश का 340 रुपये उधार लिख दो और सुरेश ने कल 500 जमा किए थे।', [
    { name: 'रमेश', amount: 340, dir: 'credit', day: 0 },
    { name: 'सुरेश', amount: 500, dir: 'payment', day: -1 }]],
  // Kannada / Tamil / Telugu / Malayalam
  ['ರಮೇಶ್ ಮುನ್ನೂರ ನಲವತ್ತು ರೂಪಾಯಿ ಕೊಟ್ಟ', [{ name: 'ರಮೇಶ್', amount: 340, dir: 'payment' }]],
  ['ರಮೇಶ್ ಎರಡೂವರೆ ಸಾವಿರ ಕೊಟ್ಟರು ನಿನ್ನೆ', [{ name: 'ರಮೇಶ್', amount: 2500, dir: 'payment', day: -1 }]],
  ['ರಮೇಶ್ ನಾಳೆ ಇನ್ನೂರು ಕೊಡ್ತಾರೆ', [{ name: 'ರಮೇಶ್', amount: 200, dir: 'payment', day: 1, promise: true }]],
  ['ಲಕ್ಷ್ಮೀ 2,500 ರೂಪಾಯಿ ಕೊಟ್ಟರು.', [{ name: 'ಲಕ್ಷ್ಮೀ', amount: 2500, dir: 'payment' }]],
  ['ரமேஷ் முந்நூற்று நாற்பது ரூபாய் கொடுத்தார்', [{ name: 'ரமேஷ்', amount: 340, dir: 'payment' }]],
  ['ரமேஷுக்கு ஒன்றரை ஆயிரம் கடன் கொடுத்தேன் நேத்து', [{ name: 'ரமேஷ', amount: 1500, dir: 'credit', day: -1 }]],
  ['రమేష్ మూడు వందల నలభై ఇచ్చాడు', [{ name: 'రమేష్', amount: 340, dir: 'payment' }]],
  ['రమేష్‌కి రెండున్నర వేలు అప్పు ఇచ్చాను నిన్న', [{ name: 'రమేష్', amount: 2500, dir: 'credit', day: -1 }]],
  ['രമേശ് ഇരുനൂറ് തന്നു', [{ name: 'രമേശ്', amount: 200, dir: 'payment' }]],
  // other Indo-Aryan
  ['रमेशने तीनशे चाळीस दिले', [{ name: 'रमेश', amount: 340, dir: 'payment' }]],
  ['रमेशला साडेतीनशे उधार दिले', [{ name: 'रमेश', amount: 350, dir: 'credit' }]],
]

describe('parseFast entries', () => {
  it.each(CASES)('%s', (text, exp) => {
    const got = entries(text)
    expect(got.length).toBe(exp.length)
    exp.forEach((e, i) => {
      const g = got[i]
      expect(g.amount.value).toBe(e.amount)
      expect(g.direction).toBe(e.dir)
      // names compared by phonetic key so script/suffix variants pass
      expect(phoneticKey(g.name ?? '')).toBe(phoneticKey(e.name))
      if (e.day !== undefined) expect(g.dayOffset).toBe(e.day)
      expect(g.promise).toBe(e.promise ?? false)
    })
  })
})

describe('confidence', () => {
  it('clean entry is high', () => {
    expect(entries('Ramesh ka 340 udhaar')[0].confidence).toBe('high')
  })
  it('confusable word amount is low', () => {
    const e = entries('Deepak ne saath rupaye diye')[0]
    expect(e.confidence).toBe('low')
    expect(e.reasons).toContain('confusable')
  })
  it('no direction cue is low', () => {
    const e = entries('Ramesh 340')[0]
    expect(e.direction).toBeNull()
    expect(e.confidence).toBe('low')
  })
  it('noisy hallucination with no ledger cue is low (मोहन का पानी 200 धान ले)', () => {
    const e = entries('मोहन का पानी 200 धान ले')[0]
    expect(e.confidence).toBe('low')
  })
  it('approx range is low', () => {
    expect(entries('Ramesh ka do teen sau udhaar')[0].confidence).toBe('low')
  })
})

describe('commands', () => {
  it.each([
    ['haan', 'yes'], ['हाँ सही है', 'yes'], ['ಹೌದು', 'yes'], ['ok', 'yes'],
    ['nahi', 'no'], ['नहीं', 'no'], ['ಇಲ್ಲ', 'no'],
    ['galat hai, hata do', 'undo'], ['undo', 'undo'], ['pichla wala hata do', 'undo'],
    ['sab data mita do', 'delete_all'], ['mera data kahan hai', 'privacy'], ['tum kaun ho, AI ho?', 'privacy'],
  ])('%s -> %s', (t, type) => expect(parseFast(t).type).toBe(type))

  it('nahi, 430 corrects the amount', () => {
    const r = parseFast('nahi, 430')
    expect(r.type).toBe('correct')
    if (r.type === 'correct') expect(r.amount?.value).toBe(430)
  })
  it('340 nahi 430 corrects the amount', () => {
    const r = parseFast('340 nahi 430')
    expect(r.type === 'correct' && r.amount?.value).toBe(430)
  })
  it('nahi, jama tha corrects direction', () => {
    const r = parseFast('nahi, jama tha')
    expect(r.type === 'correct' && r.direction).toBe('payment')
  })
  it('nahi, Suresh corrects the name', () => {
    const r = parseFast('nahi, Suresh')
    expect(r.type === 'correct' && r.name).toBe('suresh')
  })
  it('Ramesh ka total kitna hai -> customer query', () => {
    const r = parseFast('Ramesh ka total kitna hai')
    expect(r).toEqual({ type: 'query', name: 'ramesh', scope: 'customer' })
  })
  it('aaj kitna udhaar gaya -> today credit', () => {
    expect(parseFast('aaj kitna udhaar gaya')).toEqual({ type: 'query', name: null, scope: 'today_credit' })
  })
  it('aaj ka hisaab -> today summary', () => {
    expect(parseFast('aaj ka hisaab batao')).toEqual({ type: 'summary', period: 'today' })
  })
  it('kisko yaad dilana hai -> dues', () => {
    expect(parseFast('kisko yaad dilana hai').type).toBe('remind')
  })
  it('Ramesh ko yaad dilao -> remind Ramesh', () => {
    expect(parseFast('Ramesh ko yaad dilao')).toEqual({ type: 'remind', name: 'ramesh' })
  })
  it('chit-chat is unknown', () => {
    expect(parseFast('aaj mausam accha hai').type).toBe('unknown')
  })
})

describe('midList', () => {
  it.each([
    ['सुरेश 200,', true],
    ['Suresh 200 aur', true],
    ['रमेश का 340 उधार', false],
    ['रमेश का टोटल क्या है', false],
    ['नहीं, 430', false],
    ['haan', false],
  ])('%s -> %s', (t, want) => expect(midList(t)).toBe(want))
})

describe('go-ahead replies count as yes', () => {
  it.each(['बदल दो।', 'हाँ, बदल दो', 'badal do', 'kar do', 'लिख दीजिए', 'change it'])('%s', (t) => expect(parseFast(t).type).toBe('yes'))
  it.each(['हटा दो', 'नहीं, मत बदलो', 'cancel kar do'])('%s is not a yes', (t) => expect(parseFast(t).type).not.toBe('yes'))
})
