/**
 * The phone's ledger store: ciphertext only at rest, tamper evident, erasable per customer,
 * and idempotent when the same ops arrive twice.
 */
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
  it('rename, set_phone and merge ops from the agent are applied', async () => {
    const s = await createStore(memoryPersistence())
    await s.applyOps([cust('c1', 'Ramesh'), cust('c2', 'Rmesh'), entry('e1', 'c1', 10000, 'credit'), entry('e2', 'c2', 5000, 'credit'),
      { op: 'rename_customer', cid: 'c1', name: 'Ramesh Kumar' }, { op: 'set_phone', cid: 'c1', phone: '9845012345' },
      { op: 'merge_customers', from: 'c2', into: 'c1' }])
    const snap = s.snapshot()
    expect(snap.customers).toHaveLength(1)
    expect(snap.customers[0]).toMatchObject({ cid: 'c1', name: 'Ramesh Kumar', phone: '9845012345', aliases: ['Rmesh'], balancePaise: 15000 })
    expect(snap.entries.every((e) => e.cid === 'c1')).toBe(true)
  })

  it('server ops give the right balances, totals and last entry (promise, amend, void)', async () => {
    const s = await createStore(memoryPersistence())
    await s.applyOps([cust('c1', 'Ramesh'), entry('e1', 'c1', 50000, 'credit'), entry('e2', 'c1', 20000, 'payment'),
      entry('e3', 'c1', 90000, 'payment', true), { op: 'amend', eid: 'e1', paise: 60000 }, entry('e4', 'c1', 1000, 'credit')])
    expect(balance(s.state, 'c1')).toBe(41000)
    expect(s.snapshot().today).toEqual({ creditPaise: 61000, paymentPaise: 20000, entries: 3 })
    await s.applyOps([{ op: 'void', eid: 'e4', reason: 'galat' }])
    expect(balance(s.state, 'c1')).toBe(40000)
    expect(s.snapshot().last?.eid).not.toBe('e4')
  })

  it('the snapshot carries every live entry and the phone', async () => {
    const s = await createStore(memoryPersistence())
    const ops: LedgerOp[] = [cust('c1', 'Ramesh')]
    for (let i = 1; i <= 26; i++) ops.push(entry(`e${i}`, 'c1', i * 100, 'credit'))
    await s.applyOps(ops)
    await s.applyOps([{ op: 'void', eid: 'e26', reason: 'galat' }])
    await s.setConsent('c1', { remindersOptIn: true, adult: true, phone: '9876543210' })
    const snap = s.snapshot()
    expect(snap.entries.length).toBe(25)
    expect(snap.entries[0].eid).toBe('e25')
    expect(snap.entries[24].eid).toBe('e1')
    expect(snap.entries.some((e) => e.eid === 'e26')).toBe(false)
    expect(snap.customers[0].phone).toBe('9876543210')
  })

  it('a batch delivered twice (re-sent or replayed) is written once', async () => {
    const s = await createStore(memoryPersistence())
    const batch = [cust('c1', 'Suleman'), entry('e1', 'c1', 30000, 'payment')]
    await s.applyOps(batch)
    await s.applyOps(batch)
    expect([s.state.customers.size, s.state.entries.size, balance(s.state, 'c1')]).toEqual([1, 1, -30000])
  })

  it('stores ciphertext only, and survives a restart with identical state', async () => {
    const p = memoryPersistence()
    const a = await createStore(p)
    await a.applyOps([cust('c1', 'Ramesh Kumar'), entry('e1', 'c1', 123456, 'credit')])
    await a.setConsent('c1', { remindersOptIn: true, adult: true, phone: '99' })
    const raw = JSON.stringify(p.records)
    expect(raw).not.toContain('Ramesh')
    expect(raw).not.toContain('123456')
    const b = await createStore(p)
    expect(b.state.customers).toEqual(a.state.customers)
    expect(b.state.entries).toEqual(a.state.entries)
  })

  it('detects a tampered stored record', async () => {
    const p = memoryPersistence()
    const s = await createStore(p)
    await s.applyOps([cust('c1', 'A'), entry('e1', 'c1', 100, 'credit'), entry('e2', 'c1', 100, 'credit')])
    p.records[1].ct = p.records[2].ct
    expect(await (await createStore(p)).verify()).toMatchObject({ ok: false, brokenAt: 1 })
  })

  it('the chain stays contiguous under concurrent writes and across two tabs', async () => {
    const p = memoryPersistence()
    const s = await createStore(p)
    await Promise.all(Array.from({ length: 12 }, (_, i) => s.applyOps([cust(`c${i}`, `N${i}`), entry(`e${i}`, `c${i}`, 100 + i, 'credit')])))
    expect(p.records.map((r) => r.seq)).toEqual(Array.from({ length: 24 }, (_, i) => i))
    expect(await s.verify()).toEqual({ ok: true, records: 24 })

    const base = memoryPersistence()
    const shared: typeof base = { ...base, tailRecord: async () => base.records[base.records.length - 1] }
    const a = await createStore(shared)
    const b = await createStore(shared)
    await a.applyOps([cust('c1', 'Ramesh')])
    await b.applyOps([cust('c2', 'Sita')]) // b's in-memory chain is stale
    await a.applyOps([entry('e1', 'c1', 100, 'credit')])
    expect((await createStore(shared)).state.customers.size).toBe(2)
    expect((await a.verify()).ok).toBe(true)
  })

  it('forgetting a customer erases them (also after restart) and leaves the rest intact', async () => {
    const p = memoryPersistence()
    const s = await createStore(p)
    await s.applyOps([cust('c1', 'Ramesh'), cust('c2', 'Sita'), entry('e1', 'c1', 500, 'credit'), entry('e2', 'c2', 700, 'credit')])
    await s.forgetCustomer('c1')
    const again = await createStore(p)
    expect(again.state.customers.has('c1')).toBe(false)
    expect(again.state.entries.has('e1')).toBe(false)
    expect(balance(again.state, 'c2')).toBe(700)
    expect((await again.verify()).ok).toBe(true)
  })

  it('delete-all removes records and keys, keeps the language and shop name', async () => {
    const p = memoryPersistence()
    const s = await createStore(p)
    await s.updateSettings({ lang: 'hi', shopName: 'Gupta' })
    await s.applyOps([cust('c1', 'A'), entry('e1', 'c1', 100, 'credit')])
    await s.applyOps([{ op: 'delete_all' }])
    expect([s.state.customers.size, p.records.length]).toEqual([0, 0])
    expect(await p.keys.get('c1')).toBeUndefined()
    expect((await createStore(p)).settings).toMatchObject({ lang: 'hi', shopName: 'Gupta' })
  })
})

