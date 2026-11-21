/**
 * The dialogue, judged by what reaches the ledger: which entries are written (customer, rupees,
 * direction), which question is asked, and that nothing is written when it should not be.
 * Utterances are real ones from production logs where we have them.
 */
import { describe, expect, it } from 'vitest'
import type { PendingView, ServerMsg } from '../shared/protocol.js'
import { MID_LIST_HOLD_MS } from './session.js'
import { cust, ent, harness, llmEntry } from './test-harness.js'

const lastCard = (out: ServerMsg[]) => (out.filter((m) => m.type === 'pending').at(-1) as { pending: PendingView | null }).pending

describe('clear entries are written at once, in every language', () => {
  it.each([
    ['hi', 'Ramesh ka 340 udhaar', ['r', 340, 'credit']],
    ['hi', 'सुरेश ने 100 रुपए दिए।', ['s', 100, 'payment']],
    ['hi', 'मोहन ने 500 रुपये वापस किए।', ['m', 500, 'payment']],
    ['kn', 'ರಮೇಶ್ ಅವರ 340 ರೂಪಾಯಿ ಸಾಲ ಬರೆಯಿರಿ.', ['r', 340, 'credit']],
    ['kn', 'ಸುರೇಶ್ 100 ರೂಪಾಯಿ ಕೊಟ್ಟರು.', ['s', 100, 'payment']],
    ['en', "add 500 to Suresh's account", ['s', 500, 'credit']],
    ['en', 'received 200 from Suresh', ['s', 200, 'payment']],
    ['hi', 'Ramesh ke naam se 300 udhaar', ['r', 300, 'credit']],
  ] as const)('[%s] %s', async (lang, text, want) => {
    const h = harness([cust('r', 'Ramesh'), cust('s', 'Suresh'), cust('m', 'Mohan')], { lang })
    await h.turn(text)
    expect(h.written()).toEqual([want])
    expect(h.accounts()).toEqual([])
    expect(h.asks).toBeNull()
  })

  it('a promise is written as a promise for its day, not as money paid', async () => {
    const h = harness([cust('a', 'Anil')])
    await h.turn('Anil kal sawa sau de jayega')
    expect(h.entries()).toEqual([expect.objectContaining({ cid: 'a', paise: 12500, promise: true, dayOffset: 1 })])
  })

  it('the same line said twice in one breath is one entry', async () => {
    const h = harness([cust('s', 'Suleiman')], { lang: 'en' })
    await h.turn('Suleiman 200 credit, Suleiman 200 credit.')
    expect(h.written()).toEqual([['s', 200, 'credit']])
  })

  it('talk to a customer writes nothing and says nothing', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('bhaiya do kilo cheeni dena')
    expect(h.ops()).toEqual([])
    expect(h.said).toEqual([])
    expect(h.out.some((m) => m.type === 'not_entry')).toBe(true) // the phone shows it was heard
  })
})

