import { describe, expect, it } from 'vitest'
import { balance } from '../../shared/ledger.js'
import type { LedgerOp } from '../../shared/protocol.js'
import { createStore, memoryPersistence } from './store.js'

const src = { transcript: 't', confidence: 'high' as const, reasons: [], lang: 'hi', path: 'fast' as const }
const cust = (cid: string, name: string): LedgerOp => ({ op: 'add_customer', cid, name })
const entry = (eid: string, cid: string, paise: number, direction: 'credit' | 'payment', promise = false): LedgerOp => ({
  op: 'entry', eid, cid, paise, direction, dayOffset: 0, promise, source: src,
})

describe('store', () => {
  it('computes balances and snapshot from ops', async () => {
    const s = await createStore(memoryPersistence())
    await s.applyOps([cust('c1', 'Ramesh'), entry('e1', 'c1', 50000, 'credit'), entry('e2', 'c1', 20000, 'payment')])
    expect(balance(s.state, 'c1')).toBe(30000)
    await s.applyOps([entry('e3', 'c1', 90000, 'payment', true)])
    expect(balance(s.state, 'c1')).toBe(30000) // promise does not move balance
    await s.applyOps([{ op: 'amend', eid: 'e1', paise: 60000 }])
    expect(balance(s.state, 'c1')).toBe(40000)
    await s.applyOps([cust('c2', 'Sita'), entry('e4', 'c2', 1000, 'credit')])
    const snap = s.snapshot()
    expect(snap.shopName).toBe('Meri Dukaan')
    expect(snap.customers.find((c) => c.cid === 'c1')?.balancePaise).toBe(40000)
    expect(snap.customers.find((c) => c.cid === 'c2')?.balancePaise).toBe(1000)
    expect(snap.today).toEqual({ creditPaise: 61000, paymentPaise: 20000, entries: 3 })
    expect(snap.month.entries).toBe(3)
    expect(snap.last?.eid).toBe('e4')
  })

  it('snapshot.last follows void and void removes from balance', async () => {
    const s = await createStore(memoryPersistence())
    await s.applyOps([cust('c1', 'A'), entry('e1', 'c1', 100, 'credit'), entry('e2', 'c1', 200, 'credit')])
    expect(s.snapshot().last?.eid).toBe('e2')
    await s.applyOps([{ op: 'void', eid: 'e2', reason: 'galat' }])
    expect(s.snapshot().last?.eid).toBe('e1')
    expect(balance(s.state, 'c1')).toBe(100)
    await s.voidEntry('e1', 'x')
    expect(s.snapshot().last).toBeNull()
  })

  it('persists: a second store over the same persistence has identical state', async () => {
    const p = memoryPersistence()
    const a = await createStore(p)
    await a.applyOps([cust('c1', 'Ramesh'), { op: 'add_alias', cid: 'c1', alias: 'Rama' }, entry('e1', 'c1', 500, 'credit')])
    await a.setConsent('c1', { remindersOptIn: true, adult: true, phone: '99' })
    await a.setConfirmation('e1', 'confirmed')
    await a.updateSettings({ lang: 'hi', shopName: 'Gupta Store' })
    const b = await createStore(p)
    expect(b.state.customers).toEqual(a.state.customers)
    expect(b.state.entries).toEqual(a.state.entries)
    expect(b.state.order).toEqual(a.state.order)
    expect(b.state.customers.get('c1')?.aliases).toEqual(['Rama'])
    expect(b.state.entries.get('e1')?.status).toBe('confirmed')
    expect(b.settings).toEqual(a.settings)
    expect(b.settings.shopName).toBe('Gupta Store')
  })

  it('keeps the chain contiguous and valid under concurrent applyOps', async () => {
    const p = memoryPersistence()
    const s = await createStore(p)
    const ps: Promise<void>[] = []
    for (let i = 0; i < 12; i++) ps.push(s.applyOps([cust(`c${i}`, `N${i}`), entry(`e${i}`, `c${i}`, 100 + i, 'credit')]))
    await Promise.all(ps)
    expect(p.records.map((r) => r.seq)).toEqual(Array.from({ length: 24 }, (_, i) => i))
    expect(await s.verify()).toEqual({ ok: true, records: 24 })
    expect(s.state.customers.size).toBe(12)
  })

  it('detects tampering with a stored record', async () => {
    const p = memoryPersistence()
    const s = await createStore(p)
    await s.applyOps([cust('c1', 'A'), entry('e1', 'c1', 100, 'credit'), entry('e2', 'c1', 100, 'credit')])
    p.records[1].ct = p.records[2].ct
    const v = await s.verify()
    // the store holds its own copy; verify against fresh persistence state
    const s2 = await createStore(p)
    const v2 = await s2.verify()
    expect(v.ok).toBe(true)
    expect(v2.ok).toBe(false)
    expect(v2.brokenAt).toBe(1)
  })

  it('forgetCustomer removes only that customer and the chain still verifies', async () => {
    const p = memoryPersistence()
    const s = await createStore(p)
    await s.applyOps([cust('c1', 'Ramesh'), cust('c2', 'Sita'), entry('e1', 'c1', 500, 'credit'), entry('e2', 'c2', 700, 'credit')])
    await s.applyOps([{ op: 'void', eid: 'e1', reason: 'r' }])
    await s.forgetCustomer('c1')
    expect(s.state.customers.has('c1')).toBe(false)
    expect(s.state.entries.has('e1')).toBe(false)
    expect(s.state.customers.get('c2')?.name).toBe('Sita')
    expect(balance(s.state, 'c2')).toBe(700)
    expect(await s.verify()).toEqual({ ok: true, records: 5 })
    const again = await createStore(p)
    expect(again.state.customers.has('c1')).toBe(false)
    expect(again.state.customers.has('c2')).toBe(true)
  })

  it('deleteAll empties records, keys and state but keeps language and shop name', async () => {
    const p = memoryPersistence()
    const s = await createStore(p)
    await s.updateSettings({ lang: 'hi', shopName: 'Gupta', firstRunDone: true })
    await s.applyOps([cust('c1', 'A'), entry('e1', 'c1', 100, 'credit')])
    await s.applyOps([{ op: 'delete_all' }])
    expect(s.state.customers.size).toBe(0)
    expect(p.records.length).toBe(0)
    expect(await p.keys.get('c1')).toBeUndefined()
    expect(await s.verify()).toEqual({ ok: true, records: 0 })
    await s.applyOps([cust('c9', 'B')])
    expect(p.records[0].seq).toBe(0)
    await s.deleteAll()
    expect(s.settings.lang).toBe('hi')
    expect(s.settings.shopName).toBe('Gupta')
    expect(s.settings.firstRunDone).toBe(false)
    expect((await createStore(p)).settings.lang).toBe('hi')
  })

  it('stores ciphertext only', async () => {
    const p = memoryPersistence()
    const s = await createStore(p)
    await s.applyOps([cust('c1', 'Ramesh Kumar'), entry('e1', 'c1', 123456, 'credit')])
    const raw = JSON.stringify(p.records) // what IndexedDB holds
    expect(raw).not.toContain('Ramesh')
    expect(raw).not.toContain('123456')
    const readable = JSON.parse(await s.exportReadable())
    expect(readable.customers[0].name).toBe('Ramesh Kumar')
    expect(readable.entries[0].paise).toBe(123456)
    expect(readable.chain.ok).toBe(true)
  })

  it('notifies subscribers with a new state reference', async () => {
    const s = await createStore(memoryPersistence())
    let n = 0
    const un = s.subscribe(() => n++)
    const before = s.state
    await s.applyOps([cust('c1', 'A')])
    expect(n).toBe(1)
    expect(s.state).not.toBe(before)
    un()
    await s.updateSettings({ showLatency: true })
    expect(n).toBe(1)
  })
})

describe('backup export/import', () => {
  it('restores the same ledger on a fresh phone with new keys', async () => {
    const a = await createStore(memoryPersistence())
    await a.applyOps([
      { op: 'add_customer', cid: 'c1', name: 'Ramesh' },
      { op: 'entry', eid: 'e1', cid: 'c1', paise: 34000, direction: 'credit', dayOffset: 0, promise: false, source: { transcript: 't', confidence: 'high', reasons: [], lang: 'hi-IN', path: 'fast' } },
      { op: 'amend', eid: 'e1', paise: 43000 },
    ])
    const dump = JSON.parse(JSON.stringify(await a.exportRecords()))
    const b = await createStore(memoryPersistence())
    await b.importRecords(dump)
    expect(b.snapshot().customers[0]).toMatchObject({ name: 'Ramesh', balancePaise: 43000 })
    expect((await b.verify()).ok).toBe(true)
    await expect(b.importRecords([{ nope: 1 }])).rejects.toThrow()
  })
})
