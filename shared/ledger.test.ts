import { describe, expect, it } from 'vitest'
import {
  type LedgerEvent, apply, balance, dayFromOffset, daySummary, dues, emptyLedger, householdBalance, lastEntry,
  promises, reduce, toPaise,
} from './ledger.js'
import { type ChainRecord, keyIdFor, memoryKeyStore, open, seal, shred, verifyChain } from './chain.js'

const D = '2026-11-13'
const base: LedgerEvent[] = [
  { type: 'customer_added', cid: 'r', name: 'Ramesh', aliases: [] },
  { type: 'customer_added', cid: 's', name: 'Suresh', aliases: [] },
  { type: 'entry', eid: 'e1', cid: 'r', paise: toPaise(340), direction: 'credit', day: D },
  { type: 'entry', eid: 'e2', cid: 'r', paise: toPaise(200), direction: 'payment', day: '2026-11-12' },
  { type: 'entry', eid: 'e3', cid: 's', paise: toPaise(150.5), direction: 'credit', day: D },
]
const build = (evs: LedgerEvent[]) => reduce(evs.map((ev, i) => ({ ev, ts: i })))

describe('ledger reducer', () => {
  it('balances in paise', () => {
    const s = build(base)
    expect(balance(s, 'r')).toBe(14000)
    expect(balance(s, 's')).toBe(15050)
  })
  it('amend changes amount and resets confirmation', () => {
    const s = build([...base, { type: 'confirmation', eid: 'e1', status: 'confirmed' },
      { type: 'entry_amended', eid: 'e1', paise: toPaise(430) }])
    expect(balance(s, 'r')).toBe(23000)
    expect(s.entries.get('e1')!.status).toBe('unconfirmed')
    expect(s.entries.get('e1')!.amended).toBe(true)
  })
  it('direction flip', () => {
    const s = build([...base, { type: 'entry_amended', eid: 'e2', direction: 'credit' }])
    expect(balance(s, 'r')).toBe(54000)
  })
  it('void removes from balance, lastEntry skips it', () => {
    const s = build([...base, { type: 'entry_voided', eid: 'e3', reason: 'undo' }])
    expect(balance(s, 's')).toBe(0)
    expect(lastEntry(s)!.eid).toBe('e2')
  })
  it('promises do not move the balance', () => {
    const s = build([...base, { type: 'entry', eid: 'p', cid: 'r', paise: 10000, direction: 'payment', day: '2026-11-14', promise: true }])
    expect(balance(s, 'r')).toBe(14000)
    expect(promises(s).map((e) => e.eid)).toEqual(['p'])
  })
  it('household sums members', () => {
    const s = build([...base, { type: 'household_set', cid: 'r', householdId: 'h' }, { type: 'household_set', cid: 's', householdId: 'h' }])
    expect(householdBalance(s, 'h')).toBe(29050)
  })
  it('day summary and dues', () => {
    const s = build(base)
    expect(daySummary(s, D)).toEqual({ day: D, creditPaise: 49050, paymentPaise: 0, entries: 2, customers: 2 })
    expect(dues(s)).toEqual([{ cid: 's', paise: 15050 }, { cid: 'r', paise: 14000 }])
  })
  it('events on unknown ids are ignored', () => {
    const s = emptyLedger()
    apply(s, { type: 'entry_voided', eid: 'nope', reason: 'x' })
    expect(s.entries.size).toBe(0)
  })
  it('dayFromOffset crosses month boundary', () => {
    expect(dayFromOffset(-1, new Date(2026, 10, 1))).toBe('2026-10-31')
    expect(dayFromOffset(1, new Date(2026, 11, 31))).toBe('2027-01-01')
  })
})

async function sealAll(evs: LedgerEvent[], keys = memoryKeyStore()) {
  const owner = new Map<string, string>()
  const recs: ChainRecord[] = []
  for (const ev of evs) {
    if (ev.type === 'entry') owner.set(ev.eid, ev.cid)
    recs.push(await seal(ev, keyIdFor(ev, (e) => owner.get(e)), keys, recs.at(-1), 1000 + recs.length))
  }
  return { recs, keys }
}

describe('hash chain + crypto-shred', () => {
  it('round-trips and verifies', async () => {
    const { recs, keys } = await sealAll(base)
    expect(await verifyChain(recs)).toEqual({ ok: true })
    const evs = await Promise.all(recs.map((r) => open(r, keys)))
    expect(evs).toEqual(base)
  })
  it('ciphertext does not contain plaintext', async () => {
    const { recs } = await sealAll(base)
    const blob = JSON.stringify(recs)
    expect(blob).not.toContain('Ramesh')
    expect(blob).not.toContain('34000')
  })
  it('detects a tampered record', async () => {
    const { recs } = await sealAll(base)
    const bad = recs.map((r) => ({ ...r }))
    bad[2].ct = bad[3].ct
    expect(await verifyChain(bad)).toMatchObject({ ok: false, brokenAt: 2 })
  })
  it('detects a deleted record', async () => {
    const { recs } = await sealAll(base)
    expect((await verifyChain([...recs.slice(0, 2), ...recs.slice(3)])).ok).toBe(false)
  })
  it('detects a rewritten tail even with recomputed hash', async () => {
    const { recs } = await sealAll(base)
    const forged = { ...recs[1], ts: 9999 }
    const rest = [recs[0], forged, ...recs.slice(2)]
    expect((await verifyChain(rest)).ok).toBe(false)
  })
  it('shredding one customer hides only their records; chain still verifies', async () => {
    const { recs, keys } = await sealAll(base)
    await shred('r', keys)
    expect(await verifyChain(recs)).toEqual({ ok: true })
    const evs = await Promise.all(recs.map((r) => open(r, keys)))
    expect(evs.filter(Boolean)).toEqual([base[1], base[4]]) // only Suresh survives
    const s = build(evs.filter((e): e is LedgerEvent => !!e))
    expect(balance(s, 's')).toBe(15050)
    expect(s.customers.has('r')).toBe(false)
  })
  it('amend/void events are sealed under the entry owner key', async () => {
    const evs: LedgerEvent[] = [...base, { type: 'entry_voided', eid: 'e1', reason: 'undo' }]
    const { recs } = await sealAll(evs)
    expect(recs.at(-1)!.keyId).toBe('r')
  })
})
