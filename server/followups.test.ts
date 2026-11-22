/**
 * Follow-ups that "should just know": the person just talked about, a "nahi" that leads to a fix,
 * a yes with extra detail. And the guard: nothing lands in an existing customer's khata blindly.
 */
import { describe, expect, it } from 'vitest'
import { parseFast } from '../shared/intent.js'
import { callsOf, cust, harness } from './test-harness.js'

const people = () => [cust('r', 'Ramesh'), cust('s1', 'Suresh'), cust('s2', 'Suresh')]

describe('follow-ups keep the person (the agent resolves who; code checks it)', () => {
  const said = (from_context: boolean) => () => callsOf({ name: 'add_entries', args: { entries: [{ name: 'Ramesh', amount: 50, direction: 'credit', from_context }] } })

  it('the agent marks "aur 50" as the talked-about Ramesh: written at once', async () => {
    const h = harness(people(), { agent: said(true) })
    await h.turn('Ramesh ka 300 udhaar') // instant path, no agent
    await h.turn('aur 50 udhaar')
    expect(h.written()).toEqual([['r', 300, 'credit'], ['r', 50, 'credit']])
  })

  it('a name the agent filled in without marking it as context is read back first', async () => {
    const h = harness(people(), { agent: said(false) })
    await h.turn('Ramesh ka 300 udhaar')
    await h.turn('aur 50 udhaar')
    expect(h.written()).toEqual([['r', 300, 'credit']])
    expect(h.asks).toBe('confirm')
  })

  it('"from context" is only believed for the customer actually being talked about', async () => {
    const h = harness(people(), { agent: () => callsOf({ name: 'add_entries', args: { entries: [{ name: 'Geeta', amount: 50, direction: 'credit', from_context: true }] } }) })
    await h.turn('Ramesh ka 300 udhaar')
    await h.turn('aur 50 udhaar')
    expect(h.written()).toEqual([['r', 300, 'credit']])
  })

  it('the instant path only takes a sentence it fully explains', async () => {
    for (const t of ['nahi nahi, Ramesh ka 400 ka khata hai', 'Ramesh ka 300 ka khata nikal do', 'Ramesh ka 300 khata kholo']) {
      const h = harness(people(), { agent: () => callsOf({ name: 'not_for_me', args: {} }) })
      await h.turn(t)
      expect(h.agentCalls.length, t).toBe(1)
      expect(h.ops(), t).toEqual([])
    }
  })
})

describe('"nahi" fixes, it does not just drop', () => {
  it('a spoken "nahi" keeps the line for one fix: "430" then writes 430', async () => {
    const h = harness(people())
    await h.turn('Ramesh ka 340 udhaar', true)
    await h.turn('nahi')
    expect(h.ops()).toEqual([])
    await h.turn('430')
    expect(h.written()).toEqual([['r', 430, 'credit']])
  })

  it('"nahi" then "jama" flips the direction', async () => {
    const h = harness(people())
    await h.turn('Ramesh ka 340 udhaar', true)
    await h.turn('nahi')
    await h.turn('jama')
    expect(h.written()).toEqual([['r', 340, 'payment']])
  })

  it('"nahi" twice drops it; a tap on ✗ drops it at once', async () => {
    let h = harness(people())
    await h.turn('Ramesh ka 340 udhaar', true)
    await h.turn('nahi')
    await h.turn('nahi')
    expect(h.ops()).toEqual([])
    expect(h.asks).toBeNull()
    h = harness(people())
    await h.turn('Ramesh ka 340 udhaar', true)
    await h.tap('no')
    expect(h.asks).toBeNull()
  })
})

describe('a yes with extra detail uses the detail', () => {
  it('"haan, 400" to a new customer read-back opens the khata with 400', async () => {
    const h = harness(people())
    await h.turn('Mahesh ka 300 udhaar')
    await h.turn('haan, 400')
    expect(h.accounts()).toEqual(['Mahesh'])
    expect(h.entries().map((e) => e.paise)).toEqual([40000])
  })


  it('"open a khata?" then "haan, 300 udhaar" opens it with the entry', async () => {
    const h = harness(people())
    await h.turn('Mahesh ka hisaab')
    await h.turn('haan, 300 udhaar')
    expect(h.accounts()).toEqual(['Mahesh'])
    expect(h.entries().map((e) => [e.paise, e.direction])).toEqual([[30000, 'credit']])
  })

  it('a name answer that is exactly a known customer needs no second read-back', async () => {
    const h = harness(people())
    await h.turn('300 udhaar likho')
    await h.turn('Ramesh')
    expect(h.written()).toEqual([['r', 300, 'credit']])
  })

  it('a name answer that is a twin still asks which', async () => {
    const h = harness(people())
    await h.turn('300 udhaar likho')
    await h.turn('Suresh')
    expect(h.ops()).toEqual([])
  })
})

describe('never blindly into an existing khata', () => {
  it('"Ramesh 300 ka khata kholo" when Ramesh exists is read back, not written', async () => {
    const h = harness(people(), { agent: () => callsOf({ name: 'add_customer', args: { name: 'Ramesh' } }) })
    await h.turn('Ramesh 300 ka khata kholo')
    expect(h.ops()).toEqual([])
    expect(h.asks).not.toBeNull()
  })

  it('"naya khata Ramesh 300" when Ramesh exists opens a second Ramesh (read back first)', async () => {
    const h = harness(people(), { agent: () => callsOf({ name: 'add_customer', args: { name: 'Ramesh' } }) })
    await h.turn('naya Ramesh 300 ka khata')
    expect(h.ops()).toEqual([])
    await h.tap('yes')
    expect(h.accounts()).toEqual(['Ramesh'])
    expect(h.entries()[0].cid).not.toBe('r')
  })


  it('a yes word inside a name answer is not mistaken for "haan + detail"', () => {
    expect(parseFast('haan').type).toBe('yes')
  })
})
