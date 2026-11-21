/**
 * POST /webhooks/razorpay — a customer paid (all or part of) a link we sent, or a counter QR.
 *   payment_link.paid / payment_link.partially_paid   a WhatsApp reminder's link
 *   qr_code.credited                                   a counter QR (api/qr.ts)
 * Signed with RAZORPAY_WEBHOOK_SECRET. Razorpay retries until it gets a 2xx, so every step is
 * idempotent on the payment id: one payment is booked once, however often it is delivered.
 */
import { json, sql, ensureSchema } from '../db.js'
import { log } from '../log.js'
import { readText, errorResponse } from '../request.js'
import { istDay } from '../wa/policy.js'
import { sendLogged } from '../wa/reminders.js'
import { waTexts } from '../wa/texts.js'
import { parseLinkPaid, parseQrCredited, verifyRazorpaySignature } from './razorpay.js'

/** One captured payment, from a link or a QR: what the booking needs. */
export interface Credited {
  /** how the customer paid, as the phone shows it: a counter QR (a QR code, or a counter link shown as a QR) or a WhatsApp link */
  via: 'link' | 'qr'
  /** where `ref` lives: payment_links (rzp_link_id) or qr_codes (id) */
  store: 'link' | 'qr'
  /** the Razorpay link or QR id */
  ref: string
  notes: Record<string, string>
  paymentId: string
  paise: number
  method: string | null
  /** unix seconds */
  createdAt: number
  /** a link paid only in part (payment_link.partially_paid) */
  partial: boolean
}

export function creditedFrom(body: unknown): Credited | null {
  const l = parseLinkPaid(body)
  if (l) return {
    // a counter link (server/pay/qr.ts, when the account has no QR Codes) is the counter QR to the phone
    via: l.notes.source === 'counter' ? 'qr' : 'link', store: 'link', ref: l.linkId, notes: l.notes, paymentId: l.paymentId, paise: l.paymentPaise, method: l.method,
    createdAt: l.createdAt, partial: l.event === 'payment_link.partially_paid',
  }
  const q = parseQrCredited(body)
  if (q) return {
    via: 'qr', store: 'qr', ref: q.qrId, notes: q.notes, paymentId: q.paymentId, paise: q.paymentPaise, method: q.method,
    createdAt: q.createdAt, partial: false,
  }
  return null
}

/** What booking a payment does to the database, behind a seam so the idempotency can be tested. */
export interface BookingDb {
  /** the shop and customer a link / QR was made for */
  owner(store: Credited['store'], ref: string): Promise<{ shopId: string; cid: string } | null>
  /** false when this payment id is already booked */
  insertPayment(p: { paymentId: string; ref: string; shopId: string; cid: string; paise: number; method: string | null }): Promise<boolean>
  markRef(store: Credited['store'], ref: string, status: string): Promise<void>
  /** the server's mirror of the balance, less this payment; null when the customer is not mirrored */
  takeFromBalance(shopId: string, cid: string, paise: number): Promise<{ balancePaise: number; name: string; phone: string } | null>
  addPending(shopId: string, kind: string, body: Record<string, unknown>): Promise<void>
}

export const sqlBookingDb: BookingDb = {
  async owner(store, ref) {
    const rows = (store === 'qr'
      ? await sql`SELECT shop_id, cid FROM qr_codes WHERE id = ${ref}`
      : await sql`SELECT shop_id, cid FROM payment_links WHERE rzp_link_id = ${ref}`) as { shop_id: string; cid: string }[]
    return rows[0] ? { shopId: rows[0].shop_id, cid: rows[0].cid } : null
  },
  async insertPayment(p) {
    const fresh = (await sql`INSERT INTO payments (rzp_payment_id, rzp_link_id, shop_id, cid, paise, method)
      VALUES (${p.paymentId}, ${p.ref}, ${p.shopId}, ${p.cid}, ${p.paise}, ${p.method})
      ON CONFLICT (rzp_payment_id) DO NOTHING RETURNING rzp_payment_id`) as unknown[]
    return fresh.length > 0
  },
  async markRef(store, ref, status) {
    if (store === 'qr') await sql`UPDATE qr_codes SET status = ${status} WHERE id = ${ref}`
    else await sql`UPDATE payment_links SET status = ${status} WHERE rzp_link_id = ${ref}`
  },
  async takeFromBalance(shopId, cid, paise) {
    const left = (await sql`UPDATE receivables SET balance_paise = balance_paise - ${paise}
      WHERE shop_id = ${shopId} AND cid = ${cid} RETURNING balance_paise, name, phone`) as { balance_paise: string; name: string; phone: string }[]
    return left[0] ? { balancePaise: Number(left[0].balance_paise), name: left[0].name, phone: left[0].phone } : null
  },
  async addPending(shopId, kind, body) {
    await sql`INSERT INTO pending_events (shop_id, kind, body) VALUES (${shopId}, ${kind}, ${JSON.stringify(body)}::jsonb)`
  },
}

