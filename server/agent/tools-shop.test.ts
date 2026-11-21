/**
 * The shop-day tools (summary, ageing, collect list, plans, galla, suppliers, due dates, itemised
 * bills) and customers who share a name (labels, nicknames, sound-alikes, "naya Ramesh").
 */
import { describe, expect, it } from 'vitest'
import { parseFast } from '../../shared/intent.js'
import type { LedgerOp, SnapCustomer, SnapEntry } from '../../shared/protocol.js'
import { say } from '../../shared/replies.js'
import { sayShop } from '../../shared/replies-shop.js'
import { LedgerCore, type TurnMeta } from '../ledger/core.js'
import { nullLogger } from '../log.js'
import { type ToolCall, runTool } from './tools.js'

const R = say('en')
const S = sayShop('en')
const day = (n: number) => new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10)
const today = day(0)

const cust = (cid: string, name: string, balanceRs = 0, over: Partial<SnapCustomer> = {}): SnapCustomer => ({
  cid, name, aliases: [], householdId: null, remindersOptIn: false, adult: false, balancePaise: balanceRs * 100, typicalPaise: null, ...over,
})

function setup(customers: SnapCustomer[], entries: SnapEntry[] = []) {
  let n = 0
  const core = new LedgerCore({ lang: () => 'en', now: () => 1_000_000, newId: () => `id${++n}`, log: nullLogger })
  core.snap.customers = customers
  core.snap.entries = entries
  const meta = (transcript: string): TurnMeta & { transcript: string } => ({ snrDb: null, noisy: false, path: 'llm', transcript })
  // like the session: a reply's ops are applied to the local snapshot before the next turn
  const applied = <T extends { ops: LedgerOp[] } | null>(r: T): T => {
    for (const o of r?.ops ?? []) core.applyLocal(o)
    return r
  }
  const run = (name: ToolCall['name'], args: Record<string, unknown>, transcript: string) => applied(runTool(core, { name, args }, meta(transcript)))
  const answer = (t: string, src: 'voice' | 'tap' = 'voice') => {
    core.turnSrc = src
    return applied(core.answerPending(t, parseFast(t), meta(t)))
  }
  return { core, run, answer }
}

