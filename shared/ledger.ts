/**
 * Khata ledger: an append-only event log reduced to balances.
 *
 * Nothing is ever edited in place. A correction is an `entry_amended` event, an undo is
 * `entry_voided`, a customer's tap on the confirmation link is `confirmation`. Money is
 * integer paise. Promises ("kal de dega") are tracked but never move the balance.
 * No scoring or ranking of customers anywhere: record and report only.
 */

export type Direction = 'credit' | 'payment'
/**
 * Who the account is with. A supplier's balance runs the other way: a credit means the shop took
 * goods and owes the supplier ("dene hain"), a payment means the shop paid them. balance() keeps
 * one meaning (credit minus payment); owedLabel() turns it into "lena hai" / "dena hai".
 */
export type PartyKind = 'customer' | 'supplier'
/** cashbook categories (galla): the agent picks one, "other" when unsure */
export const CASH_CATEGORIES = ['stock', 'bills', 'rent', 'wages', 'personal', 'other'] as const
export type CashCategory = (typeof CASH_CATEGORIES)[number]

export type LedgerEvent =
  /** `kind` absent = customer (every event written before suppliers existed) */
  | { type: 'customer_added'; cid: string; name: string; aliases: string[]; householdId?: string; kind?: PartyKind }
  /** a customer account turned into a supplier account, or back */
  | { type: 'customer_kind'; cid: string; kind: PartyKind }
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
    /** itemised bill ("do kilo chawal, ek Maggi"), comma-separated */
    note?: string
    /** pay-by date for a credit ("Somvaar tak"), YYYY-MM-DD; absent on older entries */
    due?: string
    source?: { transcript: string; confidence: 'high' | 'low'; reasons: string[]; lang: string; snrDb?: number; path?: 'fast' | 'llm' }
  }
  /** also amends a cash row (same eid space); `due: null` clears the due date */
  | { type: 'entry_amended'; eid: string; paise?: number; direction?: Direction; cid?: string; day?: string; due?: string | null }
  | { type: 'entry_voided'; eid: string; reason: string }
  | { type: 'confirmation'; eid: string; status: 'confirmed' | 'disputed' }
  | { type: 'consent'; cid: string; remindersOptIn: boolean; adult: boolean; phone?: string; tag?: string }
  | { type: 'customer_renamed'; cid: string; name: string }
  /** keyed by the surviving account (`cid`); `from`'s entries move to it and `from` is removed */
  | { type: 'customers_merged'; cid: string; from: string }
  | { type: 'phone_set'; cid: string; phone: string }
  /**
   * Galla (cashbook): money into or out of the shop's cash that is no customer's. No cid, so it is
   * sealed under the shop key. Customer and supplier payments are never written here twice: the
   * cashbook derives them from the entries.
   */
  | { type: 'cash'; eid: string; paise: number; dir: 'in' | 'out'; category: CashCategory; note?: string; day: string }
  /** an instalment plan: schedules collection, never moves the balance. One per customer; a new one replaces it. */
  | { type: 'plan_set'; cid: string; pid: string; totalPaise: number; parts: number; everyDays: number; startDay: string }
  | { type: 'plan_cancelled'; cid: string; pid: string }

export interface Customer {
  cid: string
  name: string
  aliases: string[]
  householdId: string | null
  remindersOptIn: boolean
  adult: boolean
  phone?: string
  /** tells two customers with the same name apart: area, shop, nickname ("Gali 3", "doodhwala") */
  tag?: string
  /** 'customer' unless the account was opened (or turned) as a supplier */
  kind: PartyKind
  /** when the account was opened (ms) */
  since?: number
}

export interface CashEntry {
  eid: string
  paise: number
  dir: 'in' | 'out'
  category: CashCategory
  note?: string
  day: string
  voided: boolean
  ts: number
}

export interface Plan {
  pid: string
  cid: string
  totalPaise: number
  parts: number
  everyDays: number
  /** the first instalment's day */
  startDay: string
  ts: number
}

