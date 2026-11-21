/**
 * POST /api/remind {to, body, vars?, cid?, owedPaise?, fallbackPayUrl?} -> sends one WhatsApp reminder
 *   through Vonage or Twilio.
 * GET  /api/remind -> {configured, provider, payments} so the app can fall back to a wa.me share link,
 *   and knows whether to ask for a Razorpay link.
 *
 * A registered shop (Authorization: Bearer <shopId>.<secret>, src/lib/shop.ts) also sends `cid` and
 * `owedPaise`: the server swaps PAY_LINK in the text for that customer's Razorpay link, adds the reply
 * menu, and remembers the message so the customer's reply ("1", "STOP") finds this shop.
 *
 * The ledger stays on the phone: the phone builds the polite text (shared/replies.ts
 * reminderText) and sends only the number and the message. Nothing is stored here.
 * Abuse guard: our own pages only (Origin), Indian or E.164 numbers, short text, and a per-IP
 * hourly cap, since the Twilio account pays for every message.
 */
import { cors } from '../server/http.js'
import { log, logged } from '../server/log.js'
import { sendWhatsApp, toE164, twilioConfigured } from '../server/remind/twilio.js'
import { sendVonageWhatsApp, vonageConfigured } from '../server/remind/vonage.js'
import { PAY_LINK } from '../shared/reminder.js'
import { ensureSchema, hasDb, json, sql } from '../server/db.js'
import { razorpayKeys } from '../server/pay/razorpay.js'
import { authShop } from '../server/shop/auth.js'
import { ensureLink, repliesEnabled, withMenu, type ReminderRow } from '../server/wa/reminders.js'

/** Vonage when its keys are set (the free sandbox sends any text), else Twilio, else none. */
export const remindProvider = (): 'vonage' | 'twilio' | null => (vonageConfigured() ? 'vonage' : twilioConfigured() ? 'twilio' : null)

const MAX_PER_HOUR = 60
const NL = '\n'
const sent = new Map<string, number[]>()

function allow(ip: string): boolean {
  const now = Date.now()
  const recent = (sent.get(ip) ?? []).filter((t) => now - t < 3_600_000)
  if (recent.length >= MAX_PER_HOUR) return false
  recent.push(now)
  sent.set(ip, recent)
  return true
}

export async function handle(req: Request): Promise<Response> {
  const provider = remindProvider()
  if (req.method === 'GET') return json({ configured: !!provider, provider, payments: !!razorpayKeys() && hasDb() })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  if (!provider) return json({ error: 'no WhatsApp sender configured (Vonage or Twilio)' }, 503)
  let b: {
    to?: unknown; body?: unknown; vars?: { name?: unknown; amount?: unknown; shop?: unknown }
    cid?: unknown; owedPaise?: unknown; fallbackPayUrl?: unknown
  }
  try {
    b = (await req.json()) as typeof b
  } catch {
    return json({ error: 'bad json' }, 400)
  }
  const to = typeof b.to === 'string' ? toE164(b.to) : null
  if (!to) return json({ error: 'bad phone number' }, 400)
  if (typeof b.body !== 'string' || !b.body.trim() || b.body.length > 1000) return json({ error: 'bad message' }, 400)
  let text = b.body.trim()
  // a registered shop's customer: Razorpay link, reply menu, and a record a reply can find
  let shop: { row: ReminderRow } | null = null
  if (req.headers.get('authorization') && typeof b.cid === 'string' && hasDb()) {
    await ensureSchema()
    const shopId = await authShop(req)
    if (!shopId) return json({ error: 'unauthorized' }, 401)
    const rows = (await sql`SELECT s.id AS shop_id, s.name AS shop_name, s.lang, r.name, r.phone, r.balance_paise
      FROM shops s LEFT JOIN receivables r ON r.shop_id = s.id AND r.cid = ${b.cid} WHERE s.id = ${shopId}`) as (Omit<ReminderRow, 'cid'> & { name: string | null })[]
    const optedOut = (await sql`SELECT 1 FROM wa_optouts WHERE phone = ${to.replace(/\D/g, '')}`) as unknown[]
    if (optedOut.length) return json({ ok: false, error: 'this customer replied STOP' }, 409)
    const r = rows[0]
    shop = { row: { ...r, cid: b.cid, name: r.name ?? (typeof b.vars?.name === 'string' ? b.vars.name : 'Customer'), phone: to.replace(/\D/g, '') } }
  }
  if (text.includes(PAY_LINK)) {
    const owed = typeof b.owedPaise === 'number' && Number.isInteger(b.owedPaise) && b.owedPaise > 0 && b.owedPaise < 1e10 ? b.owedPaise : 0
    let url: string | null = null
    if (shop && owed) {
      try {
        url = (await ensureLink(shop.row, owed))?.shortUrl ?? null
      } catch (e) {
        log.warn('payment_link_failed', { fn: 'remind', error: e })
      }
    }
    const fallback = typeof b.fallbackPayUrl === 'string' && /^https:\/\/\S{1,500}$/.test(b.fallbackPayUrl) ? b.fallbackPayUrl : null
    url ??= fallback
    // no link at all: drop the line rather than send a placeholder
    text = url ? text.replace(PAY_LINK, url) : text.split(NL).filter((l) => !l.includes(PAY_LINK)).join(NL)
  }
  if (shop && provider === 'vonage' && repliesEnabled()) text = withMenu(text, shop.row.lang)
  const ip = (req.headers.get('x-forwarded-for') ?? 'local').split(',')[0].trim()
  if (!allow(ip)) return json({ error: 'too many reminders, try in an hour' }, 429)
  const v = b.vars
  const vars = v && typeof v.name === 'string' && typeof v.amount === 'string' && typeof v.shop === 'string'
    ? { name: v.name.slice(0, 60), amount: v.amount.slice(0, 20), shop: v.shop.slice(0, 80) } : undefined
  try {
    const r = provider === 'vonage' ? await sendVonageWhatsApp(to, text) : await sendWhatsApp(to, text, vars)
    log.info('remind_sent', { provider, ok: r.ok, status: r.status, code: r.code, error: r.error, to: `…${to.slice(-4)}`, shop: !!shop })
    if (r.ok && shop) {
      const phone = to.replace(/\D/g, '')
      if (r.sid) await sql`INSERT INTO wa_messages (id, shop_id, cid, phone, kind) VALUES (${r.sid}, ${shop.row.shop_id}, ${shop.row.cid}, ${phone}, 'reminder') ON CONFLICT (id) DO NOTHING`
      await sql`UPDATE receivables SET last_reminded_at = now() WHERE shop_id = ${shop.row.shop_id} AND cid = ${shop.row.cid}`
    }
    return json(r, r.ok ? 200 : 502)
  } catch (e) {
    log.error('remind_failed', { error: e })
    return json({ ok: false, error: `could not reach ${provider}` }, 502)
  }
}

export default { fetch: cors(logged('remind', handle)) }
