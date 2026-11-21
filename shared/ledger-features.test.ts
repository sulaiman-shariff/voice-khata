/**
 * Due dates and ageing, the collect-today list, instalment plans, the galla (cashbook), supplier
 * accounts and labels for customers who share a name. Every new event is additive: old event logs
 * replay exactly as before.
 */
import { describe, expect, it } from 'vitest'
import {
  type LedgerEvent, addDays, ageing, balance, cashbook, collectFrom, collectList, daySummary, displayName, dues, isPastDue,
  lenaDena, morningBriefing, owedLabel, planSchedule, planStatus, reduce, sevenDayTotals, supplierDues, uniqueLabels,
} from './ledger.js'

const T = '2026-11-22'
const ago = (n: number) => addDays(T, -n)
const build = (evs: LedgerEvent[]) => reduce(evs.map((ev, i) => ({ ev, ts: i })))
const cust = (cid: string, name: string, kind?: 'supplier'): LedgerEvent => ({ type: 'customer_added', cid, name, aliases: [], ...(kind ? { kind } : {}) })
const credit = (eid: string, cid: string, rs: number, day: string, extra: Partial<Extract<LedgerEvent, { type: 'entry' }>> = {}): LedgerEvent =>
  ({ type: 'entry', eid, cid, paise: rs * 100, direction: 'credit', day, ...extra })
const pay = (eid: string, cid: string, rs: number, day: string, extra: Partial<Extract<LedgerEvent, { type: 'entry' }>> = {}): LedgerEvent =>
  ({ type: 'entry', eid, cid, paise: rs * 100, direction: 'payment', day, ...extra })

describe('backward compatibility', () => {
  it('an old log (no kind, no due, no cash, no plans) reduces exactly as before', () => {
    const s = build([cust('r', 'Ramesh'), credit('e1', 'r', 300, ago(2)), pay('e2', 'r', 100, ago(1))])
    expect(balance(s, 'r')).toBe(20000)
    expect(s.customers.get('r')!.kind).toBe('customer')
    expect(s.entries.get('e1')!.due).toBeUndefined()
    expect(s.cash.size).toBe(0)
    expect(s.plans.size).toBe(0)
    expect(dues(s)).toEqual([{ cid: 'r', paise: 20000 }])
  })

  it('a due date replays; a due-only amend is not a correction, null clears it', () => {
    const s = build([cust('r', 'Ramesh'), credit('e1', 'r', 300, ago(2), { due: ago(1) })])
    expect(s.entries.get('e1')!.due).toBe(ago(1))
    expect(isPastDue(s, 'e1', T)).toBe(true)
    const t = build([cust('r', 'Ramesh'), credit('e1', 'r', 300, ago(2), { due: ago(1) }), { type: 'entry_amended', eid: 'e1', due: addDays(T, 5) }])
    expect(t.entries.get('e1')).toMatchObject({ due: addDays(T, 5), amended: false })
    expect(isPastDue(t, 'e1', T)).toBe(false)
    const u = build([cust('r', 'Ramesh'), credit('e1', 'r', 300, ago(2), { due: ago(1) }), { type: 'entry_amended', eid: 'e1', due: null }])
    expect(u.entries.get('e1')!.due).toBeUndefined()
  })
})

describe('ageing', () => {
  it('buckets by the oldest unpaid credit, payments clearing the oldest first', () => {
    const s = build([
      cust('a', 'A'), cust('b', 'B'), cust('c', 'C'), cust('g', 'Gupta', 'supplier'),
      credit('a1', 'a', 100, ago(40)), credit('a2', 'a', 100, ago(3)), pay('a3', 'a', 100, ago(1)), // the 40-day one is paid off
      credit('b1', 'b', 500, ago(12)),
      credit('c1', 'c', 50, ago(31)), pay('c2', 'c', 20, ago(2)), // partly paid: still 31 days old
      credit('g1', 'g', 9000, ago(60)), // a supplier: never in ageing
    ])
    const { rows, buckets } = ageing(s, T)
    expect(rows.map((r) => [r.cid, r.days, r.bucket])).toEqual([['b', 12, '8-30'], ['a', 3, '0-7'], ['c', 31, '30+']])
    expect(buckets).toEqual({ '0-7': { count: 1, paise: 10000 }, '8-30': { count: 1, paise: 50000 }, '30+': { count: 1, paise: 3000 } })
  })
})