describe('missing parts are asked, and the answer completes the entry', () => {
  it('no credit/paid word: asks which way, a one-word answer saves', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('Ramesh 340')
    expect(h.ops()).toEqual([])
    expect(h.asks).toBe('direction')
    await h.turn('udhaar')
    expect(h.written()).toEqual([['r', 340, 'credit']])
  })

  it('"yes" does not answer credit-or-paid: asked again, then "paid" saves', async () => {
    const h = harness([cust('s', 'Suresh')], { lang: 'en' })
    await h.turn('Suresh, 500 rupees.')
    await h.turn('Correct, correct.')
    expect(h.ops()).toEqual([])
    expect(h.asks).toBe('direction')
    await h.turn('paid')
    expect(h.written()).toEqual([['s', 500, 'payment']])
  })

  it('a name alone asks how much; the answer may carry credit/paid too', async () => {
    const h = harness([cust('m', 'Mahi')], { lang: 'en' })
    await h.turn('Mahe')
    expect(h.asks).toBe('amount')
    await h.turn('300 credit')
    await h.turn('yes') // "Mahe" was only close to Mahi: read back once
    expect(h.written()).toEqual([['m', 300, 'credit']])
  })

  it('an amount alone asks whose; a bare number word in chatter does not', async () => {
    const h = harness([cust('s', 'Suresh')], { lang: 'en' })
    await h.turn('One.')
    expect(h.asks).toBeNull()
    await h.turn('300')
    expect(h.asks).toBe('name')
    await h.turn('26, 23. 23, 26. Hey, 23 is a 26. Yeah.') // numbers in the room are not a name
    expect(h.asks).toBe('name')
    expect(h.ops()).toEqual([])
  })

  it('"ಸುರೇಶ್ ಹೆಸರಿಂದ" ("in Suresh\'s name") answers "whose?" with Suresh, not a new account', async () => {
    const h = harness([cust('s', 'Suresh')], { lang: 'kn' })
    await h.turn('300 ರೂಪಾಯಿ ಸಾಲ.')
    await h.turn('ಸುರೇಶ್ ಹೆಸರಿಂದ.')
    expect(h.asks).toBe('confirm')
    await h.turn('ಹೌದು')
    expect(h.written()).toEqual([['s', 300, 'credit']])
    expect(h.accounts()).toEqual([])
  })

  it('two customers with the same first name: asks which, the answer picks one', async () => {
    const h = harness([cust('a', 'Ramesh'), cust('b', 'Ramesh Kumar')])
    await h.turn('Ramesh ka 500 udhaar')
    expect(h.asks).toBe('which')
    await h.turn('Ramesh Kumar')
    expect(h.written()).toEqual([['b', 500, 'credit']])
  })

  it('a lone name split from its amount by a pause is joined, not asked about', async () => {
    const h = harness([cust('s', 'Suresh')], { lang: 'kn' })
    h.cb.onFinal!('ಸುರೇಶ್')
    await new Promise((r) => setTimeout(r, 100))
    h.cb.onFinal!('300 ರೂಪಾಯಿ ಸಾಲ.')
    await h.s.idle()
    // no mic audio in this test, so the room counts as noisy and the joined line is read back
    expect(lastCard(h.out)).toMatchObject({ kind: 'confirm', name: 'Suresh', paise: 30000, direction: 'credit' })
    await h.turn('ಹೌದು')
    expect(h.written()).toEqual([['s', 300, 'credit']])
  })

  it('talk to someone else while a question is open: the question waits quietly', async () => {
    const h = harness([cust('s', 'Suleiman')], { lang: 'en' })
    await h.turn('Suleiman 400.')
    await h.turn('Should you take it upstairs for testing?')
    await h.turn('Your')
    expect(h.said).toEqual([])
    expect(h.asks).toBe('direction')
    await h.turn('udhaar')
    expect(h.written()).toEqual([['s', 400, 'credit']])
  })

  it('a question is asked again once, then waits on screen without nagging', async () => {
    const h = harness([cust('s', 'Suresh')], { lang: 'en' })
    await h.turn('Suresh 300.')
    await h.turn('This side, this side.')
    expect(h.said).toHaveLength(1)
    await h.turn('Over there, there.')
    expect(h.said).toEqual([])
    expect(h.asks).toBe('direction')
  })
})

describe('never a wrong amount silently', () => {
  it('a confusable spoken amount (saath: 60 or 7?) is asked, and the answer decides', async () => {
    const h = harness([cust('d', 'Deepak')])
    await h.turn('Deepak ne saath rupaye diye')
    expect(h.ops()).toEqual([])
    expect(lastCard(h.out)).toMatchObject({ kind: 'confusable', options: ['60', '7'] })
    await h.turn('7')
    expect(h.written()).toEqual([['d', 7, 'payment']])
  })

  it.each([
    ['Ramesh ka teen chaalis udhaar', 'hi', 340], // elided "hundred": 340 or 314?
    ['Ramesh ka do teen sau udhaar', 'hi', 300], // "two-three hundred": a range
    ['Ramesh paid fifteen hundred', 'en', 1500], // 15 hundred or 50 hundred?
  ] as const)('"%s" is asked about, not written', async (text, lang, first) => {
    const h = harness([cust('r', 'Ramesh')], { lang })
    await h.turn(text)
    expect(h.ops()).toEqual([])
    expect(h.asks).toBe('confusable')
    expect(lastCard(h.out)?.options?.[0]).toBe(String(first))
  })

  it('a noisy room reads back first: yes writes, no writes nothing', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('Ramesh ka 340 udhaar', true)
    expect(h.ops()).toEqual([])
    expect(h.asks).toBe('confirm')
    await h.turn('haan', true)
    expect(h.written()).toEqual([['r', 340, 'credit']])
    await h.turn('Ramesh ka 900 udhaar', true)
    await h.turn('nahi', true)
    expect(h.written()).toEqual([['r', 340, 'credit']])
  })

  it('a read-back answered with a different amount writes that amount only', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('Ramesh ka 340 udhaar', true)
    await h.turn('nahi, 430')
    expect(h.written()).toEqual([['r', 430, 'credit']])
  })

  it('"udhaar clear" with no amount reads back the balance as paid; only a yes writes it', async () => {
    const h = harness([cust('r', 'Ramesh', 450)])
    await h.turn('Ramesh ka udhaar clear')
    expect(h.ops()).toEqual([])
    expect(lastCard(h.out)).toMatchObject({ kind: 'confirm', paise: 45000, direction: 'payment' })
    await h.turn('haan')
    expect(h.written()).toEqual([['r', 450, 'payment']])
  })

  it('a slip in the same breath ("500 nahi 300") writes only 300 and amends nothing', async () => {
    const h = harness([cust('r', 'Ramesh'), cust('s', 'Suresh')], { recent: [ent('e1', 's', 200, 'payment')] })
    await h.turn('Ramesh ko 500 nahi 300 udhaar')
    expect(h.ops().filter((o) => o.op === 'amend')).toEqual([])
    expect(h.written()).toEqual([['r', 300, 'credit']])
  })

  it('zero is never written', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('Ramesh ko 0 udhaar')
    expect(h.entries()).toEqual([])
  })

  it('an unusually large amount is read back: 5x the customer\'s usual, or ₹10,000+ with no history', async () => {
    const h = harness([cust('r', 'Ramesh', 0, { typicalPaise: 20000 }), cust('s', 'Suresh')])
    await h.turn('Ramesh ka 3400 udhaar')
    expect(h.asks).toBe('confirm')
    await h.turn('nahi')
    await h.turn('Suresh ka 15000 udhaar')
    expect(h.asks).toBe('confirm')
    expect(h.entries()).toEqual([])
  })
})