describe('the shop day', () => {
  it('show_today: credit, payments, new customers, the largest dues, promises for today, the galla', () => {
    const { core, run } = setup(
      [cust('r', 'Ramesh', 640), cust('s', 'Suresh', 300), cust('g', 'Gupta', 9000, { kind: 'supplier' }), cust('k', 'Geeta', 0)],
      [{ eid: 'p', cid: 'k', paise: 10000, direction: 'payment', day: today, promise: true }],
    )
    core.snap.today = { creditPaise: 187000, paymentPaise: 50000, entries: 4, newCustomers: 2, cashIn: 200000, cashOut: 80000 }
    const r = run('show_today', {}, 'aaj ka hisaab')
    expect(r.show).toEqual({ type: 'show', view: 'today' })
    expect(r.parts).toEqual([S.dailySummary({
      credit: 1870, paid: 500, newCustomers: 2, top: [{ name: 'Ramesh', amt: 640 }, { name: 'Suresh', amt: 300 }], promises: ['Geeta'], cashIn: 2000, cashOut: 800,
    })])
    expect(r.parts[0]).not.toContain('Gupta')
  })

  it('show_overdue lists customers older than the days asked, never suppliers', () => {
    const { run } = setup([
      cust('r', 'Ramesh', 640, { oldestDay: day(-40) }), cust('s', 'Suresh', 300, { oldestDay: day(-5) }),
      cust('g', 'Gupta', 9000, { kind: 'supplier', oldestDay: day(-90) }),
    ])
    const r = run('show_overdue', {}, 'kiska 30 din se purana hai')
    expect(r.show).toEqual({ type: 'show', view: 'overdue', days: 30 })
    expect(r.parts).toEqual([S.overdueList(1, 30, 640, ['Ramesh'])])
    expect(run('show_overdue', { days: 60 }, 'kiska 60 din se purana hai').parts).toEqual([S.noOverdue(60)])
  })

  it('collect_today: due date reached, promise today, 30+ days, each customer once', () => {
    const { run } = setup([
      cust('r', 'Ramesh', 640, { dueDay: today, oldestDay: day(-40) }), cust('s', 'Suresh', 300, { promiseDay: today }),
      cust('k', 'Geeta', 100, { dueDay: day(3) }), cust('g', 'Gupta', 9000, { kind: 'supplier', dueDay: today }),
    ])
    const r = run('collect_today', {}, 'aaj kisse lena hai')
    expect(r.show).toEqual({ type: 'show', view: 'collect' })
    expect(r.parts).toEqual([S.collectToday(2, 940, ['Ramesh', 'Suresh'])])
  })

  it('add_entries: items go into the note, a due date only when one was said', () => {
    const { run } = setup([cust('r', 'Ramesh', 300)])
    const r = run('add_entries', { entries: [{ name: 'Ramesh', amount: 340, direction: 'credit', items: ['do kilo chawal', 'ek Maggi'], due_weekday: 'mon' }] },
      'Ramesh ko do kilo chawal ek Maggi 340 udhaar Somvaar tak')
    expect(r.ops[0]).toMatchObject({ op: 'entry', paise: 34000, note: 'do kilo chawal, ek Maggi' })
    const due = (r.ops[0] as { due?: string }).due!
    expect(new Date(`${due}T00:00:00Z`).getUTCDay()).toBe(1)
    expect(due > today).toBe(true)
    expect(r.parts.join(' ')).toContain(S.dueNoted(Number(due.slice(8))))
    // the model says a due date nobody said: not saved
    const s = setup([cust('r', 'Ramesh', 300)])
    const q = s.run('add_entries', { entries: [{ name: 'Ramesh', amount: 340, direction: 'credit', due_offset: 7 }] }, 'Ramesh ko 340 udhaar')
    expect((q.ops[0] as { due?: string }).due).toBeUndefined()
  })

  it('a sentence with "tak" or "naya" never takes the instant path', () => {
    const { core } = setup([cust('r', 'Ramesh', 300)])
    const plain = (t: string) => { const i = parseFast(t); return i.type === 'entries' && core.isPlainEntry(i, t) }
    expect(plain('Ramesh ko 200 udhaar')).toBe(true)
    expect(plain('Ramesh ko 200 udhaar Somvaar tak')).toBe(false)
    expect(plain('naya Ramesh ko 200 udhaar')).toBe(false)
    const s = setup([cust('g', 'Gupta', 300, { kind: 'supplier' })])
    const i = parseFast('Gupta ko 200 udhaar')
    expect(i.type === 'entries' && s.core.isPlainEntry(i, 'Gupta ko 200 udhaar')).toBe(false)
  })
})

describe('suppliers', () => {
  it('a new supplier is read back, opened as a supplier, and spoken the other way round', () => {
    const { core, run, answer } = setup([cust('r', 'Ramesh', 300)])
    const r = run('add_entries', { entries: [{ name: 'Gupta', amount: 5000, direction: 'credit', party: 'supplier' }] }, 'Gupta ji ko 5000 dene hain')
    expect(r.ops).toEqual([])
    expect(core.pending?.kind).toBe('confirm')
    const y = answer('haan')!
    expect(y.ops[0]).toMatchObject({ op: 'add_customer', name: 'Gupta', kind: 'supplier' })
    expect(y.parts.join(' ')).toContain(S.supplierSaved('Gupta', 5000, 'credit', 5000))
  })

  it('suppliers never get reminders or statements, never appear in dues', () => {
    const { run } = setup([cust('g', 'Gupta', 3000, { kind: 'supplier', remindersOptIn: true, adult: true, phone: '9876543210' }), cust('r', 'Ramesh', 100)])
    expect(run('send_reminder', { name: 'Gupta' }, 'Gupta ko yaad dilao').parts).toEqual([S.noSupplierReminder('Gupta')])
    expect(run('send_statement', { name: 'Gupta' }, 'Gupta ko statement bhejo').parts).toEqual([S.noSupplierReminder('Gupta')])
    expect(run('show_dues', {}, 'kiska baaki hai').parts).toEqual([R.showDues(1, 100)])
    expect(run('query_balance', { name: 'Gupta' }, 'Gupta ka kitna').parts).toEqual([S.supplierBalance('Gupta', 3000)])
  })
})

