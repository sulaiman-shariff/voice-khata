/**
 * The ledger the phone keeps: balances from events, and the sealed hash chain that stores them
 * (per-customer keys so one customer can be crypto-shredded).
 */
import { describe, expect, it } from 'vitest'
import {
  type LedgerEvent, apply, balance, dayFromOffset, displayName, daySummary, dues, emptyLedger, householdBalance, lastEntry,
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

describe('balances', () => {
  it('credit adds, payment subtracts, in exact paise', () => {
    const s = build(base)
    expect([balance(s, 'r'), balance(s, 's')]).toEqual([14000, 15050])
    expect(dues(s)).toEqual([{ cid: 's', paise: 15050 }, { cid: 'r', paise: 14000 }])
  })

  it('amend (amount, direction, customer) and void move the balance; a promise does not', () => {
    const s = build([...base,
      { type: 'entry_amended', eid: 'e1', paise: toPaise(430) }, // r: 430 - 200
      { type: 'entry_amended', eid: 'e2', direction: 'credit' }, // r: 430 + 200
      { type: 'entry_voided', eid: 'e3', reason: 'undo' },
      { type: 'entry', eid: 'p', cid: 's', paise: 10000, direction: 'payment', day: '2026-11-14', promise: true },
    ])
    expect([balance(s, 'r'), balance(s, 's')]).toEqual([63000, 0])
    expect(lastEntry(s)!.eid).toBe('p')
  })

  it('"kal" and "parso" cross month and year ends', () => {
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

describe('sealed hash chain', () => {
  it('round-trips, verifies, and holds no plaintext', async () => {
    const { recs, keys } = await sealAll(base)
    expect(await verifyChain(recs)).toEqual({ ok: true })
    expect(await Promise.all(recs.map((r) => open(r, keys)))).toEqual(base)
    const blob = JSON.stringify(recs)
    expect(blob).not.toContain('Ramesh')
    expect(blob).not.toContain('34000')
  })

  it('detects a swapped, deleted or rewritten record', async () => {
    const { recs } = await sealAll(base)
    const swapped = recs.map((r) => ({ ...r }))
    swapped[2].ct = swapped[3].ct
    expect(await verifyChain(swapped)).toMatchObject({ ok: false, brokenAt: 2 })
    expect((await verifyChain([...recs.slice(0, 2), ...recs.slice(3)])).ok).toBe(false)
    expect((await verifyChain([recs[0], { ...recs[1], ts: 9999 }, ...recs.slice(2)])).ok).toBe(false)
  })

  it('shredding a customer makes only their records (entries and later voids) unreadable; the chain still verifies', async () => {
    const { recs, keys } = await sealAll([...base, { type: 'entry_voided', eid: 'e1', reason: 'undo' }])
    await shred('r', keys)
    expect(await verifyChain(recs)).toEqual({ ok: true })
    const evs = await Promise.all(recs.map((r) => open(r, keys)))
    expect(evs.filter(Boolean)).toEqual([base[1], base[4]])
  })
})

describe('displayName', () => {
  const two = (extra: LedgerEvent[] = []) => build([
    { type: 'customer_added', cid: 'a1', name: 'Ramesh', aliases: [] },
    { type: 'customer_added', cid: 'b2', name: 'ramesh', aliases: [] },
    { type: 'customer_added', cid: 'c3', name: 'Suresh', aliases: [] },
    ...extra,
  ])
  it('a unique name is shown as it is', () => {
    expect(displayName(two(), 'c3')).toBe('Suresh')
  })
  it('two customers with one name are told apart by tag, else phone digits, else id', () => {
    const s = two([
      { type: 'consent', cid: 'a1', remindersOptIn: false, adult: true, tag: 'Gali 3' },
      { type: 'consent', cid: 'b2', remindersOptIn: false, adult: true, phone: '98765 43210' },
    ])
    expect(displayName(s, 'a1')).toBe('Ramesh · Gali 3')
    expect(displayName(s, 'b2')).toBe('ramesh · …3210')
    expect(displayName(two(), 'b2')).toBe('ramesh · b2')
  })
})