describe('a heard name not in the ledger is never written without a yes', () => {
  it('a new name is read back with a "new customer" card; yes opens the account and writes', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('Pinky ka 200 udhaar')
    expect(h.ops()).toEqual([])
    expect(lastCard(h.out)).toMatchObject({ kind: 'confirm', newCustomer: true, name: 'Pinky', paise: 20000 })
    await h.turn('haan')
    expect(h.accounts()).toEqual(['Pinky'])
    expect(h.entries()).toEqual([expect.objectContaining({ cid: 'id1', paise: 20000, direction: 'credit' })])
  })

  it('"no" (spoken) or the Wrong button writes nothing and opens nothing', async () => {
    for (const reject of [(h: ReturnType<typeof harness>) => h.turn('nahi'), (h: ReturnType<typeof harness>) => h.tap('no')]) {
      const h = harness([cust('r', 'Ramesh')])
      await h.turn('Pinky ka 200 udhaar')
      await reject(h)
      expect(h.ops()).toEqual([])
      expect(h.asks).toBeNull()
    }
  })

  it('tapping credit on the card (which shows the name and amount) is the yes: written at once', async () => {
    const h = harness([cust('s', 'Suresh')], { lang: 'en' })
    await h.turn('Zaid 300.')
    expect(h.asks).toBe('direction')
    await h.answer('udhaar')
    expect(h.accounts()).toEqual(['Zaid'])
    expect(h.entries()).toEqual([expect.objectContaining({ paise: 30000, direction: 'credit' })])
    expect(h.asks).toBeNull()
  })

  it('a spoken credit/paid answer is not the yes: the new name is still read back', async () => {
    const h = harness([cust('s', 'Suresh')], { lang: 'kn' })
    await h.turn('300 ಬರೀ.') // "write 300": ಬರೀ is not a name
    await h.turn('ಸಾಲ')
    expect(lastCard(h.out)).toMatchObject({ kind: 'confirm', newCustomer: true })
    await h.turn('ಇಲ್ಲ')
    expect(h.ops()).toEqual([])
  })

  it('a typed new name is taken as written', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.typed('Pinky ka 200 udhaar')
    expect(h.accounts()).toEqual(['Pinky'])
    expect(h.written()).toEqual([['id1', 200, 'credit']])
  })

  it('a name said as a name ("ಮಾಹಿ ಹೆಸರಿಂದ") builds the entry across turns, then asks before opening', async () => {
    const h = harness([cust('s', 'Suresh')], { lang: 'kn' })
    await h.turn('ಮಾಹಿ ಹೆಸರಿಂದ.')
    expect(h.asks).toBe('amount')
    await h.turn('300 ಬರೀ.') // fills the amount, not the name
    expect(h.asks).toBe('direction')
    await h.turn('ಸಾಲ')
    expect(lastCard(h.out)).toMatchObject({ kind: 'confirm', newCustomer: true, name: 'ಮಾಹಿ' })
    expect(h.ops()).toEqual([])
    await h.turn('ಹೌದು')
    expect(h.accounts()).toEqual(['ಮಾಹಿ'])
    expect(h.written()).toEqual([['id1', 300, 'credit']])
  })

  it.each([
    ['"Mahe Talk 300" (from "Mahi took 300")', [cust('m', 'Mahi')], 'Mahe Talk 300.', null, 'm'],
    ['a model reading "ಸುರೇಶ್ದು" (Suresh\'s)', [cust('s', 'Suresh')], 'Sureshdu 300 rupees sala aite.', llmEntry('ಸುರೇಶ್ದು', 300, 'credit'), 's'],
    ['a model name containing a customer ("Suresh mele")', [cust('s', 'Suresh')], 'Suresh hesaru mele 300 sala', llmEntry('Suresh mele', 300, 'credit'), 's'],
  ])('%s is the existing customer, never a new account', async (_label, people, text, reading, cid) => {
    const h = harness(people, { lang: 'en', llm: reading ? () => reading : undefined })
    await h.turn(text)
    if (h.asks === 'direction') await h.turn('udhaar')
    if (h.asks === 'confirm') await h.turn('yes')
    expect(h.accounts()).toEqual([])
    expect(h.written()).toEqual([[cid, 300, 'credit']])
  })

  it('with no Suresh yet, "Sureshdu" opens an account called Suresh (not "Sureshdu") after a yes', async () => {
    const h = harness([cust('m', 'Mahi')], { lang: 'en', llm: () => llmEntry('ಸುರೇಶ್ದು', 300, 'credit') })
    await h.turn('Sureshdu 300 rupees sala aite.')
    expect(h.ops()).toEqual([])
    await h.turn('yes')
    expect(h.accounts()).toEqual(['Suresh'])
  })

  it('"300 rupees kottu" (Kannada "gave") does not open an account called Kottu', async () => {
    const h = harness([cust('s', 'Suresh')], { lang: 'en' })
    await h.turn('300 rupees kottu.')
    expect(h.asks).toBe('name')
    expect(h.ops()).toEqual([])
  })

  it('one breath about the same new name opens one account, not two', async () => {
    const h = harness([])
    await h.turn('Pinky ka 200 udhaar aur Pinky ka 100 udhaar')
    await h.turn('haan')
    await h.turn('haan')
    expect(h.accounts()).toEqual(['Pinky'])
    expect(h.written()).toEqual([['id1', 200, 'credit'], ['id1', 100, 'credit']])
  })

  // Before the 21 Nov name-guard change this opened "Pinky" without a yes; now the draft's own
  // transcript ("Ramesh ka 340 udhaar") makes Pinky resolve back to Ramesh, and the "no" is ignored.
  it('"nahi, Pinky" to "Ramesh 340, correct?" writes nothing for Ramesh and reads Pinky back as new', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('Ramesh ka 340 udhaar', true)
    await h.turn('nahi, Pinky')
    expect(h.entries().filter((e) => e.cid === 'r')).toEqual([])
    expect(h.accounts()).toEqual([])
  })

  it('"nahi, Pinky" after a save reads back before moving the entry to a new account', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('Ramesh ka 340 udhaar')
    await h.turn('nahi, Pinky')
    expect(h.accounts()).toEqual([])
  })

  it('a model change of the newest entry to an unknown name is read back before opening it', async () => {
    const h = harness([cust('r', 'Ramesh'), cust('s', 'Suresh')], {
      recent: [ent('e2', 's', 200, 'payment'), ent('e1', 'r', 340, 'credit')],
      llm: () => ({ intent: 'modify', sure: true, modify: { ref: 1, amount: null, direction: null, name: 'Pinky', remove: false } }),
    })
    await h.turn('Suresh wali entry galat hai, Pinky ka tha')
    expect(h.accounts()).toEqual([])
  })
})

