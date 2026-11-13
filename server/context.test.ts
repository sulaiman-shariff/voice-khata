/**
 * Conversation context, lists of entries, and changing older entries.
 * Same fake STT/TTS/LLM style as session.test.ts; the LLM fake records the context it was given.
 */
import { describe, expect, it } from 'vitest'
import type { LedgerOp, ServerMsg, SnapCustomer, SnapEntry, Snapshot } from '../shared/protocol.js'
import { type LlmContext, type LlmReading, validate } from './parse/llm.js'
import { Session } from './session.js'

const cust = (cid: string, name: string, balanceRs = 0): SnapCustomer => ({
  cid, name, aliases: [], householdId: null, remindersOptIn: false, adult: false, balancePaise: balanceRs * 100, typicalPaise: null,
})
const ent = (eid: string, cid: string, rs: number, direction: 'credit' | 'payment', day = '2026-11-13'): SnapEntry =>
  ({ eid, cid, paise: rs * 100, direction, day })

function harness(customers: SnapCustomer[], recent: SnapEntry[] = [], llm?: (t: string, c: LlmContext) => Partial<LlmReading>) {
  const out: ServerMsg[] = []
  const said: string[] = []
  const contexts: LlmContext[] = []
  let ids = 0
  const s = new Session({
    openStt: () => ({ send: () => {}, commit: () => {}, setKeyterms: () => {}, close: () => {} }),
    speak: async (text, _l, onAudio) => {
      said.push(text)
      onAudio(Buffer.alloc(3200))
      return { firstAudioMs: 1, bytes: 3200 }
    },
    llm: async (t, c) => {
      contexts.push(c)
      if (!llm) throw new Error('no llm')
      return llm(t, c)
    },
    send: (m) => out.push(m),
    sendAudio: () => {},
    now: () => 0,
    newId: () => `id${++ids}`,
  })
  const snapshot: Snapshot = {
    shopName: 'Shop', customers, last: recent[0] ?? null, recent,
    today: { creditPaise: 0, paymentPaise: 0, entries: 0 }, month: { creditPaise: 0, paymentPaise: 0, entries: 0 },
  }
  s.onClient({ type: 'hello', lang: 'hi', snapshot, firstRun: false, ptt: false })
  const turn = async (text: string) => {
    said.length = 0
    await s.handleText(text, { speechEnd: 0, commitAt: null, finalAt: 0, early: false, snrDb: 25, noisy: false }, 'voice')
    await s.idle()
  }
  const ops = () => out.filter((m): m is Extract<ServerMsg, { type: 'ops' }> => m.type === 'ops').flatMap((m) => m.ops)
  const entries = () => ops().filter((o): o is Extract<LedgerOp, { op: 'entry' }> => o.op === 'entry')
  return { s, out, said, ops, entries, turn, contexts }
}