describe('backup records export/import', () => {
  it('restores the same ledger on a fresh phone with new keys', async () => {
    const a = await createStore(memoryPersistence())
    await a.applyOps([cust('c1', 'Ramesh'), entry('e1', 'c1', 34000, 'credit'), { op: 'amend', eid: 'e1', paise: 43000 }])
    const b = await createStore(memoryPersistence())
    await b.importRecords(JSON.parse(JSON.stringify(await a.exportRecords())))
    expect(b.snapshot().customers[0]).toMatchObject({ name: 'Ramesh', balancePaise: 43000 })
    expect((await b.verify()).ok).toBe(true)
  })

  it('an invalid import is refused and leaves existing data untouched', async () => {
    const p = memoryPersistence()
    const s = await createStore(p)
    await s.applyOps([cust('c1', 'Ramesh'), entry('e1', 'c1', 5000, 'credit')])
    const good = JSON.parse(JSON.stringify(await s.exportRecords())) as unknown[]
    for (const bad of [{ not: 'array' }, [...good, { nope: 1 }], [...good, null], [{ ev: 'str', ts: 1 }]]) {
      await expect(s.importRecords(bad as unknown[])).rejects.toThrow('bad backup')
      expect([balance(s.state, 'c1'), p.records.length]).toEqual([5000, 2])
    }
  })
})