describe('instalment plans', () => {
  it('set_plan is read back with the parts; the amount and parts must have been said', () => {
    const { core, run, answer } = setup([cust('r', 'Ramesh', 3000)])
    const r = run('set_plan', { name: 'Ramesh', total: 3000, parts: 3, every: 'week' }, 'Ramesh ka 3000 teen hafte mein')
    expect(r.ops).toEqual([])
    expect(r.parts).toEqual([S.planAsk('Ramesh', 3000, 3, 1000, 7)])
    const y = answer('haan')!
    expect(y.ops).toEqual([{ op: 'set_plan', cid: 'r', pid: expect.any(String), totalPaise: 300000, parts: 3, everyDays: 7, startOffset: 7 }])
    expect(y.parts).toEqual([S.planSet('Ramesh', 1000, 7)])
    expect(core.snap.customers[0].plan).toMatchObject({ parts: 3, nextPaise: 100000, nextDay: day(7) })
    // parts nobody said
    expect(run('set_plan', { name: 'Ramesh', parts: 6 }, 'Ramesh ka plan bana do').parts).toEqual([R.didNotCatch()])
    // "har hafte 500": parts from the instalment
    const s = setup([cust('r', 'Ramesh', 3000)])
    expect(s.run('set_plan', { name: 'Ramesh', part_amount: 500, every: 'week' }, 'Ramesh har hafte 500 dega').parts).toEqual([S.planAsk('Ramesh', 3000, 6, 500, 7)])
  })

  it('cancel_plan asks first; with no plan it says so', () => {
    const { run, answer } = setup([cust('r', 'Ramesh', 3000, { plan: { pid: 'p1', totalPaise: 300000, parts: 3, everyDays: 7, paidParts: 0, behind: false } }), cust('s', 'Suresh', 10)])
    expect(run('cancel_plan', { name: 'Ramesh' }, 'Ramesh ka plan band karo').parts).toEqual([S.planCancelAsk('Ramesh')])
    expect(answer('haan')!.ops).toEqual([{ op: 'cancel_plan', cid: 'r', pid: 'p1' }])
    expect(run('cancel_plan', { name: 'Suresh' }, 'Suresh ka plan band karo').parts).toEqual([S.noPlan('Suresh')])
  })
})

describe('galla', () => {
  it('add_cash writes a cash row with no customer; the amount must have been said', () => {
    const { core, run } = setup([cust('r', 'Ramesh', 300)])
    const r = run('add_cash', { amount: 800, category: 'bills' }, 'bijli 800')
    expect(r.ops).toEqual([{ op: 'cash', eid: 'id1', paise: 80000, dir: 'out', category: 'bills', dayOffset: 0 }])
    expect(r.parts).toEqual([S.cashSaved(800, 'out', 'bills')])
    expect(core.snap.customers[0].balancePaise).toBe(30000)
    expect(run('add_cash', { amount: 900, category: 'bills' }, 'bijli 800').ops).toEqual([])
    // "other" needs the direction said
    expect(run('add_cash', { amount: 2000, category: 'other' }, '2000 rakh do').ops).toEqual([])
    expect(run('add_cash', { amount: 2000, dir: 'in', category: 'other' }, 'galle mein 2000 daale').ops).toHaveLength(1)
  })

  it('a customer named in the sentence: the cash row is only read back', () => {
    const { core, run } = setup([cust('r', 'Ramesh', 300)])
    const r = run('add_cash', { amount: 500, dir: 'in', category: 'other' }, 'Ramesh se 500 aaye')
    expect(r.ops).toEqual([])
    expect(core.pending?.kind).toBe('modify')
  })
})

