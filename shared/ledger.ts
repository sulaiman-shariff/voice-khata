/**
 * Khata ledger: an append-only event log reduced to balances.
 *
 * Nothing is ever edited in place. A correction is an `entry_amended` event, an undo is
 * `entry_voided`, a customer's tap on the confirmation link is `confirmation`. Money is
 * integer paise. Promises ("kal de dega") are tracked but never move the balance.
 * No scoring or ranking of customers anywhere: record and report only.
 */

export type Direction = 'credit' | 'payment'

export type LedgerEvent =
  | { type: 'customer_added'; cid: string; name: string; aliases: string[]; householdId?: string }
  | { type: 'alias_added'; cid: string; alias: string }
  | { type: 'household_set'; cid: string; householdId: string | null }
  | {
    type: 'entry'
    eid: string
    cid: string
    paise: number
    direction: Direction
    day: string // YYYY-MM-DD
    promise?: boolean // future payment; not posted to the balance
    note?: string
    source?: { transcript: string; confidence: 'high' | 'low'; reasons: string[]; lang: string; snrDb?: number; path?: 'fast' | 'llm' }
  }
  | { type: 'entry_amended'; eid: string; paise?: number; direction?: Direction; cid?: string; day?: string }
  | { type: 'entry_voided'; eid: string; reason: string }
  | { type: 'confirmation'; eid: string; status: 'confirmed' | 'disputed' }
  | { type: 'consent'; cid: string; remindersOptIn: boolean; adult: boolean; phone?: string }
  | { type: 'customer_renamed'; cid: string; name: string }
  /** keyed by the surviving account (`cid`); `from`'s entries move to it and `from` is removed */
  | { type: 'customers_merged'; cid: string; from: string }
  | { type: 'phone_set'; cid: string; phone: string }

export interface Customer {
  cid: string
  name: string
  aliases: string[]
  householdId: string | null
  remindersOptIn: boolean
  adult: boolean
  phone?: string
}

export interface Entry {
  eid: string
  cid: string
  paise: number
  direction: Direction
  day: string
  promise: boolean
  note?: string
  voided: boolean
  amended: boolean
  status: 'unconfirmed' | 'confirmed' | 'disputed'
  ts: number
  source?: Extract<LedgerEvent, { type: 'entry' }>['source']
}

export interface LedgerState {
  customers: Map<string, Customer>
  entries: Map<string, Entry>
  order: string[] // entry ids in insertion order
}

export const emptyLedger = (): LedgerState => ({ customers: new Map(), entries: new Map(), order: [] })

/** Apply one event. Unknown references are ignored (events can arrive after a shred). */
export function apply(s: LedgerState, ev: LedgerEvent, ts = Date.now()): LedgerState {
  switch (ev.type) {
    case 'customer_added':
      s.customers.set(ev.cid, {
        cid: ev.cid, name: ev.name, aliases: [...ev.aliases], householdId: ev.householdId ?? null,
        remindersOptIn: false, adult: false,
      })
      break
    case 'alias_added': {
      const c = s.customers.get(ev.cid)
      if (c && !c.aliases.includes(ev.alias)) c.aliases.push(ev.alias)
      break
    }
    case 'household_set': {
      const c = s.customers.get(ev.cid)
      if (c) c.householdId = ev.householdId
      break
    }
    case 'consent': {
      const c = s.customers.get(ev.cid)
      if (c) Object.assign(c, { remindersOptIn: ev.remindersOptIn, adult: ev.adult, phone: ev.phone })
      break
    }
    case 'customer_renamed': {
      const c = s.customers.get(ev.cid)
      if (c) c.name = ev.name
      break
    }
    case 'customers_merged': {
      const into = s.customers.get(ev.cid)
      const from = s.customers.get(ev.from)
      if (!into || !from || ev.cid === ev.from) break
      for (const n of [from.name, ...from.aliases]) if (n !== into.name && !into.aliases.includes(n)) into.aliases.push(n)
      for (const e of s.entries.values()) if (e.cid === ev.from) e.cid = ev.cid
      s.customers.delete(ev.from)
      break
    }
    case 'phone_set': {
      const c = s.customers.get(ev.cid)
      if (c) c.phone = ev.phone
      break
    }
    case 'entry':
      s.entries.set(ev.eid, {
        eid: ev.eid, cid: ev.cid, paise: ev.paise, direction: ev.direction, day: ev.day,
        promise: !!ev.promise, note: ev.note, voided: false, amended: false, status: 'unconfirmed', ts,
        source: ev.source,
      })
      s.order.push(ev.eid)
      break
    case 'entry_amended': {
      const e = s.entries.get(ev.eid)
      if (!e) break
      if (ev.paise !== undefined) e.paise = ev.paise
      if (ev.direction) e.direction = ev.direction
      if (ev.cid) e.cid = ev.cid
      if (ev.day) e.day = ev.day
      e.amended = true
      e.status = 'unconfirmed' // a changed entry needs fresh confirmation
      break
    }
    case 'entry_voided': {
      const e = s.entries.get(ev.eid)
      if (e) e.voided = true
      break
    }
    case 'confirmation': {
      const e = s.entries.get(ev.eid)
      if (e) e.status = ev.status
      break
    }
  }
  return s
}

