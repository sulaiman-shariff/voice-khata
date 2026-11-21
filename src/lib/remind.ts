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
 */
import { balance, type LedgerState } from '../../shared/ledger.js'
import { say } from '../../shared/replies.js'
import { api } from './api'
import { PAY_LABEL, isUpiId, payPageUrl } from './pay'
import type { KhataStore, Settings } from './contracts'

export type RemindResult =
  | { ok: true; via: 'twilio' | 'share' }
  | { ok: false; reason: 'no-phone' | 'not-allowed' | 'nothing-due' | 'failed'; error?: string }

let configured: Promise<boolean> | null = null
/** Is Twilio set up on the server? (cached; a failed check counts as no) */
export const twilioReady = (): Promise<boolean> =>
  (configured ??= fetch(api('/api/remind')).then((r) => r.json()).then((j: { configured?: boolean }) => !!j.configured).catch(() => false))

export const canRemind = (state: LedgerState, cid: string): boolean => {
  const c = state.customers.get(cid)
  return !!c && c.adult && c.remindersOptIn
}

/** The polite reminder in the shop's language, signed with the shop profile. */
export function reminderMessage(state: LedgerState, settings: Settings, cid: string): string {
  const c = state.customers.get(cid)!
  const owed = Math.max(0, balance(state, cid)) / 100
  const shop = [settings.shopName, settings.shopAddress].filter(Boolean).join(', ')
  const sign = [settings.ownerName, settings.shopPhone ? `📞 ${settings.shopPhone}` : ''].filter(Boolean).join(' · ')
  const lang = settings.lang ?? 'hi'
  // with the shop's UPI ID set, the customer can pay straight from the message
  const pay = isUpiId(settings.shopUpi) && owed > 0
    ? `💳 ${PAY_LABEL[lang]} ₹${owed.toLocaleString('en-IN')}: ${payPageUrl({ pa: settings.shopUpi!, pn: settings.shopName, am: owed, tn: `Khata: ${c.name}` })}\nUPI: ${settings.shopUpi!.trim()}`
    : ''
  return [say(lang).reminderText(c.name, owed, shop), pay, sign && `— ${sign}`].filter(Boolean).join('\n')
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
  const text = opts.text ?? reminderMessage(s, store.settings, cid)
  const stamp = () => store.updateSettings({ reminded: { ...(store.settings.reminded ?? {}), [cid]: Date.now() } })
  if (c.phone && (await twilioReady())) {
    try {
      const res = await fetch(api('/api/remind'), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: c.phone, body: text, vars: { name: c.name, amount: `₹${(balance(s, cid) / 100).toLocaleString('en-IN')}`, shop: store.settings.shopName } }),
      })
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; code?: number }
      if (res.ok && j.ok) {
        await stamp()
        return { ok: true, via: 'twilio' }
      }
      if (!opts.interactive) return { ok: false, reason: 'failed', error: j.error ?? `HTTP ${res.status}` }
      // Twilio refused (e.g. 63015: the customer has not joined the sandbox): let the shopkeeper send it
      share(text, c.phone)
      await stamp()
      return { ok: false, reason: 'failed', error: `${j.code ? `${j.code}: ` : ''}${j.error ?? res.status} — opened WhatsApp instead` }
    } catch (e) {
      if (!opts.interactive) return { ok: false, reason: 'failed', error: String(e) }
    }
  }
  if (!opts.interactive) return { ok: false, reason: c.phone ? 'failed' : 'no-phone' }
  share(text, c.phone)
  await stamp()
  return { ok: true, via: 'share' }
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
  let sent = 0
  let failed = 0
  for (const cid of dueForReminder(store.state, store.settings)) {
    const r = await sendReminder(store, cid)
    if (r.ok) sent++
    else failed++
  }
  return { sent, failed }
}
