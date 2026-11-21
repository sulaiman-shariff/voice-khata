/**
 * Keeps the server's reminder list in step with the phone, and brings back what happened off the phone.
 *
 * Up (PUT /api/receivables): only customers who agreed to reminders, are adults and have a number:
 * name, number, balance. Plus the shop's reminder settings, so the hourly sweep (Cloud Run) words and
 * times reminders exactly as the phone would. Nothing else of the ledger leaves the phone.
 *
 * Down (GET /api/pending, then POST to acknowledge):
 * - payment  a customer paid a Razorpay link: added to the khata as a payment (once: the entry id is the payment id)
 * - reminded the server sent an automatic reminder: the reminders screen shows when
 * - optout   the customer replied STOP: reminders are turned off for them
 * - dispute  the customer says an amount is wrong: shown to the shopkeeper
 * - promise_suggestion  the customer wrote or said on WhatsApp "kal de dunga": a promise the
 *            shopkeeper confirms with one tap (nothing is written until then)
 *
 * Payments are pulled every minute, and every 2 s while one is expected (`expectPayments`: a counter
 * QR is open, or a link was just sent), so the soundbox announces them within seconds.
 *
 * Runs only when the server has Razorpay set up (GET /api/remind says `payments`).
 */
import { balance, dayFromOffset, dueDayOf, oldestUnpaidDay, planStatus, promiseDayOf } from '../../shared/ledger.js'
import { normalizePhone } from '../../shared/phone.js'
import { api } from './api'
import type { KhataStore } from './contracts'
import { remindStatus } from './remind'
import { ensureShop, forgetShop, shopAuth, shopCred } from './shop'

export interface PendingEvent {
  id: string
  kind: 'payment' | 'reminded' | 'optout' | 'dispute' | string
  body: Record<string, unknown>
}

export interface SyncNotice {
  kind: 'payment' | 'dispute' | 'optout' | 'promise_suggestion'
  cid: string
  paise?: number
  text?: string
  /** payment: the customer's balance after it (paise), for the announcement and the toast */
  balancePaise?: number
  /** payment: a link paid only in part (offer a link for the rest) */
  partial?: boolean
  /** payment: a counter QR or a WhatsApp link */
  via?: 'qr' | 'link'
  /** payment through a counter QR: its id (the open QR sheet closes on it) */
  qrId?: string
  /** promise_suggestion: the day the customer said they will pay (YYYY-MM-DD) */
  day?: string
}

/**
 * What the server should know: opted-in adult customers with a number (never suppliers), and the
 * shop's reminder settings. Per customer also the days the sweep acts on: the oldest unpaid credit,
 * the earliest due date, the next promise, and the next instalment of a plan (day and amount).
 */
export function receivablesPayload(store: KhataStore, now = new Date()) {
  const s = store.state
  const st = store.settings
  const today = dayFromOffset(0, now)
  const days = (cid: string) => {
    const ps = planStatus(s, cid, today)
    return {
      oldestUnpaidDay: oldestUnpaidDay(s, cid),
      dueDay: dueDayOf(s, cid),
      promiseDay: promiseDayOf(s, cid, today),
      planNextDay: ps?.next?.day ?? null,
      planPartPaise: ps?.next?.paise ?? null,
    }
  }
  return {
    shopName: st.shopName,
    lang: st.lang ?? 'hi',
    signature: [st.ownerName, st.shopAddress, st.shopPhone].filter(Boolean).join(' · '),
    autoRemind: !!st.autoRemind,
    remindEveryDays: Math.max(1, st.remindEveryDays ?? 7),
    customers: [...s.customers.values()]
      .filter((c) => c.kind !== 'supplier' && c.adult && c.remindersOptIn && !!normalizePhone(c.phone))
      .map((c) => ({ cid: c.cid, name: c.name, phone: c.phone!, balancePaise: balance(s, c.cid), ...days(c.cid) })),
  }
}

/** Days from today (the phone's calendar) back to an India day: 0 today, -1 yesterday. */
export function offsetFor(day: string, now = new Date()): number {
  const today = dayFromOffset(0, now)
  const ms = Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)
  return Number.isFinite(ms) ? Math.min(0, Math.round(ms / 86_400_000)) : 0
}

