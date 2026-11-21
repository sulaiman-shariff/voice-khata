import { describe, expect, it } from 'vitest'
import { nullLogger } from '../log.js'
import { type Draft, LedgerCore } from './core.js'

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
})
