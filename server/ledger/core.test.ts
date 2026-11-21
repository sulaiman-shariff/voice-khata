import { describe, expect, it } from 'vitest'
import { nullLogger } from '../log.js'
import { type Draft, LedgerCore, PENDING_TTL_MS } from './core.js'

const core = () => {
  let n = 0
  return new LedgerCore({ lang: () => 'en', now: () => 0, newId: () => `id${++n}`, log: nullLogger })
}

const draft = (name: string, rupees: number, direction: 'credit' | 'payment', over: Partial<Draft> = {}): Draft => ({
  heardName: name, cid: null, newName: null, nameSure: false, spoken: false, paise: rupees * 100, alt: null,
  direction, dayOffset: 0, promise: false, confidence: 'high', reasons: [], path: 'fast', transcript: name, snrDb: null, noisy: false,
  ...over,
})

describe('ledger core', () => {
  it('a heard new name is read back before an account is opened', () => {
    const c = core()
    const r = c.processDrafts([draft('Pinky', 200, 'credit', { spoken: true })])
    expect(r.ops).toEqual([])
    expect(c.pending?.kind).toBe('confirm')
    expect(c.pendingView()?.newCustomer).toBe(true)
  })

  it('the core stamps and expires its own questions, and handles a fresh entry without a Session', () => {
    let now = 5000
    const c = new LedgerCore({ lang: () => 'en', now: () => now, newId: () => 'x', log: nullLogger })
    c.processDrafts([draft('Pinky', 200, 'credit', { spoken: true })])
    expect(c.pendingAt).toBe(5000)
    // a question the core opened by itself survives a reconnect
    const next = new LedgerCore({ lang: () => 'en', now: () => now, newId: () => 'y', log: nullLogger })
    next.importState(c.exportState())
    expect(next.pending?.kind).toBe('confirm')
    // a fresh, complete instruction while the question is open goes through the default dispatch
    now += 1000
    const r = c.answerPending('Ramesh 100 udhaar', { type: 'entries', entries: [{
      name: 'Ramesh', amount: { value: 100, start: 0, end: 1, text: '100', hasCurrency: false, flags: [], alternatives: [] },
      direction: 'credit', dayOffset: 0, promise: false, confidence: 'high', reasons: [],
    }] }, { snrDb: null, noisy: false, path: 'fast' })
    expect(r).not.toBeNull()
    expect(c.pending?.kind).toBe('confirm') // Ramesh is new too: read back
    expect(c.pendingAt).toBe(6000)
    now += PENDING_TTL_MS + 1
    expect(c.pendingView()).toBeNull()
    expect(c.pending).toBeNull()
  })
})