export interface Entry {
  eid: string
  cid: string
  paise: number
  direction: Direction
  day: string
  promise: boolean
  note?: string
  due?: string
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
  /** galla rows (no customer) */
  cash: Map<string, CashEntry>
  /** the active instalment plan per customer */
  plans: Map<string, Plan>
}

export const emptyLedger = (): LedgerState => ({ customers: new Map(), entries: new Map(), order: [], cash: new Map(), plans: new Map() })

/** Apply one event. Unknown references are ignored (events can arrive after a shred). */
export function apply(s: LedgerState, ev: LedgerEvent, ts = Date.now()): LedgerState {
  switch (ev.type) {
    case 'customer_added':
      s.customers.set(ev.cid, {
        cid: ev.cid, name: ev.name, aliases: [...ev.aliases], householdId: ev.householdId ?? null,
        remindersOptIn: false, adult: false, kind: ev.kind === 'supplier' ? 'supplier' : 'customer', since: ts,
      })
      break
    case 'customer_kind': {
      const c = s.customers.get(ev.cid)
      if (c) c.kind = ev.kind === 'supplier' ? 'supplier' : 'customer'
      break
    }
    case 'cash':
      if (!(ev.paise > 0)) break
      s.cash.set(ev.eid, {
        eid: ev.eid, paise: ev.paise, dir: ev.dir === 'in' ? 'in' : 'out',
        category: (CASH_CATEGORIES as readonly string[]).includes(ev.category) ? ev.category : 'other',
        note: ev.note, day: ev.day, voided: false, ts,
      })
      break
    case 'plan_set':
      if (!s.customers.has(ev.cid) || !(ev.totalPaise > 0) || !(ev.parts >= 1) || !(ev.everyDays >= 1)) break
      s.plans.set(ev.cid, {
        pid: ev.pid, cid: ev.cid, totalPaise: ev.totalPaise, parts: Math.floor(ev.parts), everyDays: Math.floor(ev.everyDays), startDay: ev.startDay, ts,
      })
      break
    case 'plan_cancelled':
      if (s.plans.get(ev.cid)?.pid === ev.pid) s.plans.delete(ev.cid)
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
      if (c) Object.assign(c, { remindersOptIn: ev.remindersOptIn, adult: ev.adult, phone: ev.phone, tag: ev.tag?.trim() || undefined })
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
      const plan = s.plans.get(ev.from)
      if (plan && !s.plans.has(ev.cid)) s.plans.set(ev.cid, { ...plan, cid: ev.cid })
      s.plans.delete(ev.from)
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
        source: ev.source, ...(ev.due ? { due: ev.due } : {}),
      })
      s.order.push(ev.eid)
      break
    case 'entry_amended': {
      const c = s.cash.get(ev.eid)
      if (c) {
        if (ev.paise !== undefined) c.paise = ev.paise
        if (ev.day) c.day = ev.day
        break
      }
      const e = s.entries.get(ev.eid)
      if (!e) break
      if (ev.due === null) delete e.due
      else if (ev.due) e.due = ev.due
      // a due date alone is a note on the entry: it needs no fresh confirmation
      if (ev.paise === undefined && !ev.direction && !ev.cid && !ev.day) break
      if (ev.paise !== undefined) e.paise = ev.paise
      if (ev.direction) e.direction = ev.direction
      if (ev.cid) e.cid = ev.cid
      if (ev.day) e.day = ev.day
      e.amended = true
      e.status = 'unconfirmed' // a changed entry needs fresh confirmation
      break
    }
    case 'entry_voided': {
      const e = s.entries.get(ev.eid) ?? s.cash.get(ev.eid)
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
  /** customers only: suppliers' entries are the shop's own purchases, not credit given */
  creditPaise: number
  paymentPaise: number
  entries: number
  customers: number
  /** galla: cash rows in plus customer payments taken in cash (not Razorpay / QR, which are bank) */
  cashIn?: number
  /** galla: cash rows out plus payments to suppliers */
  cashOut?: number
  /** customer payments that came through Razorpay or a QR (bank, not galla) */
  bankIn?: number
  /** customer accounts opened that day */
  newCustomers?: number
}

