/**
 * The new ops on the phone: galla rows, supplier accounts, due dates, itemised notes, plans and
 * nicknames, what the voice snapshot carries for them, and what the reminder sync uploads.
 */
import { describe, expect, it } from 'vitest'
import { addDays, balance, cashbook, dayFromOffset, planStatus } from '../../shared/ledger.js'
import type { LedgerOp } from '../../shared/protocol.js'
import { createStore, memoryPersistence } from './store.js'
import { receivablesPayload } from './sync.js'

const src = { transcript: 't', confidence: 'high' as const, reasons: [], lang: 'hi', path: 'llm' as const }
const today = dayFromOffset(0)

describe('store: shop features', () => {
  it('cash, supplier, due, note, plan and nickname ops are written, replayed once, and reach the snapshot', async () => {
    const p = memoryPersistence()
    const s = await createStore(p)
    const ops: LedgerOp[] = [
      { op: 'add_customer', cid: 'r', name: 'Ramesh' },
      { op: 'add_customer', cid: 'g', name: 'Gupta', kind: 'supplier' },
      { op: 'entry', eid: 'e1', cid: 'r', paise: 300000, direction: 'credit', dayOffset: 0, promise: false, due: addDays(today, 3), note: 'chawal, Maggi', source: src },
      { op: 'entry', eid: 'e2', cid: 'g', paise: 500000, direction: 'credit', dayOffset: 0, promise: false, source: src },
      { op: 'cash', eid: 'k1', paise: 80000, dir: 'out', category: 'bills', dayOffset: 0 },
      { op: 'set_plan', cid: 'r', pid: 'p1', totalPaise: 300000, parts: 3, everyDays: 7, startOffset: 7 },
      { op: 'set_tag', cid: 'r', tag: 'doodhwala' },
    ]
    await s.applyOps(ops)
    await s.applyOps(ops) // a re-sent batch writes nothing twice
    expect(s.state.cash.size).toBe(1)
    expect(balance(s.state, 'r')).toBe(300000)
    expect(cashbook(s.state, today).outPaise).toBe(80000)
    expect(planStatus(s.state, 'r')).toMatchObject({ next: { index: 0, day: addDays(today, 7), paise: 100000 } })
    expect(s.state.customers.get('r')).toMatchObject({ tag: 'doodhwala', remindersOptIn: false })
    const snap = s.snapshot()
    expect(snap.customers.find((c) => c.cid === 'g')).toMatchObject({ kind: 'supplier' })
    expect(snap.customers.find((c) => c.cid === 'r')).toMatchObject({
      tag: 'doodhwala', label: 'Ramesh · doodhwala', dueDay: addDays(today, 3), oldestDay: today,
      plan: { pid: 'p1', parts: 3, paidParts: 0, nextDay: addDays(today, 7), nextPaise: 100000, behind: false },
    })
    expect(snap.entries.find((e) => e.eid === 'e1')).toMatchObject({ due: addDays(today, 3), note: 'chawal, Maggi' })
    expect(snap.today).toMatchObject({ creditPaise: 300000, cashOut: 80000 })
    // the whole log replays from storage
    const again = await createStore(p)
    expect(again.state.cash.size).toBe(1)
    expect(again.state.plans.get('r')?.pid).toBe('p1')
  })

  it('a nickname keeps reminder consent and phone as they were', async () => {
    const s = await createStore(memoryPersistence())
    await s.applyOps([{ op: 'add_customer', cid: 'r', name: 'Ramesh' }])
    await s.setConsent('r', { remindersOptIn: true, adult: true, phone: '9876543210' })
    await s.applyOps([{ op: 'set_tag', cid: 'r', tag: 'Gali 3' }])
    expect(s.state.customers.get('r')).toMatchObject({ remindersOptIn: true, adult: true, phone: '9876543210', tag: 'Gali 3' })
    await s.setTag('r', '')
    expect(s.state.customers.get('r')!.tag).toBeUndefined()
    expect(s.state.customers.get('r')!.phone).toBe('9876543210')
  })

  it('the reminder sync never uploads suppliers and carries the sweep days', async () => {
    const s = await createStore(memoryPersistence())
    await s.applyOps([
      { op: 'add_customer', cid: 'r', name: 'Ramesh' }, { op: 'add_customer', cid: 'g', name: 'Gupta', kind: 'supplier' },
      { op: 'entry', eid: 'e1', cid: 'r', paise: 300000, direction: 'credit', dayOffset: 0, promise: false, due: addDays(today, 2), source: src },
      { op: 'entry', eid: 'e2', cid: 'g', paise: 9000, direction: 'credit', dayOffset: 0, promise: false, source: src },
      { op: 'set_plan', cid: 'r', pid: 'p1', totalPaise: 300000, parts: 3, everyDays: 7, startOffset: 7 },
    ])
    for (const cid of ['r', 'g']) await s.setConsent(cid, { remindersOptIn: true, adult: true, phone: '9876543210' })
    const p = receivablesPayload(s)
    expect(p.customers).toEqual([{
      cid: 'r', name: 'Ramesh', phone: '9876543210', balancePaise: 300000,
      oldestUnpaidDay: today, dueDay: addDays(today, 2), promiseDay: null, planNextDay: addDays(today, 7), planPartPaise: 100000,
    }])
  })
})
