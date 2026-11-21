/**
 * WhatsApp payment reminders.
 *
 * The message is built here on the phone (the ledger never leaves it) from the polite template in
 * shared/replies.ts, signed with the shop profile, and sent through /api/remind (Twilio). Without
 * Twilio configured, or without a saved number, it falls back to a wa.me share link the
 * shopkeeper sends themselves.
 *
 * Only adult customers who agreed to reminders get one (shared/replies.ts header). Automatic
 * reminders run from the phone while the app is open, at most once every N days per customer.
 *
 * With Razorpay on the server (GET /api/remind says `payments`), a registered shop (src/lib/shop.ts)
 * sends PAY_LINK in the text: the server puts in a Razorpay link that books the payment into the
 * khata by itself (src/lib/sync.ts). Automatic reminders then run on the server, even with the
 * phone off; the phone's own loop stands down so nobody gets two.
 */
import { balance, type LedgerState } from '../../shared/ledger.js'
import { PAY_LINK, buildReminder } from '../../shared/reminder.js'
import { api } from './api'
import { isUpiId, payPageUrl } from './pay'
import type { KhataStore, Settings } from './contracts'
import { ensureShop, forgetShop, shopAuth, shopCred } from './shop'

export type RemindResult =
  | { ok: true; via: 'twilio' | 'share' }
  | {
    ok: false; reason: 'no-phone' | 'not-allowed' | 'nothing-due' | 'failed'; error?: string
    /** Twilio code when Twilio refused (63015 not joined, 63016 outside the 24 h window, 21211 bad number) */
    code?: number
    /** send it from the shop's own WhatsApp instead (offered, never opened by itself) */
    share?: () => void
  }

export interface RemindStatus {
  configured: boolean
  provider: 'vonage' | 'twilio' | null
  /** Razorpay links (and server-side automatic reminders) are available */
  payments: boolean
}

let status: RemindStatus | null = null
let checkedAt = 0
/**
 * What the server can do. Only a yes is remembered: a no, or no answer (the server was restarting,
 * the network blinked), is asked again later instead of quietly switching every reminder to the
 * WhatsApp share for the rest of the session.
 */
export async function remindStatus(force = false): Promise<RemindStatus> {
  if (status?.configured) return status
  if (!force && Date.now() - checkedAt < 5000) return status ?? { configured: false, provider: null, payments: false }
  checkedAt = Date.now()
  try {
    const j = (await (await fetch(api('/api/remind'))).json()) as Partial<RemindStatus>
    status = { configured: !!j.configured, provider: j.provider ?? null, payments: !!j.payments }
  } catch {
    status = { configured: false, provider: null, payments: false }
  }
  return status
}

/** Is a WhatsApp sender set up on the server? */
export const twilioReady = async (force = false): Promise<boolean> => (await remindStatus(force)).configured

/** Automatic reminders happen on the server (Cloud Scheduler) for a registered shop with Razorpay on. */
export const serverRemindsAutomatically = (): boolean => !!status?.payments && !!shopCred()

export const canRemind = (state: LedgerState, cid: string): boolean => {
  const c = state.customers.get(cid)
  return !!c && c.adult && c.remindersOptIn
}

/**
 * Demo only: VITE_DEMO_UPI stands in when the shop has not entered its own UPI ID, so the pay line
 * can be shown off. Use an ID no bank handles (e.g. khatabhai.demo@example): UPI apps reject it,
 * so a customer can never pay a stranger by mistake. The shop's real UPI ID always wins.
 */
const demoUpi = (): string | null => {
  const v = (import.meta.env as Record<string, string | undefined>).VITE_DEMO_UPI?.trim()
  return v && isUpiId(v) ? v : null
}

/**
 * The WhatsApp reminder, in the shop's language (shared/replies.ts reminderWords): businesslike,
 * bold for what matters, one emoji at most.
 *
 *   *Sharma Kirana* — Payment reminder
 *
 *   Hi Ramesh, your khata balance with us is *₹500*.
 *   Please settle it on your next visit, or pay online here:
 *   https://…/pay?…
 *   UPI: *sharma@okaxis*
 *
 *   Thank you 🙏
 *   Rakesh · Jayanagar · 98…
 *
 *   _KhataBhai · Reply STOP to stop these reminders._
 */
export function reminderMessage(state: LedgerState, settings: Settings, cid: string, opts: { payLink?: boolean } = {}): string {
  const c = state.customers.get(cid)!
  const owedPaise = Math.max(0, balance(state, cid))
  const upi = isUpiId(settings.shopUpi) ? settings.shopUpi!.trim() : demoUpi()
  // Razorpay (the server fills PAY_LINK) books the payment into the khata by itself; the UPI page does not
  const payUrl = opts.payLink
    ? PAY_LINK
    : upi && owedPaise > 0 ? payPageUrl({ pa: upi, pn: settings.shopName, am: owedPaise / 100, tn: `Khata: ${c.name}` }) : null
  return buildReminder({
    lang: settings.lang ?? 'hi',
    shopName: settings.shopName,
    customerName: c.name,
    owedPaise,
    payUrl,
    upi: opts.payLink ? null : upi,
    signature: [settings.ownerName, settings.shopAddress, settings.shopPhone].filter(Boolean).join(' · '),
  })
}