export type BookResult =
  | { status: 'unknown' }
  | { status: 'duplicate' }
  | { status: 'booked'; shopId: string; cid: string; left: { balancePaise: number; name: string; phone: string } | null }

/**
 * Book one payment: the `payments` row (unique on the payment id) first, so a repeated delivery
 * stops there; then the link / QR status, the mirrored balance, and a 'payment' pending event the
 * phone adds to its ledger (and announces).
 */
export async function bookPayment(db: BookingDb, ev: Credited): Promise<BookResult> {
  const owner = await db.owner(ev.store, ev.ref)
  const shopId = owner?.shopId ?? ev.notes.shop_id ?? ev.notes.shop
  const cid = owner?.cid ?? ev.notes.cid
  if (!shopId || !cid) return { status: 'unknown' }
  const fresh = await db.insertPayment({ paymentId: ev.paymentId, ref: ev.ref, shopId, cid, paise: ev.paise, method: ev.method })
  if (!fresh) return { status: 'duplicate' }
  await db.markRef(ev.store, ev.ref, ev.partial ? 'partially_paid' : 'paid')
  const left = await db.takeFromBalance(shopId, cid, ev.paise)
  const day = istDay(new Date(ev.createdAt * 1000))
  await db.addPending(shopId, 'payment', {
    cid, paise: ev.paise, paymentId: ev.paymentId, day, method: ev.method, via: ev.via,
    ...(ev.via === 'qr' ? { qrId: ev.ref } : {}),
    ...(ev.partial ? { partial: true } : {}),
  })
  return { status: 'booked', shopId, cid, left }
}

export async function handleRazorpayWebhook(req: Request): Promise<Response> {
  try {
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
    const raw = await readText(req, 256 * 1024)
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? ''
    if (!secret) {
      log.error('razorpay_webhook_unconfigured', { fn: 'pay' })
      return json({ error: 'not configured' }, 503)
    }
    if (!verifyRazorpaySignature(raw, req.headers.get('x-razorpay-signature'), secret)) {
      log.warn('razorpay_bad_signature', { fn: 'pay' })
      return json({ error: 'bad signature' }, 401)
    }
    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch {
      return json({ error: 'bad json' }, 400)
    }
    const ev = creditedFrom(body)
    // other events (payment.failed, link expired, qr_code.closed, ...) are acknowledged and ignored
    if (!ev) return json({ ok: true, ignored: true })
    await ensureSchema()

    const r = await bookPayment(sqlBookingDb, ev)
    if (r.status === 'unknown') {
      log.warn('razorpay_unknown_ref', { fn: 'pay', via: ev.via })
      return json({ ok: true, ignored: true })
    }
    if (r.status === 'duplicate') return json({ ok: true, duplicate: true })
    log.info('payment_booked', { fn: 'pay', via: ev.via, paise: ev.paise, partial: ev.partial })

    // the receipt: best effort, the payment is booked either way
    if (r.left) {
      try {
        const shops = (await sql`SELECT name, lang FROM shops WHERE id = ${r.shopId}`) as { name: string; lang: string }[]
        const t = waTexts(shops[0]?.lang ?? 'hi')
        const remaining = Math.max(0, r.left.balancePaise) / 100
        await sendLogged(r.left.phone, t.receipt(r.left.name, ev.paise / 100, remaining, shops[0]?.name || 'Khata'), 'receipt', r.shopId, r.cid)
      } catch (e) {
        log.warn('receipt_failed', { fn: 'pay', error: e })
      }
    }
    return json({ ok: true })
  } catch (e) {
    const r = errorResponse(e)
    if (r) return r
    log.error('razorpay_webhook_failed', { fn: 'pay', error: e })
    // 5xx: Razorpay retries, and the payment id makes the retry safe
    return json({ error: 'server error' }, 500)
  }
}
