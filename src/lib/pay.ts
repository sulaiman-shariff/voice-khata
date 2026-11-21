/**
 * UPI payment links for reminders. Money goes straight from the customer's UPI app to the shop's
 * UPI ID; KhataBhai never holds or sees it. (Marking the khata paid automatically needs a payment
 * gateway webhook: not built yet.)
 *
 * WhatsApp does not make upi:// links tappable, so the reminder carries an https link to /pay
 * (src/pages/PayPage.tsx), which shows a "Pay with UPI app" button, a QR code and the UPI ID.
 */
import type { Lang } from '../../shared/replies.js'
import { publicUrl } from './api'

/** name@bank style UPI ID (VPA). */
export const isUpiId = (s: string | undefined): boolean => !!s && /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/.test(s.trim())

export interface PayRequest {
  /** payee UPI ID */
  pa: string
  /** payee (shop) name */
  pn: string
  /** rupees; 0 = the customer types it */
  am: number
  /** note shown in the UPI app, e.g. "Khata: Ramesh" */
  tn: string
}

/** The standard UPI deep link every Indian UPI app understands. */
export function upiUri(p: PayRequest): string {
  const q = new URLSearchParams({ pa: p.pa.trim(), pn: p.pn.slice(0, 40), cu: 'INR', tn: p.tn.slice(0, 50) })
  if (p.am > 0) q.set('am', p.am.toFixed(2))
  return `upi://pay?${q.toString()}`
}

/** https link to the pay page (tappable in WhatsApp). */
export function payPageUrl(p: PayRequest): string {
  const q = new URLSearchParams({ pa: p.pa.trim(), pn: p.pn.slice(0, 40), tn: p.tn.slice(0, 50) })
  if (p.am > 0) q.set('am', String(Math.round(p.am * 100) / 100))
  return `${publicUrl()}/pay?${q.toString()}`
}

export function readPayRequest(search: string): PayRequest | null {
  const q = new URLSearchParams(search)
  const pa = q.get('pa') ?? ''
  if (!isUpiId(pa)) return null
  const am = Number.parseFloat(q.get('am') ?? '')
  return { pa, pn: q.get('pn') ?? '', am: am > 0 && am < 10_000_000 ? am : 0, tn: q.get('tn') ?? '' }
}

/** "Pay" in the reminder's language. */
export const PAY_LABEL: Record<Lang, string> = {
  hi: 'भुगतान करें', en: 'Pay', kn: 'ಪಾವತಿಸಿ', ta: 'செலுத்த', te: 'చెల్లించండి',
  ml: 'പണമടയ്ക്കാൻ', mr: 'पैसे भरा', bn: 'পেমেন্ট করুন', gu: 'ચુકવણી કરો', pa: 'ਭੁਗਤਾਨ ਕਰੋ',
}