/** Is this the account of a supplier (balance runs the other way, never reminded)? */
export const isSupplier = (s: LedgerState, cid: string): boolean => s.customers.get(cid)?.kind === 'supplier'

/** A payment that came in through Razorpay (link or QR): it lands in the bank, not the galla. */
export const isBankPayment = (e: Pick<Entry, 'source'>): boolean =>
  !!e.source?.reasons?.some((r) => r === 'razorpay' || r === 'qr')

export function daySummary(s: LedgerState, day: string): DaySummary {
  let creditPaise = 0
  let paymentPaise = 0
  let entries = 0
  const who = new Set<string>()
  for (const e of s.entries.values()) {
    if (e.day !== day || !live(e) || isSupplier(s, e.cid)) continue
    if (e.direction === 'credit') creditPaise += e.paise
    else paymentPaise += e.paise
    entries++
    who.add(e.cid)
  }
  const cb = cashbook(s, day)
  let newCustomers = 0
  for (const c of s.customers.values()) if (c.kind !== 'supplier' && c.since !== undefined && localDay(c.since) === day) newCustomers++
  return { day, creditPaise, paymentPaise, entries, customers: who.size, cashIn: cb.inPaise, cashOut: cb.outPaise, bankIn: cb.bankInPaise, newCustomers }
}

export function monthSummary(s: LedgerState, yyyymm: string): DaySummary {
  const m = { day: yyyymm, creditPaise: 0, paymentPaise: 0, entries: 0, customers: 0 }
  const who = new Set<string>()
  for (const e of s.entries.values()) {
    if (!e.day.startsWith(yyyymm) || !live(e) || isSupplier(s, e.cid)) continue
    if (e.direction === 'credit') m.creditPaise += e.paise
    else m.paymentPaise += e.paise
    m.entries++
    who.add(e.cid)
  }
  m.customers = who.size
  return m
}