describe('customers with the same name', () => {
  const twins = () => setup([
    cust('a', 'Ramesh', 300), cust('b', 'Ramesh', 1200, { tag: 'doodhwala' }), cust('c', 'Ramesh', 50), cust('d', 'Ramesh', 70, { phone: '9876543210' }),
  ])

  it('which lists every twin by a unique label; options carry the cid', () => {
    const { core, run } = twins()
    run('add_entries', { entries: [{ name: 'Ramesh', amount: 100, direction: 'credit' }] }, 'Ramesh ko 100 udhaar')
    const v = core.pendingView()!
    expect(v.kind).toBe('which')
    expect(v.choices).toEqual([
      { id: 'a', label: 'Ramesh 1' }, { id: 'b', label: 'Ramesh · doodhwala' }, { id: 'c', label: 'Ramesh 2' }, { id: 'd', label: 'Ramesh · …3210' },
    ])
  })

  it('answered by a tapped cid, a nickname, or "teesra", on the fast path', () => {
    for (const [said, src, cid] of [['c', 'tap', 'c'], ['doodhwale wala', 'voice', 'b'], ['teesra wala', 'voice', 'c']] as const) {
      const { core, run, answer } = twins()
      run('add_entries', { entries: [{ name: 'Ramesh', amount: 100, direction: 'credit' }] }, 'Ramesh ko 100 udhaar')
      core.turnSrc = src
      expect(core.canAnswerFast(said, parseFast(said)), said).toBe(true)
      const r = answer(said, src)!
      expect(r.ops.find((o) => o.op === 'entry'), said).toMatchObject({ cid })
    }
  })

  it('a nickname said with the name picks that customer at once', () => {
    const { run } = twins()
    const r = run('add_entries', { entries: [{ name: 'doodhwala Ramesh', amount: 100, direction: 'credit' }] }, 'doodhwala Ramesh ko 100 udhaar')
    expect(r.ops[0]).toMatchObject({ op: 'entry', cid: 'b' })
    // the agent's list form
    const s = twins()
    expect(s.run('add_entries', { entries: [{ name: 'Ramesh (doodhwala)', amount: 100, direction: 'credit' }] }, 'doodhwala Ramesh ko 100 udhaar').ops[0]).toMatchObject({ cid: 'b' })
    expect(s.core.customerList()).toEqual(['Ramesh 1', 'Ramesh (doodhwala)', 'Ramesh 2', 'Ramesh · …3210'])
  })

  it('"naya Ramesh" opens a second Ramesh, then asks once for a nickname', () => {
    const { core, run, answer } = setup([cust('a', 'Ramesh', 300)])
    const r = run('add_entries', { entries: [{ name: 'Ramesh', amount: 200, direction: 'credit', new_customer: true }] }, 'naya Ramesh ko 200 udhaar')
    expect(r.ops).toEqual([])
    expect(core.pendingView()).toMatchObject({ kind: 'confirm', newCustomer: true })
    const y = answer('haan')!
    expect(y.ops.map((o) => o.op)).toEqual(['add_customer', 'entry'])
    const cid = (y.ops[0] as { cid: string }).cid
    expect(y.parts[y.parts.length - 1]).toBe(S.nicknameAsk('Ramesh'))
    expect(core.pendingView()).toMatchObject({ kind: 'nickname', cid, twins: [{ cid: 'a', label: 'Ramesh 1' }, { cid, label: 'Ramesh 2' }] })
    const t = answer('doodhwala')!
    expect(t.ops).toEqual([{ op: 'set_tag', cid, tag: 'Doodhwala' }])
    expect(core.pending).toBeNull()
    // without "naya" the same sentence goes to the existing Ramesh
    const s = setup([cust('a', 'Ramesh', 300)])
    expect(s.run('add_entries', { entries: [{ name: 'Ramesh', amount: 200, direction: 'credit', new_customer: true }] }, 'Ramesh ko 200 udhaar').ops[0]).toMatchObject({ cid: 'a' })
  })

  it('the nickname question can be skipped', () => {
    const { core, run, answer } = setup([cust('a', 'Ramesh', 300)])
    run('add_customer', { name: 'Ramesh' }, 'doosra Ramesh ka khata kholo')
    const y = answer('haan')!
    expect(y.parts).toEqual([R.customerAdded('Ramesh'), S.nicknameAsk('Ramesh')])
    expect(core.pending?.kind).toBe('nickname')
    expect(core.canAnswerFast('chhodo', parseFast('chhodo'))).toBe(true)
    const n = answer('chhodo')!
    expect(n.ops).toEqual([])
    expect(n.parts).toEqual([S.tagSkipped('Ramesh 2')])
  })

  it('set_tag names a customer; the nickname must have been said', () => {
    const { run } = setup([cust('a', 'Ramesh', 300)])
    expect(run('set_tag', { name: 'Ramesh', tag: 'doodhwala' }, 'Ramesh ko doodhwala bolo').ops).toEqual([{ op: 'set_tag', cid: 'a', tag: 'Doodhwala' }])
    expect(run('set_tag', { name: 'Ramesh', tag: 'Gali 3' }, 'Ramesh ko doodhwala bolo').ops).toEqual([])
  })
})

