/**
 * Counter QR: the customer is at the counter, the shopkeeper says "Ramesh ka QR dikhao" (or taps),
 * and the phone shows a QR for exactly that amount. When it is paid, the Razorpay webhook books it
 * (server/pay/webhook.ts) and the phone announces it.
 *
 * Two kinds, the first the account allows:
 *  - mode 'qr':   a Razorpay QR code (QR Codes API: single use, fixed amount), paid in any UPI app
 *  - mode 'link': a Razorpay Payment Link for the exact amount, no part payments, expiring in 20 min,
 *                 notes.source = 'counter'; the phone draws `linkUrl` as a QR, the customer scans it
 *                 and pays by UPI on Razorpay's page. Used when the account has no QR Codes.
 *
 *   POST   /api/qr  {cid, paise, name?}  -> {mode:'qr', id, imageUrl, closeBy, paise}
 *                                        |  {mode:'link', id, linkUrl, closeBy, paise}
 *                                        |  {fallback: true, reason}   (no Razorpay at all, or both failed)
 *   GET    /api/qr?id=qr_…|plink_…       -> {id, status}
 *   DELETE /api/qr?id=…                  -> {ok}  (paid in cash / sheet closed: the QR is closed, the link cancelled)
 *
 * `{fallback: true}` is a 200: the phone shows a plain upi:// QR (src/lib/pay.ts) and asks "Paid?" by hand.
 * Authorised like every shop call: `Authorization: Bearer <shopId>.<secret>`.
 */
import { ensureSchema, hasDb, json, randomHex, sql } from '../db.js'
import { log } from '../log.js'
import { errorResponse, readJson } from '../request.js'
import { authShop } from '../shop/auth.js'
import {
  QR_OPEN_MS, cancelPaymentLink, closeQr, createPaymentLink, createQr, qrNotEnabled, razorpayKeys,
  type LinkRequest, type PaymentLink, type QrCode, type QrRequest,
} from './razorpay.js'

/** Razorpay wants a link's expire_by at least 15 minutes ahead; 20 leaves room for clock skew. */
export const COUNTER_LINK_MS = 20 * 60_000
/** after a 'not enabled' answer, go straight to links for this long (no failing QR call per request) */
const QR_OFF_RETRY_MS = 60 * 60_000

type Kind = 'qr' | 'link'

/** The tables behind the endpoint, behind a seam for tests. */
export interface QrStore {
  ensure(): Promise<void>
  shopName(shopId: string): Promise<string>
  saveQr(r: { id: string; shopId: string; cid: string; paise: number; closeBy: Date }): Promise<void>
  saveLink(r: { id: string; shopId: string; cid: string; rzpLinkId: string; shortUrl: string; paise: number; expiresAt: Date }): Promise<void>
  /** status of this shop's QR code or counter link, null when it is not theirs */
  status(shopId: string, kind: Kind, id: string): Promise<string | null>
  markClosed(kind: Kind, id: string): Promise<void>
}

export interface QrDeps {
  /** null when Razorpay keys are not set */
  createQr: ((r: QrRequest) => Promise<QrCode>) | null
  closeQr: ((id: string) => Promise<void>) | null
  createLink: ((r: LinkRequest) => Promise<PaymentLink>) | null
  cancelLink: ((id: string) => Promise<void>) | null
  authShop: (req: Request) => Promise<string | null>
  /** null when there is no database */
  store: QrStore | null
  now: () => Date
}

export const sqlQrStore: QrStore = {
  ensure: () => ensureSchema(),
  async shopName(shopId) {
    const rows = (await sql`SELECT name FROM shops WHERE id = ${shopId}`) as { name: string }[]
    return rows[0]?.name || 'Khata'
  },
  async saveQr(r) {
    await sql`INSERT INTO qr_codes (id, shop_id, cid, paise, close_by) VALUES (${r.id}, ${r.shopId}, ${r.cid}, ${r.paise}, ${r.closeBy.toISOString()})
      ON CONFLICT (id) DO NOTHING`
  },
  async saveLink(r) {
    await sql`INSERT INTO payment_links (id, shop_id, cid, rzp_link_id, short_url, amount_paise, expires_at)
      VALUES (${r.id}, ${r.shopId}, ${r.cid}, ${r.rzpLinkId}, ${r.shortUrl}, ${r.paise}, ${r.expiresAt.toISOString()})`
  },
  async status(shopId, kind, id) {
    const rows = (kind === 'qr'
      ? await sql`SELECT status FROM qr_codes WHERE id = ${id} AND shop_id = ${shopId}`
      : await sql`SELECT status FROM payment_links WHERE rzp_link_id = ${id} AND shop_id = ${shopId}`) as { status: string }[]
    return rows[0]?.status ?? null
  },
  async markClosed(kind, id) {
    if (kind === 'qr') await sql`UPDATE qr_codes SET status = 'closed' WHERE id = ${id} AND status = 'active'`
    else await sql`UPDATE payment_links SET status = 'cancelled' WHERE rzp_link_id = ${id} AND status = 'created'`
  },
}

