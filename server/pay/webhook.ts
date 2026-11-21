/**
 * POST /webhooks/razorpay — a customer paid (all or part of) a link we sent.
 * Signed with RAZORPAY_WEBHOOK_SECRET. Razorpay retries until it gets a 2xx, so every step is
 * idempotent on the payment id: one payment is booked once, however often it is delivered.
 */
import { json, sql, ensureSchema } from '../db.js'
import { log } from '../log.js'
import { readText, errorResponse } from '../request.js'
import { istDay } from '../wa/policy.js'
import { sendLogged } from '../wa/reminders.js'
import { waTexts } from '../wa/texts.js'
import { parseLinkPaid, verifyRazorpaySignature } from './razorpay.js'

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
    const ev = parseLinkPaid(body)
    // other events (payment.failed, link expired, ...) are acknowledged and ignored
    if (!ev) return json({ ok: true, ignored: true })
    await ensureSchema()

    const links = (await sql`SELECT shop_id, cid FROM payment_links WHERE rzp_link_id = ${ev.linkId}`) as { shop_id: string; cid: string }[]
    const shopId = links[0]?.shop_id ?? ev.notes.shop_id
    const cid = links[0]?.cid ?? ev.notes.cid
    if (!shopId || !cid) {
      log.warn('razorpay_unknown_link', { fn: 'pay' })
      return json({ ok: true, ignored: true })
    }
    const fresh = (await sql`INSERT INTO payments (rzp_payment_id, rzp_link_id, shop_id, cid, paise, method)
      VALUES (${ev.paymentId}, ${ev.linkId}, ${shopId}, ${cid}, ${ev.paymentPaise}, ${ev.method})
      ON CONFLICT (rzp_payment_id) DO NOTHING RETURNING rzp_payment_id`) as unknown[]
    if (!fresh.length) return json({ ok: true, duplicate: true })

    const day = istDay(new Date(ev.createdAt * 1000))
    await sql`UPDATE payment_links SET status = ${ev.event === 'payment_link.paid' ? 'paid' : 'partially_paid'} WHERE rzp_link_id = ${ev.linkId}`
    const left = (await sql`UPDATE receivables SET balance_paise = balance_paise - ${ev.paymentPaise}
      WHERE shop_id = ${shopId} AND cid = ${cid} RETURNING balance_paise, name, phone`) as { balance_paise: string; name: string; phone: string }[]
    await sql`INSERT INTO pending_events (shop_id, kind, body) VALUES (${shopId}, 'payment',
      ${JSON.stringify({ cid, paise: ev.paymentPaise, paymentId: ev.paymentId, day, method: ev.method })}::jsonb)`
    log.info('payment_booked', { fn: 'pay', paise: ev.paymentPaise, partial: ev.event !== 'payment_link.paid' })

    // the receipt: best effort, the payment is booked either way
    if (left.length) {
      try {
        const shops = (await sql`SELECT name, lang FROM shops WHERE id = ${shopId}`) as { name: string; lang: string }[]
        const t = waTexts(shops[0]?.lang ?? 'hi')
        const remaining = Math.max(0, Number(left[0].balance_paise)) / 100
        await sendLogged(left[0].phone, t.receipt(left[0].name, ev.paymentPaise / 100, remaining, shops[0]?.name || 'Khata'), 'receipt', shopId, cid)
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
