/**
 * Edge cases from how shopkeepers actually talk (English, Hinglish, Hindi), checked against the
 * fast parser. "ask" = the parser must NOT guess the direction (the agent will ask).
 */
import { describe, expect, it } from 'vitest'
import { parseFast } from './intent.js'

type Want = [name: string | null, rupees: number, dir: 'credit' | 'payment' | 'ask', promise?: boolean]
const E: [string, Want | Want[]][] = [
  // ---------- English: credit
  ['Suresh 500 credit', ['suresh', 500, 'credit']],
  ['Suresh took 500', ['suresh', 500, 'credit']],
  ['Suresh took groceries worth 500', ['suresh', 500, 'credit']],
  ['add 500 to Suresh', ['suresh', 500, 'credit']],
  ["add 500 to Suresh's account", ['suresh', 500, 'credit']],
  ['put 500 on Suresh account', ['suresh', 500, 'credit']],
  ["put 500 on Suresh's tab", ['suresh', 500, 'credit']],
  ['write 500 for Suresh', ['suresh', 500, 'credit']],
  ['500 rupees credit for Suresh', ['suresh', 500, 'credit']],
  ['note 500 credit against Suresh', ['suresh', 500, 'credit']],
  ['Suresh owes me 500', ['suresh', 500, 'credit']],
  ['Suresh owes 500', ['suresh', 500, 'credit']],
  ['Suresh has to pay 500', ['suresh', 500, 'credit']],
  ['Suresh needs to pay 500', ['suresh', 500, 'credit']],
  ['Suresh borrowed 500', ['suresh', 500, 'credit']],
  ['Suresh bought for 500', ['suresh', 500, 'credit']],
  ['Suresh bought things for 500 on credit', ['suresh', 500, 'credit']],
  ['Suresh purchased 500', ['suresh', 500, 'credit']],
  ['I gave Suresh 500', ['suresh', 500, 'credit']],
  ['I gave Suresh goods worth 500', ['suresh', 500, 'credit']],
  ['give Suresh 500 credit', ['suresh', 500, 'credit']],
  ['Ramesh Kumar 1200 credit', ['ramesh kumar', 1200, 'credit']],
  ['Suresh five hundred credit', ['suresh', 500, 'credit']],
  ['Suresh one thousand two hundred credit', ['suresh', 1200, 'credit']],
  ['credit 500 Suresh', ['suresh', 500, 'credit']],
  ['Rs 500 credit to Suresh', ['suresh', 500, 'credit']],
  ['₹500 credit Suresh', ['suresh', 500, 'credit']],
  // ---------- English: payment
  ['Suresh paid 500', ['suresh', 500, 'payment']],
  ['Suresh paid back 500', ['suresh', 500, 'payment']],
  ['Suresh gave 500', ['suresh', 500, 'payment']],
  ['Suresh gave me 500', ['suresh', 500, 'payment']],
  ['Suresh returned 500', ['suresh', 500, 'payment']],
  ['Suresh cleared 500', ['suresh', 500, 'payment']],
  ['Suresh deposited 500', ['suresh', 500, 'payment']],
  ['Suresh settled 500', ['suresh', 500, 'payment']],
  ['received 500 from Suresh', ['suresh', 500, 'payment']],
  ['got 500 from Suresh', ['suresh', 500, 'payment']],
  ['I got 500 from Suresh', ['suresh', 500, 'payment']],
  ['collected 500 from Suresh', ['suresh', 500, 'payment']],
  ['500 paid by Suresh', ['suresh', 500, 'payment']],
  ['Suresh made a payment of 500', ['suresh', 500, 'payment']],
  ['Suresh paid 500 in cash', ['suresh', 500, 'payment']],
  // ---------- English: promises
  ['Suresh will pay 500 tomorrow', ['suresh', 500, 'payment', true]],
  ['Suresh will give 500 tomorrow', ['suresh', 500, 'payment', true]],
  // ---------- English: no direction cue -> ask
  ['Suresh 500', ['suresh', 500, 'ask']],
  ['Suresh, 500 rupees.', ['suresh', 500, 'ask']],
  // ---------- English: two entries
  ['Suresh 500 credit and Ramesh paid 200', [['suresh', 500, 'credit'], ['ramesh', 200, 'payment']]],
  // ---------- Hinglish / Hindi
  ['Suresh ka 500 udhaar', ['suresh', 500, 'credit']],
  ['Suresh ko 500 ka saaman diya', ['suresh', 500, 'credit']],
  ['Suresh ne 500 diye', ['suresh', 500, 'payment']],
  ['Suresh se 500 mile', ['suresh', 500, 'payment']],
  ['Suresh se 500 aaye', ['suresh', 500, 'payment']],
  ['Suresh 500 ka maal le gaya', ['suresh', 500, 'credit']],
  ['Suresh 500 de gaya', ['suresh', 500, 'payment']],
  ['Suresh ke khate mein 500 likh do', ['suresh', 500, 'credit']],
  ['Suresh ka 500 jama karo', ['suresh', 500, 'payment']],
  ['सुरेश से 500 मिले', ['सुरेश', 500, 'payment']],
  ['सुरेश के खाते में 500 लिखो', ['सुरेश', 500, 'credit']],
  ['सुरेश 500 का सामान ले गया', ['सुरेश', 500, 'credit']],
  ['Suresh credit 500 likho', ['suresh', 500, 'credit']],
  ['Suresh ne 500 payment kiya', ['suresh', 500, 'payment']],
]

const NON_ENTRY: [string, string][] = [
  ['yes', 'yes'], ['correct', 'yes'], ['Correct, correct.', 'yes'], ['yeah', 'yes'], ['yep', 'yes'], ['that is right', 'yes'],
  ['yes correct', 'yes'], ['ok done', 'yes'], ['haan ji', 'yes'], ['haan sahi hai', 'yes'], ['sure', 'yes'],
  ['no', 'no'], ['no no', 'no'], ['nope', 'no'], ['wrong', 'no'], ['nahi', 'no'], ['galat hai', 'no'], ['not correct', 'no'],
  ['undo', 'undo'], ['cancel that', 'undo'], ['delete last entry', 'undo'], ['remove that', 'undo'],
  ['how much does Suresh owe', 'query'], ['what is Suresh balance', 'query'], ["what's Suresh's total", 'query'],
  ['Suresh ka total kitna hai', 'query'], ['who all owe money', 'query'],
  ['today total', 'summary'], ["today's summary", 'summary'], ['aaj ka hisaab', 'summary'], ['this month total', 'summary'],
  ['give me two kilo sugar', 'unknown'], ['do kilo cheeni dena', 'unknown'], ['hello', 'unknown'], ['thank you', 'unknown'],
]

describe('English and Hinglish entries', () => {
  for (const [text, want] of E) {
    it(text, () => {
      const r = parseFast(text)
      expect(r.type, JSON.stringify(r)).toBe('entries')
      if (r.type !== 'entries') return
      const wants = (Array.isArray(want[0]) ? want : [want]) as Want[]
      expect(r.entries.length, JSON.stringify(r.entries)).toBe(wants.length)
      wants.forEach(([name, rs, dir, promise], i) => {
        const e = r.entries[i]
        expect(e.name?.toLowerCase(), JSON.stringify(e)).toBe(name)
        expect(e.amount.value).toBe(rs)
        expect(e.direction ?? 'ask').toBe(dir)
        if (promise !== undefined) expect(e.promise).toBe(promise)
      })
    })
  }
})

describe('answers, commands and chatter', () => {
  for (const [text, type] of NON_ENTRY) it(`${text} -> ${type}`, () => expect(parseFast(text).type).toBe(type))
})