export function envQrDeps(env = process.env): QrDeps {
  const keys = razorpayKeys(env)
  return {
    createQr: keys ? (r) => createQr(keys, r) : null,
    closeQr: keys ? (id) => closeQr(keys, id) : null,
    createLink: keys ? (r) => createPaymentLink(keys, r) : null,
    cancelLink: keys ? (id) => cancelPaymentLink(keys, id) : null,
    authShop,
    store: hasDb() ? sqlQrStore : null,
    now: () => new Date(),
  }
}

const QR_ID = /^qr_[A-Za-z0-9]{6,40}$/
const LINK_ID = /^plink_[A-Za-z0-9]{6,40}$/
const MAX_PAISE = 1e9 // ₹1 crore
const OPEN = { qr: 'active', link: 'created' } as const

let qrOffUntil = 0
/** Tests only. */
export const resetQrOff = () => { qrOffUntil = 0 }

export async function handleQr(req: Request, deps: QrDeps = envQrDeps()): Promise<Response> {
  try {
    const store = deps.store
    if (!store) return json({ fallback: true, reason: 'unconfigured' })
    await store.ensure()
    const shopId = await deps.authShop(req)
    if (!shopId) return json({ error: 'unauthorized' }, 401)

    if (req.method === 'GET' || req.method === 'DELETE') {
      const id = new URL(req.url).searchParams.get('id') ?? ''
      const kind: Kind | null = QR_ID.test(id) ? 'qr' : LINK_ID.test(id) ? 'link' : null
      if (!kind) return json({ error: 'bad id' }, 400)
      const status = await store.status(shopId, kind, id)
      if (status === null) return json({ error: 'not found' }, 404)
      if (req.method === 'GET') return json({ id, status })
      if (status === OPEN[kind]) {
        try {
          await (kind === 'qr' ? deps.closeQr : deps.cancelLink)?.(id)
        } catch (e) {
          log.warn('qr_close_failed', { fn: 'qr', kind, error: e })
        }
        await store.markClosed(kind, id)
      }
      return json({ ok: true })
    }
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

    const b = await readJson<{ cid?: unknown; paise?: unknown; name?: unknown }>(req, 4096)
    const cid = typeof b?.cid === 'string' && b.cid.length > 0 && b.cid.length <= 64 ? b.cid : null
    const paise = typeof b?.paise === 'number' && Number.isInteger(b.paise) && b.paise >= 100 && b.paise <= MAX_PAISE ? b.paise : null
    if (!cid || !paise) return json({ error: 'bad request' }, 400)
    if (!deps.createQr && !deps.createLink) return json({ fallback: true, reason: 'unconfigured' })
    const name = typeof b.name === 'string' ? [...b.name].map((ch) => (ch.charCodeAt(0) < 32 ? ' ' : ch)).join('').trim().slice(0, 60) : ''
    const shopName = await store.shopName(shopId)
    const description = name ? `${shopName}: ${name}` : shopName
    const now = deps.now()

    // 1. a Razorpay QR code, unless this account said it has none
    if (deps.createQr && now.getTime() >= qrOffUntil) {
      const closeBy = new Date(now.getTime() + QR_OPEN_MS)
      try {
        const qr = await deps.createQr({ amountPaise: paise, name: shopName, description, notes: { shop_id: shopId, cid }, closeBy })
        const closeAt = qr.close_by ? new Date(qr.close_by * 1000) : closeBy
        await store.saveQr({ id: qr.id, shopId, cid, paise, closeBy: closeAt })
        log.info('qr_created', { fn: 'qr', mode: 'qr', paise })
        return json({ mode: 'qr', id: qr.id, imageUrl: qr.image_url, closeBy: closeAt.getTime(), paise })
      } catch (e) {
        if (qrNotEnabled(e)) qrOffUntil = now.getTime() + QR_OFF_RETRY_MS
        log.warn(qrNotEnabled(e) ? 'qr_not_enabled' : 'qr_create_failed', { fn: 'qr', error: e })
      }
    }
    // 2. a payment link for the exact amount, drawn as a QR on the phone; the link webhook books it
    if (deps.createLink) {
      const expiresAt = new Date(now.getTime() + COUNTER_LINK_MS)
      const ref = randomHex(12)
      try {
        const link = await deps.createLink({
          amountPaise: paise, referenceId: ref, description,
          notes: { shop_id: shopId, cid, source: 'counter' }, expireBy: expiresAt,
        })
        await store.saveLink({ id: ref, shopId, cid, rzpLinkId: link.id, shortUrl: link.short_url, paise, expiresAt })
        log.info('qr_created', { fn: 'qr', mode: 'link', paise })
        return json({ mode: 'link', id: link.id, linkUrl: link.short_url, closeBy: expiresAt.getTime(), paise })
      } catch (e) {
        log.error('counter_link_failed', { fn: 'qr', error: e })
      }
    }
    return json({ fallback: true, reason: 'failed' })
  } catch (e) {
    const r = errorResponse(e)
    if (r) return r
    log.error('qr_failed', { fn: 'qr', error: e })
    return json({ error: 'server error' }, 500)
  }
}