/** Put the server's events into the khata. Returns the ids that are done (applied, or nothing to do). */
export async function applyPending(store: KhataStore, events: PendingEvent[], notify: (n: SyncNotice) => void): Promise<string[]> {
  const done: string[] = []
  for (const e of events) {
    const b = e.body
    const cid = typeof b.cid === 'string' ? b.cid : ''
    const known = store.state.customers.get(cid)
    try {
      if (e.kind === 'payment' && known && typeof b.paise === 'number' && typeof b.paymentId === 'string') {
        await store.applyOps([{
          op: 'entry',
          // the payment id is the entry id: a second delivery of the same payment is skipped by the store
          eid: `rzp_${b.paymentId}`,
          cid,
          paise: b.paise,
          direction: 'payment',
          dayOffset: offsetFor(typeof b.day === 'string' ? b.day : ''),
          promise: false,
          source: { transcript: `Razorpay ${b.method ?? ''} ${b.paymentId}`.replace(/\s+/g, ' ').trim(), confidence: 'high', reasons: ['razorpay'], lang: store.settings.lang ?? 'hi', path: 'fast' },
        }])
        notify({
          kind: 'payment', cid, paise: b.paise, balancePaise: balance(store.state, cid),
          via: b.via === 'qr' ? 'qr' : 'link',
          ...(b.partial === true ? { partial: true } : {}),
          ...(typeof b.qrId === 'string' ? { qrId: b.qrId } : {}),
        })
      } else if (e.kind === 'reminded' && known && typeof b.at === 'number') {
        await store.updateSettings({ reminded: { ...(store.settings.reminded ?? {}), [cid]: b.at } })
      } else if (e.kind === 'optout' && known) {
        await store.setConsent(cid, { remindersOptIn: false, adult: known.adult, phone: known.phone })
        notify({ kind: 'optout', cid })
      } else if (e.kind === 'dispute' && known) {
        notify({ kind: 'dispute', cid, text: typeof b.text === 'string' ? b.text : undefined })
      } else if (e.kind === 'promise_suggestion' && known && typeof b.day === 'string') {
        notify({
          kind: 'promise_suggestion', cid, day: b.day,
          ...(typeof b.paise === 'number' && Number.isInteger(b.paise) && b.paise > 0 ? { paise: b.paise } : {}),
          ...(typeof b.text === 'string' ? { text: b.text } : {}),
        })
      }
      // a customer since forgotten on this phone, or a kind this version does not know: nothing to do
      done.push(e.id)
    } catch {
      // try again on the next pull
    }
  }
  return done
}

const DEBOUNCE_MS = 3000
const PULL_EVERY_MS = 60_000
/** while a payment is expected */
export const PULL_FAST_MS = 2000
/** after a link is sent or a reminder goes out: payments usually come within minutes */
export const EXPECT_AFTER_LINK_MS = 10 * 60_000

/** The stop function, plus `expect(ms)`: pull every 2 s for the next `ms` (a QR is open, a link just went out). */
export type SyncHandle = (() => void) & { expect: (ms: number) => void }

let active: SyncHandle | null = null

/** Pull every 2 s for the next `ms` on the running sync (no-op when sync is not running). */
export function expectPayments(ms: number = EXPECT_AFTER_LINK_MS) {
  active?.expect(ms)
}

/** Start syncing; returns a stop function (with `expect`). Does nothing unless the server takes Razorpay payments. */
export function startSync(store: KhataStore, notify: (n: SyncNotice) => void): SyncHandle {
  let stopped = false
  let fastUntil = 0
  let tick: ReturnType<typeof setTimeout> | null = null
  let lastSent = ''
  let timer: ReturnType<typeof setTimeout> | null = null
  let pulling = false

  const cred = async () => {
    const st = await remindStatus()
    if (!st.payments) return null
    // register only once there is someone to remind
    if (!shopCred() && !receivablesPayload(store).customers.length) return null
    return ensureShop(store.settings.shopName, store.settings.lang ?? 'hi')
  }

  const push = async () => {
    if (stopped) return
    const payload = JSON.stringify(receivablesPayload(store))
    if (payload === lastSent) return
    const c = await cred()
    if (!c) return
    try {
      const res = await fetch(api('/api/receivables'), { method: 'PUT', headers: { 'content-type': 'application/json', authorization: shopAuth(c) }, body: payload })
      if (res.status === 401) forgetShop()
      else if (res.ok) lastSent = payload
    } catch { /* offline: the next change or pull tries again */ }
  }

  const pull = async () => {
    if (stopped || pulling || document.visibilityState === 'hidden') return
    const c = shopCred()
    if (!c) return
    pulling = true
    try {
      const res = await fetch(api('/api/pending'), { headers: { authorization: shopAuth(c) } })
      if (res.status === 401) { forgetShop(); return }
      if (!res.ok) return
      const { events } = (await res.json()) as { events: PendingEvent[] }
      if (!events.length) return
      const ids = await applyPending(store, events, notify)
      if (ids.length) {
        await fetch(api('/api/pending'), { method: 'POST', headers: { 'content-type': 'application/json', authorization: shopAuth(c) }, body: JSON.stringify({ ids }) })
      }
    } catch { /* offline */ } finally {
      pulling = false
    }
    void push()
  }

  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void push(), DEBOUNCE_MS)
  }
  const unsubscribe = store.subscribe(schedule)
  // one timer: every 2 s while a payment is expected, else every minute
  const loop = (delay: number) => {
    if (tick) clearTimeout(tick)
    if (stopped) return
    tick = setTimeout(() => {
      void pull().finally(() => loop(Date.now() < fastUntil ? PULL_FAST_MS : PULL_EVERY_MS))
    }, delay)
  }
  loop(PULL_EVERY_MS)
  const onVisible = () => { if (document.visibilityState === 'visible') void pull() }
  document.addEventListener('visibilitychange', onVisible)
  // payments first, then the list: the list then already has them
  void pull().then(() => push())

  const handle: SyncHandle = Object.assign(() => {
    stopped = true
    unsubscribe()
    if (tick) clearTimeout(tick)
    if (timer) clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisible)
    if (active === handle) active = null
  }, {
    expect(ms: number) {
      if (stopped || !(ms > 0)) return
      const was = Date.now() < fastUntil
      fastUntil = Math.max(fastUntil, Date.now() + ms)
      if (!was) loop(PULL_FAST_MS)
    },
  })
  active = handle
  return handle
}