export function reduce(events: { ev: LedgerEvent; ts: number }[]): LedgerState {
  const s = emptyLedger()
  for (const { ev, ts } of events) apply(s, ev, ts)
  return s
}

const live = (e: Entry) => !e.voided && !e.promise

/** Amount the customer owes the shop, in paise (negative = shop owes / advance). */
export function balance(s: LedgerState, cid: string): number {
  let b = 0
  for (const e of s.entries.values()) {
    if (e.cid !== cid || !live(e)) continue
    b += e.direction === 'credit' ? e.paise : -e.paise
  }
  return b
}

/** Household balance: every member's entries together. */
export function householdBalance(s: LedgerState, householdId: string): number {
  let b = 0
  for (const c of s.customers.values()) if (c.householdId === householdId) b += balance(s, c.cid)
  return b
}

export interface DaySummary {
  day: string
  creditPaise: number
  paymentPaise: number
  entries: number
  customers: number
}

export function daySummary(s: LedgerState, day: string): DaySummary {
  let creditPaise = 0
  let paymentPaise = 0
  let entries = 0
  const who = new Set<string>()
  for (const e of s.entries.values()) {
    if (e.day !== day || !live(e)) continue
    if (e.direction === 'credit') creditPaise += e.paise
    else paymentPaise += e.paise
    entries++
    who.add(e.cid)
  }
  return { day, creditPaise, paymentPaise, entries, customers: who.size }
}

export function monthSummary(s: LedgerState, yyyymm: string): DaySummary {
  const m = { day: yyyymm, creditPaise: 0, paymentPaise: 0, entries: 0, customers: 0 }
  const who = new Set<string>()
  for (const e of s.entries.values()) {
    if (!e.day.startsWith(yyyymm) || !live(e)) continue
    if (e.direction === 'credit') m.creditPaise += e.paise
    else m.paymentPaise += e.paise
    m.entries++
    who.add(e.cid)
  }
  m.customers = who.size
  return m
}

/** Customers who owe money, largest first. Order is by amount only: no judgement of the person. */
export function dues(s: LedgerState): { cid: string; paise: number }[] {
  return [...s.customers.keys()]
    .map((cid) => ({ cid, paise: balance(s, cid) }))
    .filter((d) => d.paise > 0)
    .sort((a, b) => b.paise - a.paise)
}

/** Open promises ("kal de dega") with their due day. */
export function promises(s: LedgerState): Entry[] {
  return [...s.entries.values()].filter((e) => e.promise && !e.voided).sort((a, b) => a.day.localeCompare(b.day))
}

/** The most recent live entry (target of "nahi, 430" / "undo"). */
export function lastEntry(s: LedgerState): Entry | undefined {
  for (let i = s.order.length - 1; i >= 0; i--) {
    const e = s.entries.get(s.order[i])
    if (e && !e.voided) return e
  }
  return undefined
}

/** Median live amount for a customer (for the "is this amount unusual?" check). */
export function typicalAmount(s: LedgerState, cid: string): number | null {
  const xs = [...s.entries.values()].filter((e) => e.cid === cid && live(e)).map((e) => e.paise).sort((a, b) => a - b)
  if (xs.length < 3) return null
  return xs[Math.floor(xs.length / 2)]
}

/** ISO day for an offset from a reference date, in the shop's local time. */
export function dayFromOffset(offset: number, now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export const toPaise = (rupees: number) => Math.round(rupees * 100)
export const toRupees = (paise: number) => paise / 100