describe('sound-alikes', () => {
  it('Rakesh with only Ramesh: Ramesh, or a new Rakesh with the same entry', () => {
    const mk = () => setup([cust('a', 'Ramesh', 300)])
    let s = mk()
    s.run('add_entries', { entries: [{ name: 'Rakesh', amount: 200, direction: 'credit' }] }, 'Rakesh ko 200 udhaar')
    expect(s.core.pendingView()).toMatchObject({
      kind: 'soundalike', name: 'Ramesh', newName: 'Rakesh', paise: 20000, choices: [{ id: 'a', label: 'Ramesh' }, { id: 'new', label: 'Rakesh' }],
    })
    let r = s.answer('new', 'tap')!
    expect(r.ops).toEqual([expect.objectContaining({ op: 'add_customer', name: 'Rakesh' }), expect.objectContaining({ op: 'entry', paise: 20000 })])
    s = mk()
    s.run('add_entries', { entries: [{ name: 'Rakesh', amount: 200, direction: 'credit' }] }, 'Rakesh ko 200 udhaar')
    r = s.answer('haan')!
    expect(r.ops).toEqual([expect.objectContaining({ op: 'entry', cid: 'a', paise: 20000 })])
    s = mk()
    s.run('add_entries', { entries: [{ name: 'Rakesh', amount: 200, direction: 'credit' }] }, 'Rakesh ko 200 udhaar')
    expect(s.core.canAnswerFast('naya', parseFast('naya'))).toBe(true)
    expect(s.answer('naya wala')!.ops[0]).toMatchObject({ op: 'add_customer', name: 'Rakesh' })
  })

  it('Mahesh is too far from Ramesh: a new account, read back; रमेश is Ramesh', () => {
    let s = setup([cust('a', 'Ramesh', 300)])
    s.run('add_entries', { entries: [{ name: 'Mahesh', amount: 200, direction: 'credit' }] }, 'Mahesh ko 200 udhaar')
    expect(s.core.pendingView()).toMatchObject({ kind: 'confirm', name: 'Mahesh', newCustomer: true })
    s = setup([cust('a', 'Ramesh', 300)])
    const r = s.run('add_entries', { entries: [{ name: 'रमेश', amount: 200, direction: 'credit' }] }, 'रमेश को 200 उधार')
    expect(r.ops[0]).toMatchObject({ op: 'entry', cid: 'a' })
  })
})