describe('lists of entries', () => {
  it('a closing direction word covers the list, after one question', async () => {
    const h = harness([cust('r', 'Ramesh'), cust('s', 'Suresh'), cust('g', 'Geeta')])
    await h.turn('Ramesh 200, Suresh 300, Geeta 150 udhaar')
    expect(h.entries()).toHaveLength(0)
    expect(h.s.pending?.kind).toBe('batch')
    expect(h.said[0]).toMatch(/Ramesh 200.*Suresh 300.*Geeta 150.*उधार/)
    const view = h.out.filter((m) => m.type === 'pending').at(-1)
    expect(view).toMatchObject({ pending: { kind: 'batch', direction: 'credit', options: ['Ramesh ₹200', 'Suresh ₹300', 'Geeta ₹150'] } })
    await h.turn('haan')
    expect(h.entries().map((e) => [e.cid, e.paise, e.direction])).toEqual([
      ['r', 20000, 'credit'], ['s', 30000, 'credit'], ['g', 15000, 'credit'],
    ])
    expect(h.s.pending).toBeNull()
  })

  it('"no" to the list question asks about each entry instead', async () => {
    const h = harness([cust('r', 'Ramesh'), cust('s', 'Suresh')])
    await h.turn('Ramesh 200, Suresh 300 udhaar')
    await h.turn('nahi')
    expect(h.s.pending?.kind).toBe('direction')
    await h.turn('jama')
    expect(h.entries()[0]).toMatchObject({ cid: 'r', paise: 20000, direction: 'payment' })
    // Suresh said "udhaar" himself, so he is saved without another question
    expect(h.entries()[1]).toMatchObject({ cid: 's', paise: 30000, direction: 'credit' })
  })

  it('a one-word direction answer to the list question applies to all of it', async () => {
    const h = harness([cust('r', 'Ramesh'), cust('s', 'Suresh')])
    await h.turn('Ramesh 200, Suresh 300 udhaar')
    await h.turn('jama')
    expect(h.entries().map((e) => e.direction)).toEqual(['payment', 'payment'])
  })

  it('"sab udhaar" is explicit: saves the whole list without a question', async () => {
    const h = harness([cust('r', 'Ramesh'), cust('s', 'Suresh'), cust('g', 'Geeta')])
    await h.turn('sab udhaar, Ramesh 200, Suresh 300, Geeta 150')
    expect(h.entries().map((e) => [e.cid, e.paise, e.direction])).toEqual([
      ['r', 20000, 'credit'], ['s', 30000, 'credit'], ['g', 15000, 'credit'],
    ])
  })

  it('a direction word in the middle does not leak onto later names', async () => {
    const h = harness([cust('a', 'Anil'), cust('r', 'Ravi')])
    await h.turn('Anil ka 150 udhaar aur Ravi 1200')
    expect(h.entries()).toHaveLength(1)
    expect(h.s.pending?.kind).toBe('direction')
  })

  it('a typed list, one per line, works like a spoken one', async () => {
    const h = harness([cust('r', 'Ramesh'), cust('s', 'Suresh')])
    h.s.onClient({ type: 'text', text: 'Ramesh ka 200 udhaar\nSuresh ne 300 jama kiye' })
    await h.s.idle()
    expect(h.entries().map((e) => [e.cid, e.paise, e.direction])).toEqual([['r', 20000, 'credit'], ['s', 30000, 'payment']])
  })
})