/** Customers who owe money, largest first. Order is by amount only: no judgement of the person. Suppliers never appear. */
export function dues(s: LedgerState): { cid: string; paise: number }[] {
  return [...s.customers.values()].filter((c) => c.kind !== 'supplier').map((c) => c.cid)
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

/** What a label needs to know about a customer (a ledger customer or a voice snapshot one). */
export interface LabelInput { cid: string; name: string; tag?: string; phone?: string }

/**
 * One label per customer, guaranteed unique, never containing a balance. A customer with a
 * nickname (tag) is "Ramesh · Gali 3"; two customers with the same name are told apart by the
 * first of: tag, the last 4 digits of the phone ("Ramesh · …4321"), then their order of creation
 * ("Ramesh 1", "Ramesh 2"). `xs` must be in creation order (a ledger's Map order, the snapshot's).
 */
export function uniqueLabels(xs: LabelInput[]): Map<string, string> {
  const key = (n: string) => n.trim().toLowerCase()
  const groups = new Map<string, LabelInput[]>()
  for (const c of xs) groups.set(key(c.name), [...(groups.get(key(c.name)) ?? []), c])
  const want = new Map<string, string>()
  for (const c of xs) {
    const twins = groups.get(key(c.name))!
    const digits = c.phone?.replace(/\D/g, '') ?? ''
    if (c.tag) want.set(c.cid, `${c.name} · ${c.tag}`)
    else if (twins.length < 2) want.set(c.cid, c.name)
    else if (digits.length >= 4) want.set(c.cid, `${c.name} · …${digits.slice(-4)}`)
    else {
      // untagged twins without a phone: by order of creation among them
      const plain = twins.filter((t) => !t.tag && (t.phone?.replace(/\D/g, '') ?? '').length < 4)
      want.set(c.cid, plain.length === 1 ? c.name : `${c.name} ${plain.indexOf(c) + 1}`)
    }
  }
  // anything still equal (same tag twice, a customer really called "Ramesh 2"): number it
  const out = new Map<string, string>()
  const used = new Set<string>()
  for (const c of xs) {
    const base = want.get(c.cid)!
    let label = base
    for (let n = 2; used.has(label.toLowerCase()); n++) label = `${base} (${n})`
    used.add(label.toLowerCase())
    out.set(c.cid, label)
  }
  return out
}

/** The label of one customer: see uniqueLabels. */
export function uniqueLabel(state: LedgerState, cid: string): string {
  const c = state.customers.get(cid)
  if (!c) return '—'
  // one computation per state object (the store hands out a new one on every change), so a list
  // of rows labels in O(n), not O(n²); a stale hit (state mutated in place) is caught and redone
  let hit = labelCache.get(state)
  const fresh = (l: string | undefined) => !!l && l.startsWith(c.name) && (!c.tag || l.includes(c.tag))
  if (!hit || hit.size !== state.customers.size || !fresh(hit.labels.get(cid))) {
    hit = { size: state.customers.size, labels: uniqueLabels([...state.customers.values()]) }
    labelCache.set(state, hit)
  }
  return hit.labels.get(cid)!
}
const labelCache = new WeakMap<LedgerState, { size: number; labels: Map<string, string> }>()

/**
 * The name to show and say for a customer (the same as uniqueLabel): the name, with the nickname
 * when there is one; two customers with the same name are always told apart.
 */
export const displayName = uniqueLabel

// ------------------------------------------------------------------ days

const pad2 = (n: number) => String(n).padStart(2, '0')
/** The local calendar day (YYYY-MM-DD) of an instant. */
export function localDay(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
/** A YYYY-MM-DD day moved by n days (calendar arithmetic, no time zone involved). */
export function addDays(day: string, n: number): string {
  const t = Date.parse(`${day}T00:00:00Z`)
  return Number.isFinite(t) ? new Date(t + n * 86_400_000).toISOString().slice(0, 10) : day
}
/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : 0
}

// ------------------------------------------------------------------ suppliers and the sign of a balance

/**
 * How a balance reads for the account's kind. balance() is always credit minus payment; for a
 * customer a positive balance is money to collect ("lena hai"), for a supplier it is money the shop
 * owes ("dena hai"). A negative balance is the other side (an advance).
 */
export function owedLabel(kind: PartyKind | undefined, paise: number): { side: 'lena' | 'dena' | 'none'; paise: number } {
  if (!paise) return { side: 'none', paise: 0 }
  const owesShop = kind === 'supplier' ? paise < 0 : paise > 0
  return { side: owesShop ? 'lena' : 'dena', paise: Math.abs(paise) }
}

/** Suppliers the shop owes, largest first ("dene hain"). */
export function supplierDues(s: LedgerState): { cid: string; paise: number }[] {
  return [...s.customers.values()].filter((c) => c.kind === 'supplier')
    .map((c) => ({ cid: c.cid, paise: balance(s, c.cid) }))
    .filter((d) => d.paise > 0)
    .sort((a, b) => b.paise - a.paise)
}

/** Header totals: what is owed to the shop ("lena hai") and what the shop owes ("dena hai": suppliers, customers' advances). */
export function lenaDena(s: LedgerState): { lenaPaise: number; denaPaise: number } {
  let lenaPaise = 0
  let denaPaise = 0
  for (const c of s.customers.values()) {
    const l = owedLabel(c.kind, balance(s, c.cid))
    if (l.side === 'lena') lenaPaise += l.paise
    else if (l.side === 'dena') denaPaise += l.paise
  }
  return { lenaPaise, denaPaise }
}

// ------------------------------------------------------------------ due dates and ageing

/**
 * A customer's credits not yet paid off, oldest first: payments are applied to the oldest credit
 * first (the same idea as the receivables `oldest_unpaid_day`).
 */
export function unpaidCredits(s: LedgerState, cid: string): { e: Entry; leftPaise: number }[] {
  const mine = [...s.entries.values()].filter((e) => e.cid === cid && live(e))
    .sort((a, b) => a.day.localeCompare(b.day) || a.ts - b.ts)
  let pay = mine.filter((e) => e.direction === 'payment').reduce((t, e) => t + e.paise, 0)
  const out: { e: Entry; leftPaise: number }[] = []
  for (const e of mine) {
    if (e.direction !== 'credit') continue
    if (pay >= e.paise) {
      pay -= e.paise
      continue
    }
    out.push({ e, leftPaise: e.paise - pay })
    pay = 0
  }
  return out
}

/** The day of the oldest credit still (partly) unpaid, or null. */
export const oldestUnpaidDay = (s: LedgerState, cid: string): string | null => unpaidCredits(s, cid)[0]?.e.day ?? null

/** The earliest due date among the unpaid credits, or null. */
export function dueDayOf(s: LedgerState, cid: string): string | null {
  let d: string | null = null
  for (const u of unpaidCredits(s, cid)) if (u.e.due && (!d || u.e.due < d)) d = u.e.due
  return d
}

/** The earliest open promise ("kal de dega") on or after `today`, or null. */
export function promiseDayOf(s: LedgerState, cid: string, today = dayFromOffset(0)): string | null {
  let d: string | null = null
  for (const e of s.entries.values())
    if (e.cid === cid && e.promise && !e.voided && e.day >= today && (!d || e.day < d)) d = e.day
  return d
}

/** Is this entry a credit past its due date that is still (partly) unpaid? (the "overdue" chip) */
export function isPastDue(s: LedgerState, eid: string, today = dayFromOffset(0)): boolean {
  const e = s.entries.get(eid)
  if (!e?.due || e.due >= today || !live(e) || e.direction !== 'credit') return false
  return unpaidCredits(s, e.cid).some((u) => u.e.eid === eid)
}

export type AgeBucket = '0-7' | '8-30' | '30+'
export const AGE_BUCKETS: AgeBucket[] = ['0-7', '8-30', '30+']
export const ageBucket = (days: number): AgeBucket => (days <= 7 ? '0-7' : days <= 30 ? '8-30' : '30+')

export interface AgeRow {
  cid: string
  paise: number
  /** the oldest unpaid credit's day */
  oldestDay: string
  /** days since then */
  days: number
  bucket: AgeBucket
  dueDay?: string
  /** a due date has passed and money is still owed */
  pastDue: boolean
}

/**
 * Dues ageing: every customer who owes, with how old their oldest unpaid credit is, and totals per
 * bucket (0-7, 8-30, 30+ days). Suppliers never appear. Age is a fact about the entries, not a judgement.
 */
export function ageing(s: LedgerState, today = dayFromOffset(0)): { rows: AgeRow[]; buckets: Record<AgeBucket, { count: number; paise: number }> } {
  const buckets = { '0-7': { count: 0, paise: 0 }, '8-30': { count: 0, paise: 0 }, '30+': { count: 0, paise: 0 } }
  const rows: AgeRow[] = []
  for (const d of dues(s)) {
    const oldestDay = oldestUnpaidDay(s, d.cid) ?? today
    const days = Math.max(0, daysBetween(oldestDay, today))
    const bucket = ageBucket(days)
    const dueDay = dueDayOf(s, d.cid) ?? undefined
    rows.push({ cid: d.cid, paise: d.paise, oldestDay, days, bucket, ...(dueDay ? { dueDay } : {}), pastDue: !!dueDay && dueDay < today })
    buckets[bucket].count++
    buckets[bucket].paise += d.paise
  }
  return { rows, buckets }
}

// ------------------------------------------------------------------ the collect-today queue

export type CollectReason = 'due' | 'promise' | 'old'
/** One customer as the collect list needs them (a ledger customer, or a voice snapshot customer). */
export interface CollectInput {
  cid: string
  balancePaise: number
  kind?: PartyKind
  oldestDay?: string | null
  dueDay?: string | null
  promiseDay?: string | null
}
export interface CollectRow {
  cid: string
  paise: number
  reasons: CollectReason[]
  dueDay?: string
  promiseDay?: string
  /** age of the oldest unpaid credit */
  days?: number
}
/** dues older than this many days join the collect list */
export const OLD_DAYS = 30

/**
 * Who to collect from today: due date today or past, a promise for today, or owing for more than
 * 30 days. One row per customer (several reasons merge), suppliers and zero balances never.
 * Order: due, then promised, then old; larger amounts first within each.
 */
export function collectFrom(xs: CollectInput[], today: string): CollectRow[] {
  const rank = (r: CollectRow) => (r.reasons.includes('due') ? 0 : r.reasons.includes('promise') ? 1 : 2)
  const out: CollectRow[] = []
  const seen = new Set<string>()
  for (const c of xs) {
    if (c.kind === 'supplier' || c.balancePaise <= 0 || seen.has(c.cid)) continue
    const reasons: CollectReason[] = []
    if (c.dueDay && c.dueDay <= today) reasons.push('due')
    if (c.promiseDay && c.promiseDay === today) reasons.push('promise')
    const days = c.oldestDay ? daysBetween(c.oldestDay, today) : undefined
    if (days !== undefined && days > OLD_DAYS) reasons.push('old')
    if (!reasons.length) continue
    seen.add(c.cid)
    out.push({
      cid: c.cid, paise: c.balancePaise, reasons,
      ...(c.dueDay ? { dueDay: c.dueDay } : {}), ...(c.promiseDay ? { promiseDay: c.promiseDay } : {}), ...(days !== undefined ? { days } : {}),
    })
  }
  return out.sort((a, b) => rank(a) - rank(b) || b.paise - a.paise)
}

/** The collect-today list from the ledger itself. */
export function collectList(s: LedgerState, today = dayFromOffset(0)): CollectRow[] {
  return collectFrom([...s.customers.values()].map((c) => ({
    cid: c.cid, kind: c.kind, balancePaise: balance(s, c.cid),
    oldestDay: oldestUnpaidDay(s, c.cid), dueDay: dueDayOf(s, c.cid), promiseDay: promiseDayOf(s, c.cid, today),
  })), today)
}

/** What the first wake of the day offers once: promises today, due dates reached, old dues, and their total. */
export function morningBriefing(s: LedgerState, today = dayFromOffset(0)): { promises: number; due: number; old: number; count: number; paise: number } {
  const rows = collectList(s, today)
  return {
    promises: rows.filter((r) => r.reasons.includes('promise')).length,
    due: rows.filter((r) => r.reasons.includes('due')).length,
    old: rows.filter((r) => r.reasons.includes('old')).length,
    count: rows.length,
    paise: rows.reduce((t, r) => t + r.paise, 0),
  }
}

// ------------------------------------------------------------------ instalment plans

/** Each instalment's amount (equal parts, the last takes the remainder) and day. */
export function planSchedule(p: Pick<Plan, 'totalPaise' | 'parts' | 'everyDays' | 'startDay'>): { paise: number; day: string }[] {
  const n = Math.max(1, Math.floor(p.parts))
  const part = Math.floor(p.totalPaise / n)
  return Array.from({ length: n }, (_, i) => ({
    paise: i === n - 1 ? p.totalPaise - part * (n - 1) : part,
    day: addDays(p.startDay, i * Math.max(1, p.everyDays)),
  }))
}

export interface PlanStatus {
  plan: Plan
  schedule: { paise: number; day: string }[]
  /** payments made since the plan was set (capped at the plan total) */
  paidPaise: number
  /** instalments fully paid (payments fill the oldest instalment first; extra carries into the next) */
  paidParts: number
  /** the next instalment still open: its number (0-based), day and what is left of it */
  next: { index: number; day: string; paise: number } | null
  /** an instalment's day has passed and it is not fully paid */
  behind: boolean
  /** how much of the instalments whose day has passed is unpaid */
  behindPaise: number
  /** paid in full, or the balance reached zero: the plan has ended by itself */
  done: boolean
}

/** Where a customer's instalment plan stands, or null when there is none. */
export function planStatus(s: LedgerState, cid: string, today = dayFromOffset(0)): PlanStatus | null {
  const plan = s.plans.get(cid)
  if (!plan) return null
  const schedule = planSchedule(plan)
  let paid = 0
  for (const e of s.entries.values())
    if (e.cid === cid && live(e) && e.direction === 'payment' && e.ts >= plan.ts) paid += e.paise
  paid = Math.min(paid, plan.totalPaise)
  let left = paid
  let paidParts = 0
  let next: PlanStatus['next'] = null
  let behindPaise = 0
  schedule.forEach((p, i) => {
    const cover = Math.min(left, p.paise)
    left -= cover
    if (cover === p.paise) paidParts++
    else if (!next) next = { index: i, day: p.day, paise: p.paise - cover }
    if (p.day < today) behindPaise += p.paise - cover
  })
  const done = paid >= plan.totalPaise || balance(s, cid) <= 0
  return { plan, schedule, paidPaise: paid, paidParts, next: done ? null : next, behind: !done && behindPaise > 0, behindPaise: done ? 0 : behindPaise, done }
}

// ------------------------------------------------------------------ galla (cashbook)

export interface CashRow {
  eid: string
  paise: number
  dir: 'in' | 'out'
  /** a cash event's category; derived rows have none */
  category?: CashCategory
  note?: string
  /** derived rows: the customer or supplier whose payment it is */
  cid?: string
  /** computed from an entry (a customer's cash payment, a payment to a supplier), never stored twice */
  derived: boolean
  ts: number
}

/**
 * One day of the galla: cash events, plus customers' cash payments (cash in) and payments to
 * suppliers (cash out) derived from the entries. Razorpay / QR payments are bank, counted apart.
 */
export function cashbook(s: LedgerState, day: string): { day: string; rows: CashRow[]; inPaise: number; outPaise: number; netPaise: number; bankInPaise: number } {
  const rows: CashRow[] = []
  let bankInPaise = 0
  for (const c of s.cash.values())
    if (c.day === day && !c.voided) rows.push({ eid: c.eid, paise: c.paise, dir: c.dir, category: c.category, ...(c.note ? { note: c.note } : {}), derived: false, ts: c.ts })
  for (const e of s.entries.values()) {
    if (e.day !== day || !live(e) || e.direction !== 'payment') continue
    if (isSupplier(s, e.cid)) rows.push({ eid: e.eid, paise: e.paise, dir: 'out', cid: e.cid, derived: true, ts: e.ts })
    else if (isBankPayment(e)) bankInPaise += e.paise
    else rows.push({ eid: e.eid, paise: e.paise, dir: 'in', cid: e.cid, derived: true, ts: e.ts })
  }
  rows.sort((a, b) => a.ts - b.ts)
  const inPaise = rows.filter((r) => r.dir === 'in').reduce((t, r) => t + r.paise, 0)
  const outPaise = rows.filter((r) => r.dir === 'out').reduce((t, r) => t + r.paise, 0)
  return { day, rows, inPaise, outPaise, netPaise: inPaise - outPaise, bankInPaise }
}

/** Credit given and payments taken for the last `n` days ending `today`, oldest first (the sparkline). */
export function sevenDayTotals(s: LedgerState, today = dayFromOffset(0), n = 7): { day: string; creditPaise: number; paymentPaise: number }[] {
  const days = Array.from({ length: n }, (_, i) => addDays(today, i - n + 1))
  const by = new Map(days.map((d) => [d, { day: d, creditPaise: 0, paymentPaise: 0 }]))
  for (const e of s.entries.values()) {
    const b = by.get(e.day)
    if (!b || !live(e) || isSupplier(s, e.cid)) continue
    if (e.direction === 'credit') b.creditPaise += e.paise
    else b.paymentPaise += e.paise
  }
  return days.map((d) => by.get(d)!)
}