describe('collect today', () => {
  it('due today or past, a promise for today, and 30+ days: one row each, no suppliers, no duplicates', () => {
    const s = build([
      cust('a', 'A'), cust('b', 'B'), cust('c', 'C'), cust('d', 'D'), cust('g', 'G', 'supplier'),
      credit('a1', 'a', 100, ago(40), { due: ago(1) }), // due past AND old: one row, both reasons
      credit('b1', 'b', 200, ago(2)), pay('b2', 'b', 200, T, { promise: true }), // promised today
      credit('c1', 'c', 300, ago(5)), // nothing to do yet
      credit('d1', 'd', 400, ago(2), { due: addDays(T, 3) }), // due later
      credit('g1', 'g', 900, ago(50), { due: ago(1) }),
    ])
    const rows = collectList(s, T)
    expect(rows.map((r) => [r.cid, r.reasons])).toEqual([['a', ['due', 'old']], ['b', ['promise']]])
    expect(morningBriefing(s, T)).toEqual({ promises: 1, due: 1, old: 1, count: 2, paise: 30000 })
    expect(collectFrom([{ cid: 'x', balancePaise: 100, dueDay: T }, { cid: 'x', balancePaise: 100, dueDay: T }], T)).toHaveLength(1)
  })
})

describe('instalment plans', () => {
  const plan = (extra: LedgerEvent[] = []) => build([
    cust('r', 'Ramesh'), credit('e0', 'r', 3000, ago(30)),
    { type: 'plan_set', cid: 'r', pid: 'p1', totalPaise: 300000, parts: 3, everyDays: 7, startDay: ago(7) },
    ...extra,
  ])

  it('splits evenly, the last part takes the remainder', () => {
    expect(planSchedule({ totalPaise: 100000, parts: 3, everyDays: 7, startDay: T }).map((p) => p.paise)).toEqual([33333, 33333, 33334])
  })

  it('on schedule, behind, and an overpayment carried into the next instalment', () => {
    const behind = planStatus(plan(), 'r', T)!
    expect(behind).toMatchObject({ paidParts: 0, behind: true, behindPaise: 100000, next: { index: 0, day: ago(7), paise: 100000 } })
    const onTime = planStatus(plan([pay('p1', 'r', 1000, ago(7))]), 'r', T)!
    expect(onTime).toMatchObject({ paidParts: 1, behind: false, next: { index: 1, day: T, paise: 100000 } })
    const over = planStatus(plan([pay('p1', 'r', 1500, ago(7))]), 'r', T)!
    expect(over).toMatchObject({ paidParts: 1, paidPaise: 150000, behind: false, next: { index: 1, paise: 50000 } })
  })

  it('ends by itself at a zero balance; cancel removes it; does not move the balance', () => {
    const done = planStatus(plan([pay('p1', 'r', 3000, T)]), 'r', T)!
    expect(done).toMatchObject({ done: true, next: null, behind: false })
    expect(balance(plan(), 'r')).toBe(300000)
    expect(planStatus(plan([{ type: 'plan_cancelled', cid: 'r', pid: 'p1' }]), 'r', T)).toBeNull()
    expect(planStatus(plan([{ type: 'plan_cancelled', cid: 'r', pid: 'other' }]), 'r', T)).not.toBeNull()
  })
})

