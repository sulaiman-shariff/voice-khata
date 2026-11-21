/**
 * Razorpay Payment Links over plain fetch (no SDK), and webhook signature checks.
 * https://razorpay.com/docs/api/payments/payment-links/
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

const API = 'https://api.razorpay.com/v1'

export interface RazorpayKeys {
  keyId: string
  keySecret: string
}

export function razorpayKeys(env = process.env): RazorpayKeys | null {
  const keyId = env.RAZORPAY_KEY_ID ?? ''
  const keySecret = env.RAZORPAY_KEY_SECRET ?? ''
  return keyId && keySecret ? { keyId, keySecret } : null
}

export interface LinkRequest {
  amountPaise: number
  /** our id for the link; Razorpay requires it unique per account */
  referenceId: string
  description: string
  /** omitted for a counter link: the customer is standing there, no number needed */
  customer?: { name: string; contact: string }
  notes: Record<string, string>
  expireBy: Date
  /** minimum first part-payment; omitted = the full amount must be paid at once */
  minPartialPaise?: number
}

export interface PaymentLink {
  id: string
  short_url: string
  status: string
  amount: number
  amount_paid: number
  expire_by: number
  reference_id: string
}

export class RazorpayError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function createPaymentLink(keys: RazorpayKeys, r: LinkRequest, fetchImpl: typeof fetch = fetch): Promise<PaymentLink> {
  const body = {
    amount: r.amountPaise,
    currency: 'INR',
    accept_partial: r.minPartialPaise !== undefined,
    ...(r.minPartialPaise !== undefined ? { first_min_partial_amount: r.minPartialPaise } : {}),
    reference_id: r.referenceId,
    description: r.description.slice(0, 2048),
    ...(r.customer ? { customer: { name: r.customer.name.slice(0, 255), contact: `+${r.customer.contact}` } } : {}),
    // we send the link and the receipt on WhatsApp ourselves
    notify: { sms: false, email: false },
    reminder_enable: false,
    notes: r.notes,
    expire_by: Math.floor(r.expireBy.getTime() / 1000),
  }
  const res = await fetchImpl(`${API}/payment_links`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: basic(keys) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
  const text = await res.text()
  if (!res.ok) throw new RazorpayError(res.status, describe(text))
  return JSON.parse(text) as PaymentLink
}

/** Cancel a link nobody should pay any more (a counter link the shopkeeper closed). */
export async function cancelPaymentLink(keys: RazorpayKeys, id: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl(`${API}/payment_links/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    headers: { authorization: basic(keys) },
    signal: AbortSignal.timeout(10_000),
  })
  // already paid, cancelled or expired: nothing to do
  if (!res.ok && res.status !== 400) throw new RazorpayError(res.status, describe(await res.text()))
}

const basic = (k: RazorpayKeys) => `Basic ${Buffer.from(`${k.keyId}:${k.keySecret}`).toString('base64')}`

function describe(text: string): string {
  try {
    const e = JSON.parse(text)?.error
    return String(e?.description ?? e?.code ?? text).slice(0, 300)
  } catch {
    return text.slice(0, 300)
  }
}

/** Razorpay signs the exact request body: hex HMAC-SHA256 with the webhook secret, in X-Razorpay-Signature. */
export function verifyRazorpaySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false
  const want = createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(want)
  const b = Buffer.from(signature)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** The parts of a payment_link.paid / payment_link.partially_paid webhook we use. */
export interface LinkPaidEvent {
  event: 'payment_link.paid' | 'payment_link.partially_paid'
  linkId: string
  referenceId: string
  linkStatus: string
  notes: Record<string, string>
  paymentId: string
  paymentPaise: number
  method: string | null
  createdAt: number
}

export function parseLinkPaid(body: unknown): LinkPaidEvent | null {
  const b = body as {
    event?: string
    payload?: {
      payment_link?: { entity?: { id?: string; reference_id?: string; status?: string; notes?: Record<string, string> | unknown[] } }
      payment?: { entity?: { id?: string; amount?: number; status?: string; method?: string; created_at?: number } }
    }
  }
  if (b?.event !== 'payment_link.paid' && b?.event !== 'payment_link.partially_paid') return null
  const link = b.payload?.payment_link?.entity
  const pay = b.payload?.payment?.entity
  if (!link?.id || !pay?.id || typeof pay.amount !== 'number' || !Number.isInteger(pay.amount) || pay.amount <= 0) return null
  if (pay.status && pay.status !== 'captured') return null
  return {
    event: b.event,
    linkId: link.id,
    referenceId: link.reference_id ?? '',
    linkStatus: link.status ?? '',
    // Razorpay sends an empty notes object as []
    notes: Array.isArray(link.notes) ? {} : (link.notes ?? {}),
    paymentId: pay.id,
    paymentPaise: pay.amount,
    method: pay.method ?? null,
    createdAt: pay.created_at ?? Math.floor(Date.now() / 1000),
  }
}

// ------------------------------------------------------------------ counter QR (QR Codes API)
// https://razorpay.com/docs/api/qr-codes/

/** a counter QR is open this long: the customer is standing at the counter */
export const QR_OPEN_MS = 15 * 60_000

export interface QrRequest {
  amountPaise: number
  /** shown in the customer's UPI app as the payee label */
  name: string
  description: string
  notes: Record<string, string>
  closeBy: Date
}

export interface QrCode {
  id: string
  image_url: string
  status: string
  close_by: number
  payment_amount: number
}

/** One single-use UPI QR for exactly this amount, closing at `closeBy`. */
export async function createQr(keys: RazorpayKeys, r: QrRequest, fetchImpl: typeof fetch = fetch): Promise<QrCode> {
  const body = {
    type: 'upi_qr',
    name: r.name.slice(0, 50) || 'Khata',
    usage: 'single_use',
    fixed_amount: true,
    payment_amount: r.amountPaise,
    description: r.description.slice(0, 255),
    close_by: Math.floor(r.closeBy.getTime() / 1000),
    notes: r.notes,
  }
  const res = await fetchImpl(`${API}/payments/qr_codes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: basic(keys) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
  const text = await res.text()
  if (!res.ok) throw new RazorpayError(res.status, describe(text))
  return JSON.parse(text) as QrCode
}

/** Close a QR that is no longer wanted (paid in cash, sheet closed), so it cannot be paid later. */
export async function closeQr(keys: RazorpayKeys, id: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl(`${API}/payments/qr_codes/${encodeURIComponent(id)}/close`, {
    method: 'POST',
    headers: { authorization: basic(keys) },
    signal: AbortSignal.timeout(10_000),
  })
  // already closed or paid: nothing to do
  if (!res.ok && res.status !== 400) throw new RazorpayError(res.status, describe(await res.text()))
}

/**
 * The account cannot make QR codes (the feature is off for it, or the keys cannot use it): the
 * phone falls back to a plain upi:// QR. Other errors are real failures.
 */
export function qrNotEnabled(e: unknown): boolean {
  if (!(e instanceof RazorpayError)) return false
  if (e.status === 401 || e.status === 403 || e.status === 404) return true
  return e.status === 400 && /not (been )?(enabled|activated|allowed|permitted|available)|feature|requested url/i.test(e.message)
}

/** The parts of a qr_code.credited webhook we use. */
export interface QrCreditedEvent {
  event: 'qr_code.credited'
  qrId: string
  notes: Record<string, string>
  paymentId: string
  paymentPaise: number
  method: string | null
  createdAt: number
}

export function parseQrCredited(body: unknown): QrCreditedEvent | null {
  const b = body as {
    event?: string
    payload?: {
      qr_code?: { entity?: { id?: string; notes?: Record<string, string> | unknown[] } }
      payment?: { entity?: { id?: string; amount?: number; status?: string; method?: string; created_at?: number } }
    }
  }
  if (b?.event !== 'qr_code.credited') return null
  const qr = b.payload?.qr_code?.entity
  const pay = b.payload?.payment?.entity
  if (!qr?.id || !pay?.id || typeof pay.amount !== 'number' || !Number.isInteger(pay.amount) || pay.amount <= 0) return null
  if (pay.status && pay.status !== 'captured') return null
  return {
    event: 'qr_code.credited',
    qrId: qr.id,
    notes: Array.isArray(qr.notes) ? {} : (qr.notes ?? {}),
    paymentId: pay.id,
    paymentPaise: pay.amount,
    method: pay.method ?? null,
    createdAt: pay.created_at ?? Math.floor(Date.now() / 1000),
  }
}
