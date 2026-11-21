/**
 * Vonage webhooks.
 *   POST /webhooks/vonage/inbound  a customer wrote back: 1 pay, 2 balance, 3 wrong, STOP, or a
 *                                  promise ("kal de dunga") — typed or as a voice note (≤ 30 s, transcribed)
 *   POST /webhooks/vonage/status   delivery receipts for what we sent
 * Signed JWTs when VONAGE_SIGNATURE_SECRET is set; otherwise the URL must carry ?k=VONAGE_WEBHOOK_TOKEN
 * (the Vonage sandbox does not sign).
 */
import { json, sql, ensureSchema } from '../db.js'
import { log } from '../log.js'
import { readText, errorResponse } from '../request.js'
import { waIntent, waPromise } from './intent.js'
import { istDay } from './policy.js'
import { ensureLink, sendLogged, type ReminderRow } from './reminders.js'
import { promiseNoted, waTexts } from './texts.js'
import { voiceNoteText } from './voicenote.js'
import { parseInbound, verifyVonageJwt } from '../remind/vonage.js'

function authorized(req: Request, raw: string, env = process.env): boolean {
  const secret = env.VONAGE_SIGNATURE_SECRET ?? ''
  if (secret) return verifyVonageJwt(req.headers.get('authorization'), raw, secret)
  const token = env.VONAGE_WEBHOOK_TOKEN ?? ''
  return !!token && new URL(req.url).searchParams.get('k') === token
}

type Row = ReminderRow & { opted_out: boolean }

/** The shop and customer this phone is talking to: whoever messaged them last, else any shop that knows them. */
async function contextFor(phone: string): Promise<Row | null> {
  const rows = (await sql`SELECT r.shop_id, r.cid, r.name, r.phone, r.balance_paise, s.name AS shop_name, s.lang,
      EXISTS (SELECT 1 FROM wa_optouts o WHERE o.phone = r.phone) AS opted_out
    FROM receivables r JOIN shops s ON s.id = r.shop_id
    LEFT JOIN LATERAL (SELECT max(created_at) AS at FROM wa_messages m
      WHERE m.phone = r.phone AND m.shop_id = r.shop_id AND m.cid = r.cid AND m.kind <> 'inbound') last ON true
    WHERE r.phone = ${phone}
    ORDER BY last.at DESC NULLS LAST, r.updated_at DESC
    LIMIT 1`) as Row[]
  return rows[0] ?? null
}