describe('the model (LLM) never introduces money that was not said', () => {
  it('an amount the model invented is never written', async () => {
    const h = harness([cust('r', 'Ramesh')], { llm: () => llmEntry('Ramesh', 999, 'credit') })
    await h.turn('Ramesh wale 340')
    expect(h.entries().filter((e) => e.paise === 99900)).toEqual([])
  })

  it('"same for Suresh" may copy a recent amount, but not one neither spoken nor recent', async () => {
    const recent = [ent('e1', 'r', 340, 'credit')]
    const copy = harness([cust('r', 'Ramesh'), cust('s', 'Suresh')], { recent, llm: () => llmEntry('Suresh', 340, 'credit') })
    await copy.turn('Suresh ka bhi same')
    expect(copy.asks).toBe('confirm') // credit was never said: read back first
    await copy.turn('haan')
    expect(copy.written()).toEqual([['s', 340, 'credit']])
    const invent = harness([cust('r', 'Ramesh'), cust('s', 'Suresh')], { recent, llm: () => llmEntry('Suresh', 777, 'credit') })
    await invent.turn('Suresh ka bhi same')
    expect(invent.entries()).toEqual([])
  })

  it('a model change to an older entry with an unspoken amount changes nothing', async () => {
    const h = harness([cust('r', 'Ramesh'), cust('s', 'Suresh')], {
      recent: [ent('e2', 's', 200, 'payment'), ent('e1', 'r', 340, 'credit')],
      llm: () => ({ intent: 'modify', sure: true, modify: { ref: 1, amount: 999, direction: null, name: null, remove: false } }),
    })
    await h.turn('Suresh wali entry galat hai badlo')
    await h.turn('haan')
    expect(h.ops()).toEqual([])
  })

  it('one spoken amount returned twice by the model is written once', async () => {
    const twice = { intent: 'entries' as const, sure: true, entries: [0, 1].map(() => ({ name: 'Ramesh', amount: 340, direction: 'credit' as const, day_offset: 0, promise: false })) }
    const h = harness([cust('r', 'Ramesh')], { llm: () => twice })
    await h.turn('Ramesh wale 340 ka scene')
    expect(h.asks).toBe('confirm') // the model guessed credit: read back first
    await h.turn('haan')
    expect(h.written()).toEqual([['r', 340, 'credit']])
  })

  it('a credit/paid the model guessed is read back before writing', async () => {
    const h = harness([cust('r', 'Ramesh')], { llm: () => llmEntry('Ramesh', 340, 'credit') })
    await h.turn('Ramesh wale 340 ka scene')
    expect(h.ops()).toEqual([])
    expect(h.asks).toBe('confirm')
  })

  it('an unsure model reading of a relation name is read back before writing', async () => {
    const h = harness([], { llm: () => llmEntry('Pinky ki mummy', 500, 'payment', false) })
    await h.turn('wo jo Pinky ki mummy hai na, unka paanch sau')
    expect(h.ops()).toEqual([])
    expect(h.asks).toBe('confirm')
    await h.turn('haan')
    expect(h.entries()).toEqual([expect.objectContaining({ paise: 50000, direction: 'payment' })])
  })

  it('chatter the model is sure about beats a stray number ("1 second")', async () => {
    const h = harness([cust('s', 'Suresh')], { lang: 'kn', llm: () => ({ intent: 'chitchat', sure: true }) })
    await h.turn('It says, "1 second before you finish saying no."')
    expect(h.ops()).toEqual([])
    expect(h.asks).toBeNull()
  })

  it('when the model cannot read it, a bare guess from the fast parser is dropped', async () => {
    const h = harness([cust('s', 'Suresh')], { lang: 'en', llm: () => ({ intent: 'unclear', sure: false }) })
    await h.turn('Mahe teen sukha ka malli')
    expect(h.ops()).toEqual([])
    expect(h.asks).toBeNull()
  })
})