function share(text: string, phone?: string) {
  const digits = phone?.replace(/\D/g, '') ?? ''
  const to = digits.length === 10 ? `91${digits}` : digits
  window.open(`https://wa.me/${to}?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
}

/**
 * Send one reminder now. `text` overrides the built message (the voice "remind" intent sends
 * its own); `interactive` allows the wa.me fallback (an automatic run never opens windows).
 */
export async function sendReminder(store: KhataStore, cid: string, opts: { text?: string; interactive?: boolean } = {}): Promise<RemindResult> {
  const s = store.state
  const c = s.customers.get(cid)
  if (!c) return { ok: false, reason: 'failed', error: 'no such customer' }
  if (!canRemind(s, cid)) return { ok: false, reason: 'not-allowed' }
  if (balance(s, cid) <= 0) return { ok: false, reason: 'nothing-due' }
  const st = await remindStatus(!!opts.interactive)
  const shop = st.payments && st.configured ? await ensureShop(store.settings.shopName, store.settings.lang ?? 'hi') : null
  // a Razorpay link for a registered shop; the UPI page (if any) stays the fallback
  const text = opts.text ?? reminderMessage(s, store.settings, cid, { payLink: !!shop })
  const upi = isUpiId(store.settings.shopUpi) ? store.settings.shopUpi!.trim() : demoUpi()
  const owedPaise = balance(s, cid)
  const stamp = () => store.updateSettings({ reminded: { ...(store.settings.reminded ?? {}), [cid]: Date.now() } })
  if (!c.phone) return { ok: false, reason: 'no-phone' }
  // by hand, the shop's own WhatsApp cannot fill in a Razorpay link: use the message without it
  const byHandText = text.includes(PAY_LINK) ? reminderMessage(s, store.settings, cid) : text
  const byHand = opts.interactive ? () => { share(byHandText, c.phone); void stamp() } : undefined
  // a tap always asks the server afresh, so a check that failed earlier never sticks
  if (!st.configured) {
    // no sender on the server at all: the shop's own WhatsApp is the way (a tap opens it)
    if (!byHand) return { ok: false, reason: 'failed', error: 'twilio not configured' }
    byHand()
    return { ok: true, via: 'share' }
  }
  try {
    const res = await fetch(api('/api/remind'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(shop ? { authorization: shopAuth(shop) } : {}) },
      body: JSON.stringify({
        to: c.phone, body: text, vars: { name: c.name, amount: `₹${(owedPaise / 100).toLocaleString('en-IN')}`, shop: store.settings.shopName },
        ...(shop ? {
          cid, owedPaise,
          ...(upi && owedPaise > 0 ? { fallbackPayUrl: payPageUrl({ pa: upi, pn: store.settings.shopName, am: owedPaise / 100, tn: `Khata: ${c.name}` }) } : {}),
        } : {}),
      }),
    })
    if (res.status === 401 && shop) forgetShop()
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; code?: number }
    if (res.ok && j.ok) {
      await stamp()
      return { ok: true, via: 'twilio' }
    }
    return { ok: false, reason: 'failed', error: j.error ?? `HTTP ${res.status}`, code: j.code, share: byHand }
  } catch (e) {
    return { ok: false, reason: 'failed', error: String(e), share: byHand }
  }
}

/** Customers an automatic run would remind now: allowed, has a number, owes, not reminded recently. */
export function dueForReminder(state: LedgerState, settings: Settings, now = Date.now()): string[] {
  const every = Math.max(1, settings.remindEveryDays ?? 7) * 86_400_000
  return [...state.customers.values()]
    .filter((c) => c.adult && c.remindersOptIn && !!c.phone && balance(state, c.cid) > 0)
    .filter((c) => now - (settings.reminded?.[c.cid] ?? 0) >= every)
    .map((c) => c.cid)
}

/** Automatic reminders (Twilio only, never opens windows). Returns how many were sent. */
export async function runAutoReminders(store: KhataStore): Promise<{ sent: number; failed: number }> {
  if (!store.settings.autoRemind || !(await twilioReady())) return { sent: 0, failed: 0 }
  // the server's hourly sweep has them (with Razorpay links), phone on or off
  if (serverRemindsAutomatically()) return { sent: 0, failed: 0 }
  let sent = 0
  let failed = 0
  for (const cid of dueForReminder(store.state, store.settings)) {
    const r = await sendReminder(store, cid)
    if (r.ok) sent++
    else failed++
  }
  return { sent, failed }
}
