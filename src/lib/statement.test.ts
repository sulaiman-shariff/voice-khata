import { describe, expect, it } from 'vitest'
import { apply, emptyLedger } from '../../shared/ledger.js'
import { type DrawOp, type StatementInput, itemsOf, runningRows, statementInputFor, statementLayout, STATEMENT_WIDTH } from './statement'

const labels = {
  statementFor: 'Statement', opening: 'Earlier balance', totalDue: 'Total due', advance: 'Advance', settled: 'All settled',
  credit: 'Credit', payment: 'Paid', colDate: 'Date', colDetail: 'Details', colAmount: 'Amount', colBalance: 'Balance',
  scanToPay: 'Scan to pay', madeWith: 'Made with KhataBhai',
}
const day = (n: number) => `2026-11-${String(n).padStart(2, '0')}`
const input = (over: Partial<StatementInput> = {}): StatementInput => ({
  shop: { name: 'Sharma Kirana', owner: 'Raj', phone: '98765 43210' },
  customer: { name: 'Ramesh' },
  entries: [
    { day: day(1), paise: 50000, direction: 'credit', note: 'do kilo chawal, ek Maggi' },
    { day: day(3), paise: 20000, direction: 'payment' },
    { day: day(2), paise: 10000, direction: 'credit' },
  ],
  labels,
  ...over,
})
const texts = (ops: DrawOp[]) => ops.flatMap((o) => (o.op === 'text' ? [o.text] : []))

describe('statement layout', () => {
  it('starts with a 1080-wide page tall enough for every op', () => {
    const ops = statementLayout(input())
    const page = ops[0]
    expect(page.op).toBe('page')
    if (page.op !== 'page') return
    expect(page.w).toBe(STATEMENT_WIDTH)
    for (const o of ops.slice(1)) {
      const bottom = o.op === 'line' ? Math.max(o.y1, o.y2) : o.op === 'text' ? o.y : o.op === 'page' ? 0 : o.y + ('h' in o ? o.h : o.size)
      expect(bottom).toBeLessThanOrEqual(page.h)
    }
  })

  it('keeps entries in date order with a running balance', () => {
    const { rows, opening, closing } = runningRows(input().entries)
    expect(rows.map((r) => r.balance)).toEqual([50000, 60000, 40000])
    expect(opening).toBeNull()
    expect(closing).toBe(40000)
    const t = texts(statementLayout(input()))
    expect(t).toContain('Sharma Kirana')
    expect(t).toContain('Raj · 98765 43210')
    expect(t).toContain('₹400')
    expect(t).toContain('Total due')
  })

  it('shows only the last 15 entries and folds the rest into an earlier balance', () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({ day: day(i + 1), paise: 1000, direction: 'credit' as const }))
    const { rows, opening } = runningRows(entries)
    expect(rows).toHaveLength(15)
    expect(opening).toBe(5000)
    const t = texts(statementLayout(input({ entries })))
    expect(t).toContain('Earlier balance')
    expect(t.filter((x) => x === 'Credit')).toHaveLength(15)
  })

  it('draws the items of a bill as chips', () => {
    expect(itemsOf('do kilo chawal, ek Maggi ,')).toEqual(['do kilo chawal', 'ek Maggi'])
    const t = texts(statementLayout(input()))
    expect(t).toContain('do kilo chawal')
    expect(t).toContain('ek Maggi')
  })

  it('adds the tag chip and the pay QR only when something is owed', () => {
    const owed = statementLayout(input({ customer: { name: 'Ramesh', tag: 'doodhwala' }, payUrl: 'upi://pay?pa=a@b' }))
    expect(texts(owed)).toContain('doodhwala')
    expect(owed.some((o) => o.op === 'qr' && o.text === 'upi://pay?pa=a@b')).toBe(true)
    const settled = statementLayout(input({ entries: [{ day: day(1), paise: 100, direction: 'payment' }], payUrl: 'upi://pay?pa=a@b' }))
    expect(settled.some((o) => o.op === 'qr')).toBe(false)
    expect(texts(settled)).toContain('Advance')
  })

  it('builds the input from the ledger: live entries only, the tag split from the label', () => {
    const s = emptyLedger()
    apply(s, { type: 'customer_added', cid: 'c1', name: 'Ramesh', aliases: [] })
    apply(s, { type: 'entry', eid: 'e1', cid: 'c1', paise: 500, direction: 'credit', day: day(1), note: 'Maggi' })
    apply(s, { type: 'entry', eid: 'e2', cid: 'c1', paise: 300, direction: 'credit', day: day(2) })
    apply(s, { type: 'entry_voided', eid: 'e2', reason: 'x' })
    apply(s, { type: 'entry', eid: 'e3', cid: 'c1', paise: 200, direction: 'payment', day: day(5), promise: true })
    const inp = statementInputFor(s, 'c1', { shop: { name: 'S' }, label: 'Ramesh · doodhwala', tag: 'doodhwala', labels, payUrl: 'upi://x' })
    expect(inp.customer).toEqual({ name: 'Ramesh', tag: 'doodhwala' })
    expect(inp.entries).toHaveLength(1)
    expect(inp.entries[0].note).toBe('Maggi')
    expect(inp.payUrl).toBe('upi://x')
  })
})