describe('conversation context', () => {
  it('"uska total?" answers for the customer just talked about', async () => {
    const h = harness([cust('r', 'Ramesh', 0), cust('s', 'Suresh', 900)])
    await h.turn('Ramesh ka 340 udhaar')
    await h.turn('uska total kitna hai')
    expect(h.said.join(' ')).toContain('रमेश'.length ? 'Ramesh' : '')
    expect(h.said.join(' ')).toContain('340')
  })

  it('"usko 100 aur udhaar" adds to the same customer without asking who', async () => {
    const h = harness([cust('r', 'Ramesh'), cust('s', 'Suresh')])
    await h.turn('Ramesh ka 340 udhaar')
    await h.turn('usko 100 aur udhaar')
    expect(h.entries().map((e) => [e.cid, e.paise, e.direction])).toEqual([['r', 34000, 'credit'], ['r', 10000, 'credit']])
    expect(h.contexts).toHaveLength(0) // no model call needed
  })

  it('the model gets the recent conversation and a numbered list of recent entries', async () => {
    const h = harness([cust('r', 'Ramesh'), cust('s', 'Suresh')], [ent('e2', 's', 200, 'payment'), ent('e1', 'r', 340, 'credit')],
      () => ({ intent: 'entries', sure: true, entries: [{ name: 'Suresh', amount: 340, direction: 'credit', day_offset: 0, promise: false }] }))
    await h.turn('Ramesh ka 500 udhaar')
    await h.turn('Suresh ka bhi same')
    const c = h.contexts.at(-1)!
    expect(c.history?.join('\n')).toContain('Shopkeeper: Ramesh ka 500 udhaar')
    expect(c.recent?.[0]).toMatch(/^#1 Ramesh credit 500/)
    expect(c.recent?.[1]).toMatch(/^#2 Suresh payment 200/)
    // 340 was never spoken in this turn, but it is a recent amount, so the model may copy it
    expect(h.entries().at(-1)).toMatchObject({ cid: 's', paise: 34000, direction: 'credit' })
  })

  it('an amount that is neither spoken nor recent is still never saved', async () => {
    const h = harness([cust('r', 'Ramesh'), cust('s', 'Suresh')], [ent('e1', 'r', 340, 'credit')],
      () => ({ intent: 'entries', sure: true, entries: [{ name: 'Suresh', amount: 777, direction: 'credit', day_offset: 0, promise: false }] }))
    await h.turn('Suresh ka bhi same')
    expect(h.entries()).toHaveLength(0)
  })
})

describe('changing older entries', () => {
  const people = () => [cust('r', 'Ramesh', 340), cust('s', 'Suresh', -200), cust('g', 'Geeta', 150)]
  const recent = () => [ent('e3', 'g', 150, 'credit'), ent('e2', 's', 200, 'payment'), ent('e1', 'r', 340, 'credit', '2026-11-12')]

  it('removes an older entry by name after reading it back', async () => {
    const h = harness(people(), recent(), () => ({ intent: 'modify', sure: true, modify: { ref: 2, amount: null, direction: null, name: null, remove: true } }))
    await h.turn('Suresh wali entry hata do')
    expect(h.ops()).toHaveLength(0)
    expect(h.s.pending?.kind).toBe('modify')
    expect(h.said[0]).toContain('Suresh')
    await h.turn('haan')
    expect(h.ops()).toEqual([{ op: 'void', eid: 'e2', reason: 'spoken remove' }])
    // and the last entry was not touched
    expect(h.ops().some((o) => 'eid' in o && o.eid === 'e3')).toBe(false)
  })

  it('changes yesterday\'s amount for a named customer', async () => {
    const h = harness(people(), recent(), () => ({ intent: 'modify', sure: true, modify: { ref: 3, amount: 430, direction: null, name: null, remove: false } }))
    await h.turn('Ramesh ka kal wala 340 nahi 430 tha')
    await h.turn('haan')
    expect(h.ops()).toEqual([{ op: 'amend', eid: 'e1', paise: 43000 }])
  })

  it('"no" to the read-back changes nothing', async () => {
    const h = harness(people(), recent(), () => ({ intent: 'modify', sure: true, modify: { ref: 3, amount: 430, direction: null, name: null, remove: false } }))
    await h.turn('Ramesh ka kal wala 340 nahi 430 tha')
    await h.turn('nahi')
    expect(h.ops()).toHaveLength(0)
    expect(h.s.pending).toBeNull()
  })

  it('a model pointing at an entry that does not exist changes nothing', async () => {
    const h = harness(people(), recent(), () => ({ intent: 'modify', sure: true, modify: { ref: 9, amount: 430, direction: null, name: null, remove: false } }))
    await h.turn('Ramesh ka kal wala 340 nahi 430 tha')
    await h.turn('haan')
    expect(h.ops()).toHaveLength(0)
  })

  it('moves an entry to another customer and keeps balances right on the server copy', async () => {
    const h = harness(people(), recent(), () => ({ intent: 'modify', sure: true, modify: { ref: 3, amount: null, direction: null, name: 'Suresh', remove: false } }))
    await h.turn('Ramesh ka kal wala 340 galat hai, Suresh ka tha')
    await h.turn('haan')
    expect(h.ops()).toEqual([{ op: 'amend', eid: 'e1', cid: 's' }])
    const bal = Object.fromEntries(h.s.snap.customers.map((c) => [c.cid, c.balancePaise / 100]))
    expect(bal).toEqual({ r: 0, s: 140, g: 150 })
    expect(h.s.snap.recent?.find((e) => e.eid === 'e1')?.cid).toBe('s')
  })

  it('removing via the fast "undo" path still only touches the last entry', async () => {
    const h = harness(people(), recent())
    await h.turn('cancel')
    expect(h.ops()).toEqual([{ op: 'void', eid: 'e3', reason: 'spoken undo' }])
    expect(h.s.snap.last?.eid).toBe('e2') // the next "undo" would reach the one before
  })
})

describe('review fixes', () => {
  it('"Suresh 200" in reply to "Ramesh 500, correct?" does not change Ramesh', async () => {
    const h = harness([cust('r', 'Ramesh'), cust('s', 'Suresh')])
    await h.s.handleText('Ramesh ka 500 udhaar', { speechEnd: 0, commitAt: null, finalAt: 0, early: false, snrDb: 3, noisy: true }, 'voice')
    await h.s.idle()
    expect(h.s.pending?.kind).toBe('confirm')
    await h.turn('Suresh ka 200 udhaar')
    expect(h.entries().map((e) => [e.cid, e.paise])).toEqual([['s', 20000]])
  })

  it('a slip in the same breath saves only the corrected amount, for the named customer', async () => {
    const h = harness([cust('r', 'Ramesh'), cust('s', 'Suresh')], [ent('e1', 's', 200, 'payment')])
    await h.turn('Ramesh ko 500 nahi 300 udhaar')
    expect(h.ops().filter((o) => o.op === 'amend')).toHaveLength(0)
    expect(h.entries().map((e) => [e.cid, e.paise, e.direction])).toEqual([['r', 30000, 'credit']])
  })

  it('one breath about a new name makes one customer, not two', async () => {
    const h = harness([])
    await h.turn('Pinky ka 200 udhaar aur Pinky ka 100 udhaar')
    await h.turn('haan') // new name is read back
    await h.turn('haan')
    const adds = h.ops().filter((o) => o.op === 'add_customer')
    expect(adds).toHaveLength(1)
    expect(new Set(h.entries().map((e) => e.cid)).size).toBe(1)
  })

  it('totals follow undo, and a promise is undone instead of the entry before it', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('Ramesh ka 500 udhaar')
    expect(h.s.snap.today.creditPaise).toBe(50000)
    expect(h.s.snap.month.creditPaise).toBe(50000)
    await h.turn('cancel')
    expect(h.s.snap.today).toMatchObject({ creditPaise: 0, entries: 0 })
    await h.turn('Ramesh ka 300 udhaar')
    await h.turn('Ramesh kal 300 de dega')
    const promise = h.entries().at(-1)!
    expect(promise.promise).toBe(true)
    await h.turn('cancel')
    expect(h.ops().at(-1)).toMatchObject({ op: 'void', eid: promise.eid })
    expect(h.s.snap.customers[0].balancePaise).toBe(30000)
  })

  it('zero is never saved and ₹10,000+ for a new customer is read back first', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('Ramesh ko 0 udhaar')
    expect(h.entries()).toHaveLength(0)
    await h.turn('Ramesh ka 15000 udhaar')
    expect(h.entries()).toHaveLength(0)
    expect(h.s.pending?.kind).toBe('confirm')
  })

  it('an unread change request about an older entry says so instead of changing the last entry', async () => {
    const h = harness([cust('r', 'Ramesh'), cust('s', 'Suresh'), cust('g', 'Geeta')],
      [ent('e3', 'g', 150, 'credit'), ent('e2', 's', 200, 'payment')], () => ({ intent: 'unclear', sure: false }))
    await h.turn('Suresh wali entry hata do')
    expect(h.ops()).toHaveLength(0)
    expect(h.said.length).toBe(1)
  })

  it('every turn ends with turn_done, even when nothing is said', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('bhaiya thoda jaldi karo')
    expect(h.out.at(-1)).toEqual({ type: 'turn_done' })
  })

  it('a model promise on a credit or a far-off day is not trusted', () => {
    const v = validate('Ramesh ka 340', { intent: 'entries', sure: true, entries: [{ name: 'Ramesh', amount: 340, direction: 'credit', day_offset: 99999, promise: true }] })
    expect(v.type).toBe('entries')
    if (v.type !== 'entries') return
    expect(v.entries[0].promise).toBe(false)
    expect(v.entries[0].dayOffset).toBe(30)
  })
})
