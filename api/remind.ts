/**
 * POST /api/remind {to, body, vars?} -> sends one WhatsApp reminder through Twilio.
 * GET  /api/remind -> {configured} so the app can fall back to a wa.me share link.
 *
 * The ledger stays on the phone: the phone builds the polite text (shared/replies.ts
 * reminderText) and sends only the number and the message. Nothing is stored here.
 * Abuse guard: our own pages only (Origin), Indian or E.164 numbers, short text, and a per-IP
 * hourly cap, since the Twilio account pays for every message.
 */
import { cors } from '../server/http.js'
import { log, logged } from '../server/log.js'
import { json } from '../server/db.js'
import { sendWhatsApp, toE164, twilioConfigured } from '../server/remind/twilio.js'

const MAX_PER_HOUR = 60
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
  if (req.method === 'GET') return json({ configured: twilioConfigured() })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  if (!twilioConfigured()) return json({ error: 'twilio not configured' }, 503)
  let b: { to?: unknown; body?: unknown; vars?: { name?: unknown; amount?: unknown; shop?: unknown } }
  try {
    b = (await req.json()) as typeof b
  } catch {
    return json({ error: 'bad json' }, 400)
  }
  const to = typeof b.to === 'string' ? toE164(b.to) : null
  if (!to) return json({ error: 'bad phone number' }, 400)
  if (typeof b.body !== 'string' || !b.body.trim() || b.body.length > 1000) return json({ error: 'bad message' }, 400)
  const ip = (req.headers.get('x-forwarded-for') ?? 'local').split(',')[0].trim()
  if (!allow(ip)) return json({ error: 'too many reminders, try in an hour' }, 429)
  const v = b.vars
  const vars = v && typeof v.name === 'string' && typeof v.amount === 'string' && typeof v.shop === 'string'
    ? { name: v.name.slice(0, 60), amount: v.amount.slice(0, 20), shop: v.shop.slice(0, 80) } : undefined
  try {
    const r = await sendWhatsApp(to, b.body.trim(), vars)
    log.info('remind_sent', { ok: r.ok, status: r.status, code: r.code, error: r.error, to: `…${to.slice(-4)}` })
    return json(r, r.ok ? 200 : 502)
  } catch (e) {
    log.error('remind_failed', { error: e })
    return json({ ok: false, error: 'could not reach Twilio' }, 502)
  }
}

export default { fetch: cors(logged('remind', handle)) }