describe('lists', () => {
  const three = () => [cust('r', 'Ramesh'), cust('s', 'Suresh'), cust('g', 'Geeta')]

  it('one closing credit word for a list is asked once; yes writes every line', async () => {
    const h = harness(three())
    await h.turn('Ramesh 200, Suresh 300, Geeta 150 udhaar')
    expect(h.ops()).toEqual([])
    expect(lastCard(h.out)).toMatchObject({ kind: 'batch', direction: 'credit', options: ['Ramesh ₹200', 'Suresh ₹300', 'Geeta ₹150'] })
    await h.turn('haan')
    expect(h.written()).toEqual([['r', 200, 'credit'], ['s', 300, 'credit'], ['g', 150, 'credit']])
  })

  it('a one-word answer to the list question applies to every line', async () => {
    const h = harness(three())
    await h.turn('Ramesh 200, Suresh 300 udhaar')
    await h.turn('jama')
    expect(h.written()).toEqual([['r', 200, 'payment'], ['s', 300, 'payment']])
  })

  it('"no" to the list question asks about each line without its own word', async () => {
    const h = harness(three())
    await h.turn('Ramesh 200, Suresh 300 udhaar')
    await h.turn('nahi')
    expect(h.asks).toBe('direction')
    await h.turn('jama')
    expect(h.written()).toEqual([['r', 200, 'payment'], ['s', 300, 'credit']])
  })

  it('"sab udhaar" up front is explicit: the whole list is written without a question', async () => {
    const h = harness(three())
    await h.turn('sab udhaar, Ramesh 200, Suresh 300, Geeta 150')
    expect(h.written()).toEqual([['r', 200, 'credit'], ['s', 300, 'credit'], ['g', 150, 'credit']])
  })

  it('a credit word mid-list does not leak onto the next name', async () => {
    const h = harness([cust('a', 'Anil'), cust('r', 'Ravi')])
    await h.turn('Anil ka dedh sau udhaar aur Ravi 1200')
    expect(h.written()).toEqual([['a', 150, 'credit']])
    expect(h.asks).toBe('direction')
    await h.turn('jama')
    expect(h.written()).toEqual([['a', 150, 'credit'], ['r', 1200, 'payment']])
  })

  it('in a noisy room one yes to the list read-back writes every line', async () => {
    const h = harness(three())
    await h.turn('सुरेश 200, गीता 150 उधार', true)
    const shown = h.out.filter((m): m is Extract<ServerMsg, { type: 'say' }> => m.type === 'say').map((m) => m.text).join(' ')
    expect(shown).not.toMatch(/[<>]/) // spoken-only pause tags never reach the screen
    await h.turn('haan', true)
    expect(h.written()).toEqual([['s', 200, 'credit'], ['g', 150, 'credit']])
    expect(h.asks).toBeNull()
  })

  it('a list the recogniser split at a breath is handled as one list', async () => {
    const h = harness([cust('s', 'Suresh'), cust('g', 'Geeta'), cust('m', 'Mohan')])
    h.cb.onFinal!('सुरेश 200,')
    await new Promise((r) => setTimeout(r, 200))
    expect(h.asks).toBeNull() // Suresh is not asked about alone
    h.cb.onFinal!('गीता 150, मोहन 100 उधार')
    await h.s.idle()
    expect(lastCard(h.out)).toMatchObject({ kind: 'batch', options: ['सुरेश ₹200', 'गीता ₹150', 'मोहन ₹100'] })
  })

  it('a lone "रमेश 340" is not held forever: asked about after the short wait', async () => {
    const h = harness([cust('r', 'Ramesh')])
    h.cb.onFinal!('रमेश 340')
    await new Promise((r) => setTimeout(r, MID_LIST_HOLD_MS + 200))
    await h.s.idle()
    expect(h.asks).toBe('direction')
  })

  it('a typed list, one line each, is written like a spoken one', async () => {
    const h = harness([cust('r', 'Ramesh'), cust('s', 'Suresh')])
    await h.typed('Ramesh ka 200 udhaar\nSuresh ne 300 jama kiye')
    expect(h.written()).toEqual([['r', 200, 'credit'], ['s', 300, 'payment']])
  })
})