describe('galla (cashbook)', () => {
  it('cash rows never touch a customer balance; cash in/out reach daySummary; bank payments stay apart', () => {
    const s = build([
      cust('r', 'Ramesh'), cust('g', 'Gupta', 'supplier'),
      credit('e1', 'r', 500, T), pay('e2', 'r', 200, T), pay('e3', 'r', 100, T, { source: { transcript: 'rzp', confidence: 'high', reasons: ['razorpay'], lang: 'hi' } }),
      { type: 'cash', eid: 'k1', paise: 80000, dir: 'out', category: 'bills', day: T },
      { type: 'cash', eid: 'k2', paise: 200000, dir: 'in', category: 'other', day: T },
      { type: 'cash', eid: 'k3', paise: 5000, dir: 'out', category: 'stock', day: T }, { type: 'entry_voided', eid: 'k3', reason: 'galat' },
      credit('g1', 'g', 5000, T), pay('g2', 'g', 2000, T),
    ])
    expect(balance(s, 'r')).toBe(20000)
    const cb = cashbook(s, T)
    expect(cb.rows.map((r) => [r.eid, r.dir, r.derived])).toEqual([['e2', 'in', true], ['k1', 'out', false], ['k2', 'in', false], ['g2', 'out', true]])
    expect([cb.inPaise, cb.outPaise, cb.bankInPaise]).toEqual([220000, 280000, 10000])
    const d = daySummary(s, T)
    expect(d).toMatchObject({ creditPaise: 50000, paymentPaise: 30000, cashIn: 220000, cashOut: 280000, bankIn: 10000 })
    // amending a cash row's amount
    const t = build([{ type: 'cash', eid: 'k1', paise: 80000, dir: 'out', category: 'bills', day: T }, { type: 'entry_amended', eid: 'k1', paise: 90000 }])
    expect(cashbook(t, T).outPaise).toBe(90000)
  })

  it('seven-day totals for the sparkline, oldest first, customers only', () => {
    const s = build([cust('r', 'Ramesh'), credit('a', 'r', 100, ago(6)), pay('b', 'r', 50, T), credit('c', 'r', 999, ago(7))])
    const w = sevenDayTotals(s, T)
    expect(w).toHaveLength(7)
    expect(w[0]).toEqual({ day: ago(6), creditPaise: 10000, paymentPaise: 0 })
    expect(w[6]).toEqual({ day: T, creditPaise: 0, paymentPaise: 5000 })
  })
})

describe('suppliers', () => {
  it('the sign runs the other way and suppliers are never in dues', () => {
    const s = build([cust('r', 'Ramesh'), cust('g', 'Gupta', 'supplier'), credit('e1', 'r', 300, T), credit('g1', 'g', 5000, T), pay('g2', 'g', 2000, T)])
    expect(balance(s, 'g')).toBe(300000)
    expect(owedLabel('supplier', balance(s, 'g'))).toEqual({ side: 'dena', paise: 300000 })
    expect(owedLabel('customer', balance(s, 'r'))).toEqual({ side: 'lena', paise: 30000 })
    expect(owedLabel('customer', -500)).toEqual({ side: 'dena', paise: 500 })
    expect(owedLabel('supplier', -500)).toEqual({ side: 'lena', paise: 500 })
    expect(dues(s)).toEqual([{ cid: 'r', paise: 30000 }])
    expect(supplierDues(s)).toEqual([{ cid: 'g', paise: 300000 }])
    expect(lenaDena(s)).toEqual({ lenaPaise: 30000, denaPaise: 300000 })
    expect(daySummary(s, T).creditPaise).toBe(30000)
    // an account turned into a supplier
    const t = build([cust('r', 'Ramesh'), credit('e1', 'r', 300, T), { type: 'customer_kind', cid: 'r', kind: 'supplier' }])
    expect(dues(t)).toEqual([])
  })
})

describe('customers with the same name', () => {
  it('labels are unique: nickname, phone digits, then order of creation; never a balance', () => {
    const l = uniqueLabels([
      { cid: 'a', name: 'Ramesh' }, { cid: 'b', name: 'Ramesh', tag: 'doodhwala' }, { cid: 'c', name: 'ramesh', phone: '98765 43210' },
      { cid: 'd', name: 'Ramesh' }, { cid: 'e', name: 'Suresh' }, { cid: 'f', name: 'Ramesh 2' },
    ])
    expect([...l.values()]).toEqual(['Ramesh 1', 'Ramesh · doodhwala', 'ramesh · …3210', 'Ramesh 2', 'Suresh', 'Ramesh 2 (2)'])
    expect(new Set(l.values()).size).toBe(6)
    // the same nickname twice is still told apart
    const m = uniqueLabels([{ cid: 'a', name: 'Ramesh', tag: 'Gali 3' }, { cid: 'b', name: 'Ramesh', tag: 'Gali 3' }])
    expect([...m.values()]).toEqual(['Ramesh · Gali 3', 'Ramesh · Gali 3 (2)'])
  })

  it('displayName follows a nickname saved later', () => {
    const s = build([cust('a', 'Ramesh'), cust('b', 'Ramesh')])
    expect(displayName(s, 'b')).toBe('Ramesh 2')
    const t = build([cust('a', 'Ramesh'), cust('b', 'Ramesh'), { type: 'consent', cid: 'b', remindersOptIn: false, adult: false, tag: 'doodhwala' }])
    expect([displayName(t, 'a'), displayName(t, 'b')]).toEqual(['Ramesh', 'Ramesh · doodhwala'])
  })
})
