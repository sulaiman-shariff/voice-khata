/**
 * The WhatsApp reminder, built the same way on the phone (src/lib/remind.ts) and on the server
 * (the automatic sweep), from the words in shared/replies.ts reminderWords:
 *
 *   *Sharma Kirana* — Payment reminder
 *
 *   Hi Ramesh, your khata balance with us is *₹500*.
 *   Please settle it on your next visit, or pay online here:
 *   https://rzp.io/…            (Razorpay link, or the UPI pay page)
 *   UPI: *sharma@okaxis*        (only with the UPI pay page)
 *
 *   Thank you 🙏
 *   Rakesh · Jayanagar · 98…
 *
 *   _KhataBhai · Reply STOP to stop these reminders._
 */
import { reminderWords, type Lang } from './replies.js'

/** Stands in for the Razorpay link in a message the phone builds; /api/remind puts the link here. */
export const PAY_LINK = '{{PAY_LINK}}'

export interface ReminderInput {
  lang: Lang
  shopName: string
  customerName: string
  owedPaise: number
  /** where to pay: a Razorpay link, the UPI pay page, or PAY_LINK; none = settle on the next visit */
  payUrl?: string | null
  /** shown under the link when paying goes to the shop's own UPI ID */
  upi?: string | null
  /** owner · address · phone */
  signature?: string
}

export const formatRupees = (paise: number) => `₹${(Math.max(0, paise) / 100).toLocaleString('en-IN')}`

export function buildReminder(i: ReminderInput): string {
  const w = reminderWords(i.lang)
  const pay = i.payUrl && i.owedPaise > 0
    ? [w.settleOnline, i.payUrl, ...(i.upi ? [`UPI: *${i.upi}*`] : [])]
    : [w.settle]
  return [
    w.header(i.shopName),
    '',
    w.balance(i.customerName, formatRupees(i.owedPaise)),
    ...pay,
    '',
    w.thanks,
    ...(i.signature ? [i.signature] : []),
    '',
    w.optOut,
  ].join('\n')
}