describe('corrections and undo target the right entry', () => {
  it('"nahi, 430" after a save amends that entry; "hata do" voids it', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('Ramesh ka 340 udhaar')
    const eid = h.entries()[0].eid
    await h.turn('nahi, 430')
    expect(h.ops().at(-1)).toEqual({ op: 'amend', eid, paise: 43000 })
    await h.turn('galat hai, hata do')
    expect(h.ops().at(-1)).toEqual({ op: 'void', eid, reason: 'spoken undo' })
  })

  it('"nahi, Suresh" moves the last entry to Suresh', async () => {
    const h = harness([cust('r', 'Ramesh'), cust('s', 'Suresh')])
    await h.turn('Ramesh ka 340 udhaar')
    const eid = h.entries()[0].eid
    await h.turn('nahi, Suresh')
    expect(h.ops().at(-1)).toEqual({ op: 'amend', eid, cid: 's' })
  })

  it('undo after a promise voids the promise, not the entry before it; a second undo reaches the one before', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('Ramesh ka 300 udhaar')
    await h.turn('Ramesh kal 300 de dega')
    const [credit, promise] = h.entries()
    await h.turn('cancel')
    expect(h.ops().at(-1)).toMatchObject({ op: 'void', eid: promise.eid })
    await h.turn('cancel')
    expect(h.ops().at(-1)).toMatchObject({ op: 'void', eid: credit.eid })
    expect(h.s.snap.customers[0].balancePaise).toBe(0)
  })

  it('"Suresh 200" in reply to "Ramesh 500, correct?" writes Suresh and leaves Ramesh unwritten', async () => {
    const h = harness([cust('r', 'Ramesh'), cust('s', 'Suresh')])
    await h.turn('Ramesh ka 500 udhaar', true)
    await h.turn('Suresh ka 200 udhaar')
    expect(h.written()).toEqual([['s', 200, 'credit']])
  })

  it('"usko 100 aur udhaar" adds to the customer just talked about', async () => {
    const h = harness([cust('r', 'Ramesh'), cust('s', 'Suresh')])
    await h.turn('Ramesh ka 340 udhaar')
    await h.turn('usko 100 aur udhaar')
    expect(h.written()).toEqual([['r', 340, 'credit'], ['r', 100, 'credit']])
  })

  describe('older entries (the model picks one from the numbered recent list)', () => {
    const people = () => [cust('r', 'Ramesh', 340), cust('s', 'Suresh', -200), cust('g', 'Geeta', 150)]
    const recent = () => [ent('e3', 'g', 150, 'credit'), ent('e2', 's', 200, 'payment'), ent('e1', 'r', 340, 'credit', '2026-11-12')]
    const modify = (m: { ref: number; amount?: number; name?: string; remove?: boolean }) => () =>
      ({ intent: 'modify' as const, sure: true, modify: { ref: m.ref, amount: m.amount ?? null, direction: null, name: m.name ?? null, remove: !!m.remove } })

    it('removing Suresh\'s entry is read back first, then voids e2 only', async () => {
      const h = harness(people(), { recent: recent(), llm: modify({ ref: 2, remove: true }) })
      await h.turn('Suresh wali entry hata do')
      expect(h.ops()).toEqual([])
      expect(h.asks).toBe('modify')
      await h.turn('haan')
      expect(h.ops()).toEqual([{ op: 'void', eid: 'e2', reason: 'spoken remove' }])
    })

    it('yesterday\'s amount for Ramesh changes after a yes; "no" changes nothing', async () => {
      const yes = harness(people(), { recent: recent(), llm: modify({ ref: 3, amount: 430 }) })
      await yes.turn('Ramesh ka kal wala 340 nahi 430 tha')
      await yes.turn('haan')
      expect(yes.ops()).toEqual([{ op: 'amend', eid: 'e1', paise: 43000 }])
      const no = harness(people(), { recent: recent(), llm: modify({ ref: 3, amount: 430 }) })
      await no.turn('Ramesh ka kal wala 340 nahi 430 tha')
      await no.turn('nahi')
      expect(no.ops()).toEqual([])
    })

    it('moving an entry to another customer keeps both balances right', async () => {
      const h = harness(people(), { recent: recent(), llm: modify({ ref: 3, name: 'Suresh' }) })
      await h.turn('Ramesh ka kal wala 340 galat hai, Suresh ka tha')
      await h.turn('haan')
      expect(h.ops()).toEqual([{ op: 'amend', eid: 'e1', cid: 's' }])
      expect(Object.fromEntries(h.s.snap.customers.map((c) => [c.cid, c.balancePaise / 100]))).toEqual({ r: 0, s: 140, g: 150 })
    })

    it('a model pointing at an entry that does not exist changes nothing', async () => {
      const h = harness(people(), { recent: recent(), llm: modify({ ref: 9, amount: 430 }) })
      await h.turn('Ramesh ka kal wala 340 nahi 430 tha')
      await h.turn('haan')
      expect(h.ops()).toEqual([])
    })

    it('a change request the model cannot read never falls back to changing the last entry', async () => {
      const h = harness(people(), { recent: recent(), llm: () => ({ intent: 'unclear', sure: false }) })
      await h.turn('Suresh wali entry hata do')
      expect(h.ops()).toEqual([])
      expect(h.said).toHaveLength(1) // says it did not catch that
    })
  })
})

