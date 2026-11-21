/**
 * The dialogue, judged by what reaches the ledger: which entries are written (customer, rupees,
 * direction), which question is asked, and that nothing is written when it should not be.
 * Utterances are real ones from production logs where we have them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PendingView, ServerMsg } from '../shared/protocol.js'
import { say } from '../shared/replies.js'
import { addEntry, callsOf, cust, ent, harness } from './test-harness.js'

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

  it('an amount alone asks whose; chatter with numbers in it is not a name', async () => {
    const h = harness([cust('s', 'Suresh')], {
      lang: 'en',
      agent: (ctx) => ctx.heard[0].text === '300'
        ? callsOf({ name: 'add_entries', args: { entries: [{ name: null, amount: 300, direction: null }] } })
        : callsOf({ name: 'not_for_me', args: {} }),
    })
    await h.turn('One.')
    expect(h.asks).toBeNull()
    await h.turn('300')
    expect(h.asks).toBe('name')
    await h.turn('26, 23. 23, 26. Hey, 23 is a 26. Yeah.')
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

  it('talk to someone else while a question is open: the question waits quietly', async () => {
    const h = harness([cust('s', 'Suleiman')], { lang: 'en', agent: (ctx) => callsOf({ name: ctx.pending ? 'not_for_me' : 'add_entries', args: { entries: [{ name: 'Suleiman', amount: 400, direction: null }] } }) })
    await h.turn('Suleiman 400.')
    await h.turn('Should you take it upstairs for testing?')
    await h.turn('Your')
    expect(h.said).toEqual([])
    expect(h.asks).toBe('direction')
    await h.turn('udhaar')
    expect(h.written()).toEqual([['s', 400, 'credit']])
  })

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
    const h = harness([cust('r', 'Ramesh'), cust('s', 'Suresh')], { entries: [ent('e1', 's', 200, 'payment')] })
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

  it('tapping credit for a new name the agent supplied is not the yes: the account is still read back', async () => {
    const h = harness([cust('s', 'Suresh')], { lang: 'en' })
    await h.turn('Zaid 300.')
    expect(h.asks).toBe('direction')
    await h.answer('udhaar')
    expect(h.accounts()).toEqual([])
    expect(h.asks).toBe('confirm')
    await h.tap('yes')
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

  it.each([
    ['"Mahe Talk 300" (from "Mahi took 300")', [cust('m', 'Mahi')], 'Mahe Talk 300.', null, 'm'],
    ['a model reading "ಸುರೇಶ್ದು" (Suresh is)', [cust('s', 'Suresh')], 'Sureshdu 300 rupees sala aite.', addEntry('ಸುರೇಶ್ದು', 300, 'credit'), 's'],
    ['a model name containing a customer ("Suresh mele")', [cust('s', 'Suresh')], 'Suresh hesaru mele 300 sala', addEntry('Suresh mele', 300, 'credit'), 's'],
  ])('%s is the existing customer, never a new account', async (_label, people, text, reading, cid) => {
    const h = harness(people, { lang: 'en', agent: reading ? () => reading : undefined })
    await h.turn(text)
    if (h.asks === 'direction') await h.turn('udhaar')
    if (h.asks === 'confirm') await h.turn('yes')
    expect(h.accounts()).toEqual([])
    expect(h.written()).toEqual([[cid, 300, 'credit']])
  })

  it('with no Suresh yet, "Sureshdu" opens an account called Suresh (not "Sureshdu") after a yes', async () => {
    const h = harness([cust('m', 'Mahi')], { lang: 'en' })
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
      entries: [ent('e2', 's', 200, 'payment'), ent('e1', 'r', 340, 'credit')],
      agent: () => callsOf({ name: 'move_entry', args: { ref: 1, to_name: 'Pinky' } }),
    })
    await h.turn('Suresh wali entry galat hai, Pinky ka tha')
    expect(h.accounts()).toEqual([])
  })
})

describe('the model (LLM) never introduces money that was not said', () => {
  it('an amount the model invented is never written', async () => {
    const h = harness([cust('r', 'Ramesh')], { agent: () => addEntry('Ramesh', 999, 'credit') })
    await h.turn('Ramesh wale 340')
    expect(h.entries().filter((e) => e.paise === 99900)).toEqual([])
  })

  it('"same for Suresh" may copy a recent amount, but not one neither spoken nor recent', async () => {
    const recent = [ent('e1', 'r', 340, 'credit')]
    const copy = harness([cust('r', 'Ramesh'), cust('s', 'Suresh')], { entries: recent, agent: () => addEntry('Suresh', 340, 'credit') })
    await copy.turn('Suresh ka bhi same')
    expect(copy.asks).toBe('confirm') // credit was never said: read back first
    await copy.turn('haan')
    expect(copy.written()).toEqual([['s', 340, 'credit']])
    const invent = harness([cust('r', 'Ramesh'), cust('s', 'Suresh')], { entries: recent, agent: () => addEntry('Suresh', 777, 'credit') })
    await invent.turn('Suresh ka bhi same')
    expect(invent.entries()).toEqual([])
  })

  it('a model change to an older entry with an unspoken amount changes nothing', async () => {
    const h = harness([cust('r', 'Ramesh'), cust('s', 'Suresh')], {
      entries: [ent('e2', 's', 200, 'payment'), ent('e1', 'r', 340, 'credit')],
      agent: () => callsOf({ name: 'change_entry', args: { ref: 1, new_amount: 999 } }),
    })
    await h.turn('Suresh wali entry galat hai badlo')
    await h.turn('haan')
    expect(h.ops()).toEqual([])
  })

  it('one spoken amount returned twice by the model is written once', async () => {
    const one = { name: 'Ramesh', amount: 340, direction: 'credit', day_offset: 0, promise: false }
    const h = harness([cust('r', 'Ramesh')], { agent: () => callsOf({ name: 'add_entries', args: { entries: [one, one] } }) })
    await h.turn('Ramesh wale 340 ka scene')
    expect(h.asks).toBe('confirm') // the model guessed credit: read back first
    await h.turn('haan')
    expect(h.written()).toEqual([['r', 340, 'credit']])
  })

  it('a credit/paid the model guessed is read back before writing', async () => {
    const h = harness([cust('r', 'Ramesh')], { agent: () => addEntry('Ramesh', 340, 'credit') })
    await h.turn('Ramesh wale 340 ka scene')
    expect(h.ops()).toEqual([])
    expect(h.asks).toBe('confirm')
  })

  it('an unsure model reading of a relation name is read back before writing', async () => {
    const h = harness([], { agent: () => addEntry('Pinky ki mummy', 500, 'payment', false) })
    await h.turn('wo jo Pinky ki mummy hai na, unka paanch sau')
    expect(h.ops()).toEqual([])
    expect(h.asks).toBe('confirm')
    await h.turn('haan')
    expect(h.entries()).toEqual([expect.objectContaining({ paise: 50000, direction: 'payment' })])
  })

  it('chatter the model is sure about beats a stray number ("1 second")', async () => {
    const h = harness([cust('s', 'Suresh')], { lang: 'kn', agent: () => callsOf({ name: 'not_for_me', args: {} }) })
    await h.turn('It says, "1 second before you finish saying no."')
    expect(h.ops()).toEqual([])
    expect(h.asks).toBeNull()
  })

  it('when the model cannot read it, a bare guess from the fast parser is dropped', async () => {
    const h = harness([cust('s', 'Suresh')], { lang: 'en', agent: () => callsOf({ name: 'unclear', args: {} }) })
    await h.turn('Mahe teen sukha ka malli')
    expect(h.ops()).toEqual([])
    expect(h.asks).toBeNull()
  })
})

describe('audio for unclear moments', () => {
  const unclear = () => callsOf({ name: 'unclear', args: {} })

  it('unclear text is retried once with the audio and the audio reading is used (read back)', async () => {
    const h = harness([cust('s', 'Suresh')], { lang: 'en', agent: (_c, audio) => (audio ? addEntry('Suresh', 300, 'credit') : unclear()) })
    await h.turn('mumble mumble')
    expect(h.agentCalls.map((c) => !!c.audio)).toEqual([false, true])
    expect(h.ops()).toEqual([]) // nothing written until the shopkeeper says yes
    expect(h.asks).toBe('confirm')
    await h.turn('haan')
    expect(h.written()).toEqual([['s', 300, 'credit']])
  })

  it('audio retry over budget asks the shopkeeper', async () => {
    const h = harness([cust('s', 'Suresh')], {
      lang: 'en',
      agent: (_c, audio) => (audio ? addEntry('Suresh', 300, 'credit') : { ms: 2600, calls: unclear().calls }),
    })
    await h.turn('mumble mumble')
    expect(h.agentCalls.map((c) => !!c.audio)).toEqual([false])
    expect(h.ops()).toEqual([])
    expect(h.said.join(' ')).toContain(say('en').didNotCatch())
  })

  it('an audio call slower than the remaining budget is cut off and the shopkeeper is asked', async () => {
    vi.useFakeTimers()
    try {
      const h = harness([cust('s', 'Suresh')], {
        lang: 'en',
        agent: (_c, audio) => (audio ? new Promise(() => {}) : unclear()), // the audio call never answers
      })
      const p = h.turn('mumble mumble')
      await vi.advanceTimersByTimeAsync(2600)
      await p
      expect(h.agentCalls.map((c) => !!c.audio)).toEqual([false, true])
      expect(h.ops()).toEqual([])
      expect(h.said.join(' ')).toContain(say('en').didNotCatch())
    } finally { vi.useRealTimers() }
  })

  it('an audio call that throws asks the shopkeeper', async () => {
    const h = harness([cust('s', 'Suresh')], { lang: 'en', agent: (_c, audio) => { if (audio) throw new Error('boom'); return unclear() } })
    await h.turn('mumble mumble')
    expect(h.ops()).toEqual([])
    expect(h.said.join(' ')).toContain(say('en').didNotCatch())
  })

  it('an audio reading never answers an open question', async () => {
    const h = harness([cust('s', 'Suresh')], {
      lang: 'en',
      agent: (c, audio) => (c.pending ? (audio ? callsOf({ name: 'answer_question', args: { kind: 'direction', value: 'credit' } }) : unclear()) : addEntry('Suresh', 300, null)),
    })
    await h.turn('Suresh 300')
    expect(h.asks).toBe('direction')
    await h.turn('mumble mumble')
    expect(h.ops()).toEqual([])
    expect(h.asks).toBe('direction')
  })

  it('still unclear with the audio asks the shopkeeper', async () => {
    const h = harness([cust('s', 'Suresh')], { lang: 'en', agent: unclear })
    await h.turn('mumble mumble')
    expect(h.agentCalls.length).toBe(2)
    expect(h.said.join(' ')).toContain(say('en').didNotCatch())
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
    expect(h.asks).toBe('modify') // moving an entry is always asked first
    await h.turn('haan')
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

  describe('a spoken undo is instant only for an entry this session wrote in the last 60 s', () => {
    const wakeAndSay = async (h: ReturnType<typeof harness>, text: string) => {
      h.s.onClient({ type: 'wake', source: 'tap' })
      h.cb.onFinal!(text)
      await h.s.idle()
    }
    it('"ye dabba hata do" with an old last entry asks first, and voids only on a yes', async () => {
      const h = harness([cust('r', 'Ramesh', 340)], { entries: [ent('e1', 'r', 340, 'credit')] })
      await wakeAndSay(h, 'ye dabba hata do')
      expect(h.ops()).toEqual([])
      expect(h.asks).toBe('modify')
      expect(h.said.join(' ')).not.toBe('')
      await h.turn('haan')
      expect(h.ops()).toEqual([{ op: 'void', eid: 'e1', reason: 'spoken remove' }])
    })
    it('"ye dabba hata do" right after a save undoes it at once', async () => {
      const h = harness([cust('r', 'Ramesh')])
      await h.turn('Ramesh ka 340 udhaar')
      const eid = h.entries()[0].eid
      h.tick(20_000)
      await wakeAndSay(h, 'ye dabba hata do')
      expect(h.ops().at(-1)).toEqual({ op: 'void', eid, reason: 'spoken undo' })
      expect(h.asks).toBeNull()
    })
    it('the same entry 61 s later is asked about first', async () => {
      const h = harness([cust('r', 'Ramesh')])
      await h.turn('Ramesh ka 340 udhaar')
      h.tick(61_000)
      await h.turn('hata do')
      expect(h.ops().filter((o) => o.op === 'void')).toEqual([])
      expect(h.asks).toBe('modify')
    })
  })

  describe('older entries (the model picks one from the numbered recent list)', () => {
    const people = () => [cust('r', 'Ramesh', 340), cust('s', 'Suresh', -200), cust('g', 'Geeta', 150)]
    const recent = () => [ent('e3', 'g', 150, 'credit'), ent('e2', 's', 200, 'payment'), ent('e1', 'r', 340, 'credit', '2026-11-12')]
    const modify = (m: { ref: number; amount?: number; name?: string; remove?: boolean }) => () =>
      callsOf(m.remove ? { name: 'remove_entry', args: { ref: m.ref } }
        : m.name ? { name: 'move_entry', args: { ref: m.ref, to_name: m.name } }
        : { name: 'change_entry', args: { ref: m.ref, new_amount: m.amount } })

    it('removing Suresh\'s entry is read back first, then voids e2 only', async () => {
      const h = harness(people(), { entries: recent(), agent: modify({ ref: 2, remove: true }) })
      await h.turn('Suresh wali entry hata do')
      expect(h.ops()).toEqual([])
      expect(h.asks).toBe('modify')
      await h.turn('haan')
      expect(h.ops()).toEqual([{ op: 'void', eid: 'e2', reason: 'spoken remove' }])
    })

    it('yesterday\'s amount for Ramesh changes after a yes; "no" changes nothing', async () => {
      const yes = harness(people(), { entries: recent(), agent: modify({ ref: 3, amount: 430 }) })
      await yes.turn('Ramesh ka kal wala 340 nahi 430 tha')
      await yes.turn('haan')
      expect(yes.ops()).toEqual([{ op: 'amend', eid: 'e1', paise: 43000 }])
      const no = harness(people(), { entries: recent(), agent: modify({ ref: 3, amount: 430 }) })
      await no.turn('Ramesh ka kal wala 340 nahi 430 tha')
      await no.turn('nahi')
      expect(no.ops()).toEqual([])
    })

    it('moving an entry to another customer keeps both balances right', async () => {
      const h = harness(people(), { entries: recent(), agent: modify({ ref: 3, name: 'Suresh' }) })
      await h.turn('Ramesh ka kal wala 340 galat hai, Suresh ka tha')
      await h.turn('haan')
      expect(h.ops()).toEqual([{ op: 'amend', eid: 'e1', cid: 's' }])
      expect(Object.fromEntries(h.s.snap.customers.map((c) => [c.cid, c.balancePaise / 100]))).toEqual({ r: 0, s: 140, g: 150 })
    })

    it('a model pointing at an entry that does not exist changes nothing', async () => {
      const h = harness(people(), { entries: recent(), agent: modify({ ref: 9, amount: 430 }) })
      await h.turn('Ramesh ka kal wala 340 nahi 430 tha')
      await h.turn('haan')
      expect(h.ops()).toEqual([])
    })

    it('a change request the model cannot read never falls back to changing the last entry', async () => {
      const h = harness(people(), { entries: recent(), agent: () => callsOf({ name: 'unclear', args: {} }) })
      await h.turn('Suresh wali entry hata do')
      expect(h.ops()).toEqual([])
      expect(h.said).toHaveLength(1) // says it did not catch that
    })
  })
})

describe('only the typed word deletes everything', () => {
  it('"sab data mita do" asks; no keeps the data, yes (spoken or tapped) does not delete, the typed word does', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('sab data mita do')
    await h.turn('nahi')
    expect(h.ops()).toEqual([])
    await h.turn('sab data mita do')
    expect(h.ops()).toEqual([])
    await h.turn('haan') // a spoken yes never erases
    expect(h.ops()).toEqual([])
    await h.tap('yes') // nor does a tapped yes
    expect(h.ops()).toEqual([])
    await h.answer('मिटाओ') // only the typed word erases
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
    expect(h.heard).toMatch(/नेटवर्क.*Ramesh का 340/)
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
    expect(h.out.some((m) => m.type === 'ready')).toBe(false)
    await h.turn('Geeta ko yaad dilao')
    await h.turn('haan') // each send is confirmed
    expect(h.out.find((m) => m.type === 'ready')).toMatchObject({ kind: 'whatsapp', cid: 'g', text: expect.stringMatching(/300[\s\S]*Sharma Kirana|Sharma Kirana[\s\S]*300/) })
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

describe('understanding path: instant for a plain entry, the agent for everything else', () => {
  const people = () => [cust('r', 'Ramesh', 0), cust('s', 'Suresh', 0)]

  it('a plain known entry is written by the instant path without calling the agent', async () => {
    const h = harness(people(), { agent: () => { throw new Error('the agent must not be called') } })
    await h.turn('Ramesh ka 340 udhaar')
    expect(h.agentCalls).toHaveLength(0)
    expect(h.written()).toEqual([['r', 340, 'credit']])
  })

  it('anything else goes to the agent and its tools', async () => {
    const h = harness(people(), { agent: () => callsOf({ name: 'show_customer', args: { name: 'Ramesh' } }) })
    await h.turn('Ramesh ka hisaab dikhao')
    expect(h.agentCalls).toHaveLength(1)
    expect(h.agentCalls[0].ctx.heard[0].text).toBe('Ramesh ka hisaab dikhao')
    expect(h.out).toContainEqual({ type: 'show', view: 'customer', cid: 'r' })
    expect(h.said).toHaveLength(1)
  })

  it('the agent receives every language stream (audio only on the unclear retry)', async () => {
    const heard = [{ locale: 'hi-IN', text: 'रमेश का हिसाब' }, { locale: 'en-IN', text: 'Ramesh ka hisaab' }]
    const h = harness(people(), { agent: () => callsOf({ name: 'show_customer', args: { name: 'Ramesh' } }) })
    await h.turn('रमेश का हिसाब', false, heard)
    expect(h.agentCalls[0].ctx.heard).toEqual(heard)
    expect(h.agentCalls[0].audio).toBeUndefined()
  })

  it('not_for_me writes nothing, says nothing and marks not_entry', async () => {
    const h = harness(people(), { agent: () => callsOf({ name: 'not_for_me', args: {} }) })
    await h.turn('bhaiya chai pilao')
    expect(h.ops()).toEqual([])
    expect(h.said).toEqual([])
    expect(h.out).toContainEqual({ type: 'not_entry', text: 'bhaiya chai pilao' })
  })

  it('several tool calls in one turn run in order and are spoken together', async () => {
    const h = harness(people(), {
      agent: () => callsOf(
        { name: 'add_entries', args: { entries: [{ name: 'Ramesh', amount: 200, direction: 'credit' }] } },
        { name: 'query_balance', args: { name: 'Ramesh' } },
      ),
    })
    await h.turn('Ramesh ko 200 udhaar likho aur batao kitna hua')
    expect(h.written()).toEqual([['r', 200, 'credit']])
    expect(h.heard).toMatch(/200/)
  })

  it('agent failure: a plain entry still saves; anything else gets didNotCatch in the turn language', async () => {
    const h = harness(people(), { lang: 'kn', agent: () => { throw new Error('timeout') } })
    await h.turn('Ramesh ka 340 udhaar')
    expect(h.written()).toEqual([['r', 340, 'credit']])
    await h.turn('Suresh ka hisaab dikhao')
    expect(h.said).toEqual([say('kn').didNotCatch()])
    expect(h.written()).toHaveLength(1)
  })

  it('a pending answer the fast parse cannot read goes to the agent, which sees the question', async () => {
    const h = harness(people(), {
      agent: (ctx) => ctx.pending
        ? callsOf({ name: 'answer_question', args: { kind: 'direction', value: 'credit' } })
        : callsOf({ name: 'add_entries', args: { entries: [{ name: 'Ramesh', amount: 500, direction: null }] } }),
    })
    await h.turn('Ramesh paanch sau')
    expect(h.asks).toBe('direction')
    await h.turn('bhaiya woh udhaar hi samjho')
    expect(h.agentCalls.at(-1)!.ctx.pending).toMatchObject({ kind: 'direction' })
    expect(h.written()).toEqual([['r', 500, 'credit']])
  })

  it('streams that heard different amounts ask which', async () => {
    const h = harness(people())
    await h.turn('Ramesh ka 300 udhaar', false, [
      { locale: 'hi-IN', text: 'Ramesh ka 300 udhaar' },
      { locale: 'en-IN', text: 'Ramesh ka 500 udhaar' },
    ])
    expect(h.ops()).toEqual([])
    expect(lastCard(h.out)).toMatchObject({ kind: 'confusable', options: ['300', '500'] })
    await h.turn('500')
    expect(h.written()).toEqual([['r', 500, 'credit']])
  })
})

describe('attention: asleep and awake', () => {
  const states = (out: ServerMsg[]) => out.filter((m) => m.type === 'attention').map((m) => (m as { state: string }).state)
  const spoke = async (h: ReturnType<typeof harness>, text: string) => {
    h.cb.onFinal!(text)
    await new Promise((r) => setTimeout(r, 30))
    await h.s.idle()
    // the test room has no measured SNR, so a clear entry is read back first: say yes
    if (h.asks === 'confirm') await h.tap('yes')
  }

  it('hello is followed by the current state; a resumed open question starts awake', async () => {
    const h = harness([cust('r', 'Ramesh')])
    expect(states(h.out)).toEqual(['asleep'])
    await h.turn('Ramesh 300')
    expect(h.asks).not.toBeNull()
    const h2 = harness([cust('r', 'Ramesh')], { resume: h.lastResume() })
    expect(states(h2.out)).toEqual(['awake'])
  })

  it('asleep: customer talk with numbers writes nothing and says nothing', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await spoke(h, 'Ramesh ka 300 udhaar')
    await spoke(h, 'teen sau do sau pachaas')
    expect(h.ops()).toEqual([])
    expect(h.said).toEqual([])
    expect(h.out.some((m) => m.type === 'final')).toBe(false)
    expect(h.s.pending).toBeNull()
  })

  it('asleep: "KhataBhai, Ramesh 300 udhaar" wakes and writes', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await spoke(h, 'KhataBhai, Ramesh 300 udhaar')
    expect(h.written()).toEqual([['r', 300, 'credit']])
    expect(states(h.out)).toEqual(['asleep', 'awake'])
  })

  it('a bare wake word wakes and says hello', async () => {
    const h = harness()
    await spoke(h, 'खाता भाई')
    expect(states(h.out)).toEqual(['asleep', 'awake'])
    expect(h.said).toEqual(['हाँ, बोलिए।'])
  })

  it('awake: speech is handled without the wake word; a sleep word sleeps at once', async () => {
    const h = harness([cust('r', 'Ramesh')])
    h.s.onClient({ type: 'wake', source: 'tap' })
    await spoke(h, 'Ramesh ka 300 udhaar')
    expect(h.written()).toEqual([['r', 300, 'credit']])
    await spoke(h, 'bas')
    expect(states(h.out)).toEqual(['asleep', 'awake', 'asleep'])
    expect(h.written()).toHaveLength(1)
    await spoke(h, 'Ramesh ka 100 udhaar')
    expect(h.written()).toHaveLength(1)
  })

  it('our own reply containing KhataBhai does not wake it', async () => {
    const h = harness([cust('r', 'Ramesh')], { lang: 'en', speakMs: 80 })
    h.s.onClient({ type: 'hello', lang: 'en', snapshot: h.s.snap, firstRun: true, ptt: false })
    await new Promise((r) => setTimeout(r, 20)) // the disclosure ("I am KhataBhai...") is being spoken
    h.cb.onFinal!('I am KhataBhai, an AI assistant')
    h.cb.onFinal!('KhataBhai Ramesh 300 udhaar')
    await h.s.idle()
    expect(states(h.out).at(-1)).toBe('asleep')
    expect(h.written()).toEqual([])
  })

  it('"...bolo KhataBhai wale bhaiya ko" wakes, but nothing is written', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await spoke(h, 'ye sab ko bolo KhataBhai wale bhaiya ko')
    expect(states(h.out).at(-1)).toBe('awake')
    expect(h.ops()).toEqual([])
  })

  it('a phone wake with no wake word in the transcript goes back to sleep', async () => {
    const h = harness([cust('r', 'Ramesh')])
    h.s.onClient({ type: 'wake', source: 'phone' })
    expect(states(h.out).at(-1)).toBe('awake')
    await spoke(h, 'Ramesh ka 300 udhaar')
    expect(states(h.out)).toEqual(['asleep', 'awake', 'asleep'])
    expect(h.ops()).toEqual([])
    expect(h.said).toEqual([])
  })

  it('a phone wake confirmed by the wake word handles the rest', async () => {
    const h = harness([cust('r', 'Ramesh')])
    h.s.onClient({ type: 'wake', source: 'phone' })
    await spoke(h, 'KhataBhai Ramesh ka 300 udhaar')
    expect(h.written()).toEqual([['r', 300, 'credit']])
    expect(states(h.out).at(-1)).toBe('awake')
  })

  it('typed text is handled while asleep', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.typed('Ramesh ka 300 udhaar')
    expect(h.written()).toEqual([['r', 300, 'credit']])
  })

  it('a sleep message sleeps at once', async () => {
    const h = harness()
    h.s.onClient({ type: 'wake', source: 'tap' })
    h.s.onClient({ type: 'sleep' })
    expect(states(h.out)).toEqual(['asleep', 'awake', 'asleep'])
  })

  it('hold keeps it awake until hold_end', async () => {
    const h = harness([cust('r', 'Ramesh')])
    h.s.onClient({ type: 'wake', source: 'hold' })
    await spoke(h, 'Ramesh ka 300 udhaar')
    expect(h.written()).toEqual([['r', 300, 'credit']])
    h.s.onClient({ type: 'hold_end' })
    expect(states(h.out).at(-1)).toBe('awake') // the 15 s window starts now
  })
})

describe('attention: the window and the sleep word', () => {
  afterEach(() => vi.useRealTimers())
  const states = (out: ServerMsg[]) => out.filter((m) => m.type === 'attention').map((m) => (m as { state: string }).state)

  it('speech that starts at 12 s and ends at 17 s is still handled', async () => {
    vi.useFakeTimers()
    const h = harness([cust('r', 'Ramesh')])
    h.s.onClient({ type: 'wake', source: 'tap' })
    await vi.advanceTimersByTimeAsync(12_000)
    h.cb.onSpeechStart?.()
    await vi.advanceTimersByTimeAsync(2_000)
    h.cb.onPartial?.('Ramesh ka')
    await vi.advanceTimersByTimeAsync(3_000)
    h.cb.onFinal!('Ramesh ka 300 udhaar')
    await vi.advanceTimersByTimeAsync(50)
    expect(h.out.some((m) => m.type === 'final')).toBe(true)
    expect(states(h.out).at(-1)).toBe('awake')
  })

  it('continuous talk to customers does not keep it awake: asleep 15 s after the last real reply', async () => {
    vi.useFakeTimers()
    const h = harness([cust('r', 'Ramesh', 300)], {
      agent: (ctx) => callsOf(ctx.heard[0].text.includes('Ramesh') ? { name: 'show_customer', args: { name: 'Ramesh' } } : { name: 'not_for_me', args: {} }),
    })
    h.s.onClient({ type: 'wake', source: 'tap' })
    await vi.advanceTimersByTimeAsync(1_000)
    h.cb.onSpeechStart?.()
    h.cb.onFinal!('Ramesh ka hisaab batao')
    await vi.advanceTimersByTimeAsync(0)
    await h.s.idle()
    expect(h.said.length).toBe(1) // the real reply, at ~1 s
    // chatter every 2 s, each utterance 0.5 s long, all of it not for the app
    for (let t = 3_000; t <= 21_000; t += 2_000) {
      await vi.advanceTimersByTimeAsync(t === 3_000 ? 2_000 : 1_500)
      if (t === 17_000) expect(states(h.out).at(-1)).toBe('asleep') // 16 s: 15 s after the reply
      if (t === 15_000) expect(states(h.out).at(-1)).toBe('awake')
      h.cb.onSpeechStart?.()
      h.cb.onPartial?.('bhaiya do kilo')
      await vi.advanceTimersByTimeAsync(500)
      h.cb.onFinal!('bhaiya do kilo cheeni dena')
      await vi.advanceTimersByTimeAsync(0)
      await h.s.idle()
    }
    expect(states(h.out)).toEqual(['asleep', 'awake', 'asleep'])
  })

  it('an utterance in progress when the window runs out is still handled', async () => {
    vi.useFakeTimers()
    const h = harness([cust('r', 'Ramesh', 300)], { agent: () => callsOf({ name: 'show_customer', args: { name: 'Ramesh' } }) })
    h.s.onClient({ type: 'wake', source: 'tap' })
    await vi.advanceTimersByTimeAsync(14_000)
    h.cb.onSpeechStart?.()
    await vi.advanceTimersByTimeAsync(1_500)
    h.cb.onPartial?.('Ramesh ka')
    await vi.advanceTimersByTimeAsync(2_500)
    h.cb.onPartial?.('Ramesh ka hisaab')
    await vi.advanceTimersByTimeAsync(500)
    expect(states(h.out).at(-1)).toBe('awake')
    h.cb.onFinal!('Ramesh ka hisaab batao')
    await vi.advanceTimersByTimeAsync(50)
    expect(h.said.length).toBe(1)
    expect(states(h.out).at(-1)).toBe('awake') // it replied: a fresh window
    await vi.advanceTimersByTimeAsync(15_100)
    expect(states(h.out).at(-1)).toBe('asleep')
  })

  it('push-to-talk keeps it awake until ptt_end', async () => {
    vi.useFakeTimers()
    const h = harness()
    h.s.onClient({ type: 'ptt_start' })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(states(h.out).at(-1)).toBe('awake')
    h.s.onClient({ type: 'ptt_end' })
    await vi.advanceTimersByTimeAsync(15_000)
    expect(states(h.out).at(-1)).toBe('asleep')
  })

  it('"सुरेश 200," then "bas" handles Suresh 200 before sleeping', async () => {
    const h = harness([cust('s', 'Suresh')])
    h.s.onClient({ type: 'wake', source: 'tap' })
    h.cb.onFinal!('सुरेश 200,')
    h.cb.onFinal!('bas')
    await h.s.idle()
    expect(h.out.some((m) => m.type === 'final' && m.text === 'सुरेश 200,')).toBe(true)
    expect(h.asks ?? h.written().length).toBeTruthy()
    expect(states(h.out).at(-1)).toBe('asleep')
  })

  it('"KhataBhai bas" puts it to sleep', async () => {
    const h = harness()
    h.s.onClient({ type: 'wake', source: 'tap' })
    h.cb.onFinal!('KhataBhai bas')
    expect(states(h.out)).toEqual(['asleep', 'awake', 'asleep'])
  })

  it('a typed turn that leaves a question open wakes it, so the spoken answer is heard', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.typed('Ramesh 300')
    expect(h.asks).not.toBeNull()
    expect(states(h.out).at(-1)).toBe('awake')
  })
})

describe('fast answers need no model, and a dropped final leaves nothing behind', () => {
  it('a fresh complete plain entry replaces an open "whose?" question even when the agent is down', async () => {
    const h = harness([cust('r', 'Ramesh'), cust('s', 'Suresh')], {
      agent: (ctx) => {
        if (ctx.pending) throw new Error('timeout')
        return callsOf({ name: 'add_entries', args: { entries: [{ name: null, amount: 300, direction: null }] } })
      },
    })
    await h.turn('teen sau likh do bhai')
    expect(h.asks).toBe('name')
    await h.turn('Suresh ka 200 udhaar')
    expect(h.written()).toEqual([['s', 200, 'credit']])
    expect(h.asks).toBeNull()
  })

  it('streams heard while asleep and dropped do not reach the next turn', async () => {
    const h = harness([cust('r', 'Ramesh'), cust('s', 'Suresh')])
    h.cb.pick!([{ locale: 'hi-IN', text: 'Suresh ko 500 de do' }, { locale: 'en-IN', text: 'Suresh ko 300 de do' }])
    h.cb.onFinal!('Suresh ko 500 de do') // asleep, not addressed: dropped
    await h.s.idle()
    h.s.onClient({ type: 'wake', source: 'tap' })
    h.cb.onFinal!('Ramesh ka 300 udhaar') // a single stream: no pick call
    await h.s.idle()
    expect(h.asks).not.toBe('confusable') // no "300 or 500?"
    expect(lastCard(h.out)).toMatchObject({ paise: 30000 })
  })

  it('a dropped utterance does not become the ctx.heard of the next turn', async () => {
    const h = harness([cust('r', 'Ramesh')], { agent: () => callsOf({ name: 'show_customer', args: { name: 'Ramesh' } }) })
    h.cb.pick!([{ locale: 'hi-IN', text: 'chai do' }, { locale: 'en-IN', text: 'chai do' }])
    h.cb.onFinal!('chai do') // asleep: dropped
    await h.s.idle()
    h.s.onClient({ type: 'wake', source: 'tap' })
    h.cb.onFinal!('Ramesh ka hisaab dikhao')
    await h.s.idle()
    expect(h.agentCalls[0].ctx.heard).toEqual([{ locale: 'hi-IN', text: 'Ramesh ka hisaab dikhao' }])
  })
})

describe('the agent never writes the same entry twice in a minute', () => {
  const again = () => callsOf({ name: 'add_entries', args: { entries: [{ name: 'Mahi', amount: 300, direction: 'payment' }] } })
  const people = () => [cust('m', 'Mahi', 0)]

  it('an identical agent entry within 60 s is not written and says it is already written', async () => {
    const h = harness(people(), { lang: 'en', agent: again })
    await h.turn('woh Mahi wali baat 300 jama kar dena na')
    expect(h.written()).toEqual([['m', 300, 'payment']])
    h.tick(30_000)
    await h.turn('woh Mahi wali baat 300 jama kar dena na')
    expect(h.written()).toHaveLength(1)
    expect(h.said).toEqual([say('en').alreadyWritten('Mahi', 300)])
    expect(h.asks).toBeNull()
  })

  it('after 61 s it behaves as before', async () => {
    const h = harness(people(), { lang: 'en', agent: again })
    await h.turn('woh Mahi wali baat 300 jama kar dena na')
    h.tick(61_000)
    await h.turn('woh Mahi wali baat 300 jama kar dena na')
    expect(h.written().length + (h.asks ? 1 : 0)).toBeGreaterThan(1)
  })

  it('a plain instant-path repeat still writes', async () => {
    const h = harness(people(), { lang: 'en', agent: () => { throw new Error('no agent') } })
    await h.turn('Mahi paid 300')
    h.tick(10_000)
    await h.turn('Mahi paid 300')
    expect(h.written()).toHaveLength(2)
  })
})

describe('save anyway', () => {
  const text = 'bhaiya do kilo cheeni dena'
  it('force{text} after a not_for_me goes to the agent for the identical text, and is never silent', async () => {
    let calls = 0
    const h = harness([cust('r', 'Ramesh', 0)], { lang: 'en', agent: () => { calls++; return callsOf({ name: 'not_for_me', args: {} }) } })
    await h.turn(text)
    expect(calls).toBe(1)
    expect(h.out.some((m) => m.type === 'not_entry')).toBe(true)
    h.said.length = 0
    h.s.onClient({ type: 'force', text })
    await h.s.idle()
    expect(calls).toBe(2)
    expect(h.said.length).toBe(1) // the agent still said not for me: the app says so instead of staying silent
  })

  it('force{text} after the agent took a line for chatter writes the entry after the read-back', async () => {
    const line = 'wo Ramesh ke do sau likh dena kya'
    let calls = 0
    const h = harness([cust('r', 'Ramesh', 0)], {
      lang: 'en',
      agent: () => (++calls === 1 ? callsOf({ name: 'not_for_me', args: {} }) : addEntry('Ramesh', 200, 'credit')),
    })
    await h.turn(line)
    expect(h.ops()).toEqual([])
    h.s.onClient({ type: 'force', text: line })
    await h.s.idle()
    expect(calls).toBe(2)
    expect(h.asks).toBe('confirm') // addressed to the app: read back (no credit word was said), not dropped
    await h.tap('yes')
    expect(h.written()).toEqual([['r', 200, 'credit']])
  })

  it('a forced line while a question is open is a new instruction, not the answer', async () => {
    const h = harness([cust('r', 'Ramesh', 0), cust('s', 'Suresh', 0)], { lang: 'en' })
    await h.turn('Ramesh 340')
    expect(h.asks).toBe('direction')
    h.s.onClient({ type: 'force', text: 'Suresh 100 credit' })
    await h.s.idle()
    expect(h.written()).toEqual([['s', 100, 'credit']])
    expect(h.asks).toBeNull()
  })

  it('a forced line is still speech: a new name from the agent is read back before anything is written', async () => {
    const h = harness([cust('r', 'Ramesh', 0)], { lang: 'en', agent: () => addEntry('Talk', 300, 'payment') })
    h.s.onClient({ type: 'force', text: 'Talk 300 diye' })
    await h.s.idle()
    expect(h.ops()).toEqual([])
    expect(h.asks).toBe('confirm')
    expect(lastCard(h.out)).toMatchObject({ kind: 'confirm', newCustomer: true })
    await h.tap('yes')
    expect(h.accounts()).toEqual(['Talk'])
    expect(h.entries()).toHaveLength(1)
  })

  it('a forced correction to a name not in the ledger is read back first', async () => {
    const h = harness([cust('r', 'Ramesh', 0)], { lang: 'en', agent: () => callsOf({ name: 'move_entry', args: { ref: 1, to_name: 'Talk' } }) })
    await h.turn('Ramesh ka 340 udhaar')
    const n = h.ops().length
    h.s.onClient({ type: 'force', text: 'nahi, Talk' })
    await h.s.idle()
    expect(h.ops()).toHaveLength(n)
    expect(h.asks).toBe('modify')
  })

  it('a tool reply with a show and a ready card reaches the phone', async () => {
    const h = harness([cust('r', 'Ramesh', 0)], {
      lang: 'en',
      agent: () => callsOf({ name: 'show_today', args: {} }, { name: 'backup', args: {} }),
    })
    await h.turn('show me everything and back it up')
    expect(h.out).toContainEqual({ type: 'show', view: 'today' })
    expect(h.out).toContainEqual({ type: 'ready', kind: 'backup' })
  })
})

describe('erase needs the typed word', () => {
  const setup = () => {
    const h = harness([cust('r', 'Ramesh', 0)], { lang: 'en' })
    h.s.pending = { kind: 'delete', requireType: 'DELETE' }
    return h
  }
  it('a spoken haan and a yes tap do not erase', async () => {
    const h = setup()
    await h.turn('haan')
    await h.tap('yes')
    expect(h.ops()).toEqual([])
    expect(h.asks).toBe('delete')
  })
  it('answer(word) erases', async () => {
    const h = setup()
    await h.answer('delete')
    expect(h.ops()).toEqual([{ op: 'delete_all' }])
  })
  it('answer(wrong word) does not erase', async () => {
    const h = setup()
    await h.answer('DELETED')
    expect(h.ops()).toEqual([])
  })
})

describe('the fast-path "delete all" also needs the typed word', () => {
  it('a spoken delete-all then haan does not erase; the typed word does', async () => {
    const h = harness([cust('r', 'Ramesh', 0)], { lang: 'hi' })
    // the legacy fast-path reading (delete_all) opens the question without the agent
    ;(h.s as unknown as { dispatch(i: unknown, t: string, m: unknown): unknown }).dispatch({ type: 'delete_all' }, 'sab data mita do', { snrDb: null, noisy: false, path: 'fast' })
    expect(h.s.pending).toEqual({ kind: 'delete', requireType: 'मिटाओ' })
    await h.turn('haan')
    await h.tap('yes')
    expect(h.ops()).toEqual([])
    expect(h.asks).toBe('delete')
    await h.answer('मिटाओ')
    expect(h.ops()).toEqual([{ op: 'delete_all' }])
  })
})

describe('a model-supplied new name is read back even when the direction is tapped', () => {
  it('a tapped direction does not open an account for a name only the agent supplied', async () => {
    const h = harness([cust('s', 'Suresh')], {
      lang: 'en',
      agent: () => callsOf({ name: 'add_entries', args: { entries: [{ name: 'Barii', amount: 300, direction: null }] } }),
    })
    await h.turn('woh 300 barii wali baat likh do')
    expect(h.asks).toBe('direction')
    await h.answer('udhaar')
    expect(h.accounts()).toEqual([])
    expect(h.asks).toBe('confirm')
  })
})