export async function handleVonageInbound(req: Request): Promise<Response> {
  try {
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
    const raw = await readText(req, 64 * 1024)
    if (!authorized(req, raw)) {
      log.warn('vonage_unauthorized', { fn: 'wa' })
      return json({ error: 'unauthorized' }, 401)
    }
    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch {
      return json({ error: 'bad json' }, 400)
    }
    const m = parseInbound(body)
    if (!m) return json({ ok: true, ignored: true })
    await ensureSchema()
    // Vonage retries a webhook that was slow: answer each message once
    const fresh = (await sql`INSERT INTO wa_messages (id, phone, kind, status) VALUES (${m.messageId}, ${m.from}, 'inbound', 'received')
      ON CONFLICT (id) DO NOTHING RETURNING id`) as unknown[]
    if (!fresh.length) return json({ ok: true, duplicate: true })

    const ctx = await contextFor(m.from)
    await sql`UPDATE wa_messages SET shop_id = ${ctx?.shop_id ?? null}, cid = ${ctx?.cid ?? null} WHERE id = ${m.messageId}`
    // a voice note from a known customer: its words, then the same reading as typed text
    let text = m.text
    let voice: string | null = null
    if (m.audioUrl && ctx) {
      const v = await voiceNoteText(m.audioUrl, ctx.lang)
      if ('text' in v) text = v.text
      voice = 'text' in v ? 'transcribed' : v.skipped
    }
    const intent = waIntent(text, m.payload)
    // "kal de dunga" / "will pay tomorrow": a promise, before 'pay' (which would send a link)
    const promise = ctx && intent !== 'stop' && intent !== 'dispute' ? waPromise(text, new Date(Date.now() + 5.5 * 3600_000).getUTCDay()) : null
    log.info('wa_inbound', { fn: 'wa', intent: promise ? 'promise' : intent, known: !!ctx, voice })
    const reply = (text: string) => sendLogged(m.from, text, 'reply', ctx?.shop_id ?? null, ctx?.cid ?? null)

    if (intent === 'stop') {
      await sql`INSERT INTO wa_optouts (phone) VALUES (${m.from}) ON CONFLICT (phone) DO NOTHING`
      if (ctx) await sql`INSERT INTO pending_events (shop_id, kind, body) VALUES (${ctx.shop_id}, 'optout', ${JSON.stringify({ cid: ctx.cid })}::jsonb)`
      await reply(waTexts(ctx?.lang ?? 'hi').stopped())
      return json({ ok: true })
    }
    if (!ctx) {
      await reply(waTexts('hi').unknown())
      return json({ ok: true })
    }
    const t = waTexts(ctx.lang)
    const owed = Number(ctx.balance_paise)
    const shop = ctx.shop_name || 'Khata'
    if (promise) {
      const day = istDay(new Date(Date.now() + promise.dayOffset * 86_400_000))
      await sql`INSERT INTO pending_events (shop_id, kind, body) VALUES (${ctx.shop_id}, 'promise_suggestion',
        ${JSON.stringify({ cid: ctx.cid, day, ...(promise.paise ? { paise: promise.paise } : {}), text: text.slice(0, 300), voice: !!m.audioUrl })}::jsonb)`
      await reply(promiseNoted(ctx.lang, shop))
      return json({ ok: true })
    }
    if (intent === 'dispute') {
      await sql`INSERT INTO pending_events (shop_id, kind, body) VALUES (${ctx.shop_id}, 'dispute',
        ${JSON.stringify({ cid: ctx.cid, text: text.slice(0, 500) })}::jsonb)`
      await reply(t.dispute(shop))
      return json({ ok: true })
    }
    if (intent === 'pay' || intent === 'balance') {
      if (owed <= 0) {
        await reply(t.balance(ctx.name, 0, shop))
        return json({ ok: true })
      }
      let url: string | null = null
      try {
        url = (await ensureLink(ctx))?.shortUrl ?? null
      } catch (e) {
        log.warn('payment_link_failed', { fn: 'pay', error: e })
      }
      const lines = intent === 'balance' ? [t.balance(ctx.name, owed / 100, shop)] : []
      lines.push(url ? t.payLine(owed / 100, url) : t.payFailed())
      if (intent === 'balance') lines.push(t.menu())
      await reply(lines.join('\n\n'))
      return json({ ok: true })
    }
    await reply([t.balance(ctx.name, Math.max(0, owed) / 100, shop), t.menu()].join('\n\n'))
    return json({ ok: true })
  } catch (e) {
    const r = errorResponse(e)
    if (r) return r
    log.error('vonage_inbound_failed', { fn: 'wa', error: e })
    return json({ error: 'server error' }, 500)
  }
}

const STATUSES = new Set(['submitted', 'delivered', 'read', 'rejected', 'undeliverable', 'failed'])

export async function handleVonageStatus(req: Request): Promise<Response> {
  try {
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
    const raw = await readText(req, 64 * 1024)
    if (!authorized(req, raw)) return json({ error: 'unauthorized' }, 401)
    let b: { message_uuid?: string; status?: string; error?: { title?: string; detail?: string } }
    try {
      b = JSON.parse(raw)
    } catch {
      return json({ error: 'bad json' }, 400)
    }
    if (!b?.message_uuid || !b.status || !STATUSES.has(b.status)) return json({ ok: true, ignored: true })
    await ensureSchema()
    await sql`UPDATE wa_messages SET status = ${b.status}, updated_at = now() WHERE id = ${b.message_uuid}`
    if (b.status === 'rejected' || b.status === 'undeliverable' || b.status === 'failed') {
      log.warn('wa_not_delivered', { fn: 'wa', status: b.status, reason: String(b.error?.title ?? b.error?.detail ?? '').slice(0, 200) })
    }
    return json({ ok: true })
  } catch (e) {
    const r = errorResponse(e)
    if (r) return r
    log.error('vonage_status_failed', { fn: 'wa', error: e })
    return json({ error: 'server error' }, 500)
  }
}