describe('only a yes deletes everything', () => {
  it('"sab data mita do" asks; no keeps the data, yes deletes', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('sab data mita do')
    await h.turn('nahi')
    expect(h.ops()).toEqual([])
    await h.turn('sab data mita do')
    expect(h.ops()).toEqual([])
    await h.turn('haan')
    expect(h.ops()).toEqual([{ op: 'delete_all' }])
  })
})

describe('pending questions expire', () => {
  it('a "haan" more than 45 s after the read-back does not write it', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('Ramesh ka 340 udhaar', true)
    h.tick(46_000)
    await h.turn('haan')
    expect(h.ops()).toEqual([])
    expect(h.asks).toBeNull()
  })

  it('a "haan" within the window does', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('Ramesh ka 340 udhaar', true)
    h.tick(30_000)
    await h.turn('haan')
    expect(h.written()).toEqual([['r', 340, 'credit']])
  })

  it('a stale question in a resume blob is not restored', () => {
    const blob = Buffer.from(JSON.stringify({ v: 1, at: Date.now() - 60_000, lang: 'hi', pending: { kind: 'delete' }, pendingAgeMs: 0, focusCid: null, history: [] })).toString('base64url')
    const h = harness([cust('r', 'Ramesh')], { resume: blob })
    expect(h.asks).toBeNull()
  })
})

describe('a dropped connection never loses or doubles an entry', () => {
  it('an open read-back survives a reconnect: "haan" in the new session writes it once', async () => {
    const a = harness([cust('r', 'Ramesh')])
    await a.turn('रमेश का 340 रुपये उधार', true)
    const b = harness([cust('r', 'Ramesh')], { resume: a.lastResume() })
    expect(lastCard(b.out)).toMatchObject({ kind: 'confirm', paise: 34000 })
    await b.turn('हाँ', true)
    expect(b.written()).toEqual([['r', 340, 'credit']])
  })

  it('the "haan" lost in the drop is re-sent with the resumed question: written exactly once', async () => {
    const a = harness([cust('r', 'Ramesh')])
    await a.turn('रमेश का 340 रुपये उधार', true)
    const b = harness([cust('r', 'Ramesh')], { resume: a.lastResume(), resend: 'हाँ' })
    await b.s.idle()
    expect(a.entries()).toEqual([])
    expect(b.written()).toEqual([['r', 340, 'credit']])
  })

  it('a re-sent entry is written once and read back in full, with a network notice', async () => {
    const h = harness([cust('r', 'Ramesh')], { resend: 'Ramesh ka 340 udhaar' })
    await h.s.idle()
    expect(h.written()).toEqual([['r', 340, 'credit']])
    expect(h.heard).toMatch(/नेटवर्क.*Ramesh, 340/)
  })

  it('a garbled or foreign resume blob is ignored', async () => {
    for (const resume of ['not-base64-json', Buffer.from(JSON.stringify({ v: 2, pending: { kind: 'delete' } })).toString('base64url')]) {
      const h = harness([cust('r', 'Ramesh')], { resume })
      expect(h.asks).toBeNull()
      await h.turn('haan')
      expect(h.ops()).toEqual([])
    }
  })

  it('ledger ops carry a sequence number for the phone to acknowledge', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('Ramesh ka 340 udhaar')
    await h.turn('Ramesh ka 100 udhaar')
    expect(h.out.filter((m) => m.type === 'ops').map((m) => (m as { seq?: number }).seq)).toEqual([1, 2])
  })
})

