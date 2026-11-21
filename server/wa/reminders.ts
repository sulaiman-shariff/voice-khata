/**
 * Reminders on WhatsApp, each with a Razorpay link for what is owed.
 * - ensureLink: the customer's open payment link, or a new one
 * - sendLogged: send through Vonage and remember it (so a reply finds its shop)
 * - handleRemindersTick: the hourly automatic sweep (Cloud Scheduler -> POST /internal/reminders-tick)
 */
import { buildReminder } from '../../shared/reminder.js'
import { ensureSchema, json, randomHex, sql } from '../db.js'
import { log } from '../log.js'
import { cronAuthorized } from '../request.js'
import { services } from '../services.js'
import { dueForReminder } from './policy.js'
import { isLang, waTexts } from './texts.js'

/** a link stays valid this long, and is reused while it is */
export const LINK_DAYS = 7
/** smallest first part-payment a link accepts */
export const MIN_PARTIAL_PAISE = 1_000
/** at most this many reminders per sweep (rate limits; the next hour gets the rest) */
const MAX_PER_TICK = 50

/** A synced customer joined with their shop. */
export interface ReminderRow {
  shop_id: string
  cid: string
  name: string
  phone: string
  balance_paise: string | number
  shop_name: string
  lang: string
  signature?: string
}

export interface OpenLink {
  id: string
  shortUrl: string
}

/** A payment link for what the customer owes now: the open one when its amount still matches, else a new one. */
export async function ensureLink(r: ReminderRow, owedPaise = Number(r.balance_paise)): Promise<OpenLink | null> {
  const s = services()
  if (!s.createLink || owedPaise < 100) return null
  const open = (await sql`SELECT id, short_url FROM payment_links
    WHERE shop_id = ${r.shop_id} AND cid = ${r.cid} AND status = 'created' AND amount_paise = ${owedPaise}
      AND expires_at > now() + interval '1 hour'
    ORDER BY created_at DESC LIMIT 1`) as { id: string; short_url: string }[]
  if (open.length) return { id: open[0].id, shortUrl: open[0].short_url }
  const id = randomHex(12)
  const expires = new Date(s.now().getTime() + LINK_DAYS * 86_400_000)
  const link = await s.createLink({
    amountPaise: owedPaise,
    referenceId: id,
    description: `${r.shop_name || 'Khata'}: ${r.name}`,
    customer: { name: r.name, contact: r.phone },
    notes: { shop_id: r.shop_id, cid: r.cid },
    expireBy: expires,
    ...(owedPaise > MIN_PARTIAL_PAISE * 2 ? { minPartialPaise: MIN_PARTIAL_PAISE } : {}),
  })
  await sql`INSERT INTO payment_links (id, shop_id, cid, rzp_link_id, short_url, amount_paise, expires_at)
    VALUES (${id}, ${r.shop_id}, ${r.cid}, ${link.id}, ${link.short_url}, ${owedPaise}, ${expires.toISOString()})`
  log.info('payment_link_created', { fn: 'pay', paise: owedPaise })
  return { id, shortUrl: link.short_url }
}

/** Customers can answer 1 / 2 / 3 / STOP only when the inbound webhook is set up. */
export const repliesEnabled = (env = process.env) => !!(env.VONAGE_SIGNATURE_SECRET || env.VONAGE_WEBHOOK_TOKEN)

/** The reply menu goes just above the opt-out line (the message's last line). */
export function withMenu(text: string, lang: string): string {
  const lines = text.split('\n')
  lines.splice(lines.length - 1, 0, waTexts(lang).menu())
  return lines.join('\n')
}

/** Send and remember it (delivery status arrives later on /webhooks/vonage/status). */
export async function sendLogged(to: string, text: string, kind: string, shopId: string | null, cid: string | null): Promise<string> {
  const s = services()
  if (!s.sendWa) throw new Error('WhatsApp is not configured (VONAGE_* env)')
  const id = await s.sendWa(to, text)
  await sql`INSERT INTO wa_messages (id, shop_id, cid, phone, kind) VALUES (${id}, ${shopId}, ${cid}, ${to}, ${kind})
    ON CONFLICT (id) DO NOTHING`
  return id
}

/** One automatic reminder, worded exactly as the phone words it (shared/reminder.ts). */
export async function sendAutoReminder(r: ReminderRow): Promise<{ messageId: string; payUrl: string | null }> {
  let link: OpenLink | null = null
  try {
    link = await ensureLink(r)
  } catch (e) {
    // a reminder without a link still helps; the customer can reply 1 for one later
    log.warn('payment_link_failed', { fn: 'pay', error: e })
  }
  const lang = isLang(r.lang) ? r.lang : 'hi'
  let text = buildReminder({
    lang,
    shopName: r.shop_name || 'Khata',
    customerName: r.name,
    owedPaise: Number(r.balance_paise),
    payUrl: link?.shortUrl ?? null,
    signature: r.signature,
  })
  if (repliesEnabled()) text = withMenu(text, lang)
  const messageId = await sendLogged(r.phone, text, 'reminder', r.shop_id, r.cid)
  await sql`UPDATE receivables SET last_reminded_at = now() WHERE shop_id = ${r.shop_id} AND cid = ${r.cid}`
  // the phone stamps it too, so its reminders screen shows when this customer was last reminded
  await sql`INSERT INTO pending_events (shop_id, kind, body) VALUES (${r.shop_id}, 'reminded',
    ${JSON.stringify({ cid: r.cid, at: Date.now() })}::jsonb)`
  log.info('reminder_sent', { fn: 'wa', auto: true, withLink: !!link })
  return { messageId, payUrl: link?.shortUrl ?? null }
}

type Candidate = ReminderRow & { last_reminded_at: string | null; remind_every_days: number }

export async function handleRemindersTick(req: Request): Promise<Response> {
  if (!cronAuthorized(req)) return json({ error: 'unauthorized' }, 401)
  try {
    await ensureSchema()
    const dry = new URL(req.url).searchParams.get('dry') === '1'
    const now = services().now()
    const rows = (await sql`SELECT r.shop_id, r.cid, r.name, r.phone, r.balance_paise, r.last_reminded_at,
        s.name AS shop_name, s.lang, s.signature, s.remind_every_days
      FROM receivables r JOIN shops s ON s.id = r.shop_id
      WHERE s.auto_remind AND r.balance_paise > 0
        AND (r.last_reminded_at IS NULL OR r.last_reminded_at < now() - make_interval(days => s.remind_every_days))
        AND NOT EXISTS (SELECT 1 FROM wa_optouts o WHERE o.phone = r.phone)
      ORDER BY r.last_reminded_at NULLS FIRST
      LIMIT 500`) as Candidate[]
    const due = rows.filter((r) => dueForReminder({
      balancePaise: Number(r.balance_paise),
      lastRemindedAt: r.last_reminded_at ? new Date(r.last_reminded_at) : null,
      everyDays: r.remind_every_days,
    }, now)).slice(0, MAX_PER_TICK)
    if (dry) return json({ considered: rows.length, due: due.length })
    let sent = 0
    let failed = 0
    for (const r of due) {
      try {
        await sendAutoReminder(r)
        sent++
      } catch (e) {
        failed++
        log.warn('reminder_failed', { fn: 'wa', error: e })
      }
    }
    log.info('reminders_tick', { fn: 'wa', considered: rows.length, due: due.length, sent, failed })
    return json({ considered: rows.length, due: due.length, sent, failed })
  } catch (e) {
    log.error('reminders_tick_failed', { fn: 'wa', error: e })
    return json({ error: 'server error' }, 500)
  }
}