describe('answers about the ledger', () => {
  it('a balance question names the right customer and the running total', async () => {
    const h = harness([cust('r', 'Ramesh', 1870), cust('s', 'Suresh', 900)])
    await h.turn('Ramesh ka total kitna hai')
    expect(h.heard).toMatch(/Ramesh.*1,870/)
    await h.turn('Ramesh ka 130 udhaar')
    await h.turn('uska total kitna hai')
    expect(h.heard).toMatch(/Ramesh.*2,000/)
  })

  it('reminders go only to opted-in adults, with the right customer, amount and shop', async () => {
    const h = harness([cust('r', 'Ramesh', 500), cust('g', 'Geeta', 300, { remindersOptIn: true, adult: true })])
    await h.turn('Ramesh ko yaad dilao')
    expect(h.out.some((m) => m.type === 'remind')).toBe(false)
    await h.turn('Geeta ko yaad dilao')
    expect(h.out.find((m) => m.type === 'remind')).toMatchObject({ cid: 'g', text: expect.stringMatching(/300[\s\S]*Sharma Kirana|Sharma Kirana[\s\S]*300/) })
  })

  it('the first run discloses that this is an AI', async () => {
    const h = harness()
    h.s.onClient({ type: 'hello', lang: 'kn', snapshot: h.s.snap, firstRun: true, ptt: false })
    await h.s.idle()
    expect(h.heard).toMatch(/\bAI\b/)
  })
})

describe('language', () => {
  it('English code-mixing in a Hindi session never switches the reply language', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.s.handleText('Ramesh 500 credit', { speechEnd: 0, commitAt: null, finalAt: 0, early: false, snrDb: 25, noisy: false, lang: 'en-IN' }, 'voice')
    expect(h.s.lang).toBe('hi')
  })
})

describe('turn taking', () => {
  function pcm(seconds: number, amp: number) {
    let s = 1
    const n = Math.round(seconds * 16000)
    const b = Buffer.alloc(n * 2)
    for (let i = 0; i < n; i++) {
      s = (s * 1664525 + 1013904223) >>> 0
      b.writeInt16LE(Math.round(((s / 2 ** 32) * 2 - 1) * 300 + amp * Math.sin((2 * Math.PI * 200 * i) / 16000)), i * 2)
    }
    return b
  }
  const feed = (h: ReturnType<typeof harness>, buf: Buffer) => {
    for (let o = 0; o < buf.length; o += 1024) {
      h.s.onAudio(buf.subarray(o, o + 1024))
      h.tick(32)
    }
  }

  it.each([
    ['Ramesh ka 340 udhaar', 1],
    ['Ramesh ka 340', 0], // unfinished: keep listening through the pause
  ])('after "%s" and a short pause, commits %i time(s)', (partial, commits) => {
    const h = harness([cust('r', 'Ramesh')])
    feed(h, pcm(1, 0))
    feed(h, pcm(1.5, 8000))
    h.cb.onPartial?.(partial)
    feed(h, pcm(0.4, 0))
    expect(h.commits).toBe(commits)
  })

  it('real words over the reply stop it; a cough or our own echo does not', async () => {
    const talk = async (interrupt: (h: ReturnType<typeof harness>) => void) => {
      const h = harness([cust('r', 'Ramesh', 500)], { speakMs: 50 })
      const p = h.turn('Ramesh ka total kitna hai')
      await new Promise((r) => setTimeout(r, 5))
      interrupt(h)
      await p
      return h.out.some((m) => m.type === 'stop_audio')
    }
    expect(await talk((h) => { h.cb.onSpeechStart?.(); h.cb.onPartial?.('nahi ruko') })).toBe(true)
    expect(await talk((h) => { h.cb.onSpeechStart?.(); h.cb.onSpeechEnd?.() })).toBe(false)
    expect(await talk((h) => h.cb.onPartial?.('Ramesh का कुल'))).toBe(false)
  })
})
