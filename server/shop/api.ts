/**
 * What the shopkeeper's phone calls:
 *   POST /api/shop/register      -> { shopId, secret }            (once, on first use)
 *   PUT  /api/receivables        mirror of opted-in customers who owe (replaces the whole set)
 *   GET  /api/pending            payments and replies that happened off the phone
 *   POST /api/pending            { ids } the phone has added them to its ledger
 * Sending a reminder now stays POST /api/remind (api/remind.ts), which adds the Razorpay link for a
 * registered shop.
 */
import { normalizePhone } from '../../shared/phone.js'
import { ensureSchema, json, sql } from '../db.js'
import { log } from '../log.js'
import { DAY_RE, errorResponse, readJson } from '../request.js'
import { isLang } from '../wa/texts.js'
import { authShop, registerShop } from './auth.js'

const MAX_CUSTOMERS = 5000
const registrations = new Map<string, { n: number; since: number }>()
/** a phone registers once; this only stops a script minting shops in a loop */
const MAX_REGISTRATIONS_PER_HOUR = 20

function cleanName(x: unknown, max: number): string | null {
  if (typeof x !== 'string') return null
  const s = cleanLine(x)
  return s && s.length <= max ? s : null
}

/** one line of plain text: control characters become spaces */
const cleanLine = (x: string) => x.replace(/[\u0000-\u001f]/g, ' ').trim()

export async function handleRegister(req: Request, ip = ''): Promise<Response> {
  try {
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
    const now = Date.now()
    const r = registrations.get(ip)
    if (r && now - r.since < 3600_000 && r.n >= MAX_REGISTRATIONS_PER_HOUR) return json({ error: 'too many' }, 429)
    registrations.set(ip, r && now - r.since < 3600_000 ? { n: r.n + 1, since: r.since } : { n: 1, since: now })
    const b = await readJson<{ name?: unknown; lang?: unknown }>(req, 2048)
    await ensureSchema()
    const out = await registerShop(cleanName(b?.name, 60) ?? '', isLang(b?.lang) ? b.lang : 'hi')
    log.info('shop_registered', { fn: 'shop' })
    return json(out)
  } catch (e) {
    return errorResponse(e) ?? fail('register', e)
  }
}

interface InCustomer {
  cid: string
  name: string
  phone: string
  balance: number
  promise_day: string | null
  oldest_unpaid_day: string | null
  due_day: string | null
  plan_next_day: string | null
  plan_part_paise: number | null
}

function parseCustomers(xs: unknown): InCustomer[] | null {
  if (!Array.isArray(xs) || xs.length > MAX_CUSTOMERS) return null
  const out: InCustomer[] = []
  const seen = new Set<string>()
  for (const x of xs as Record<string, unknown>[]) {
    if (!x || typeof x !== 'object') return null
    const cid = typeof x.cid === 'string' && x.cid.length > 0 && x.cid.length <= 64 ? x.cid : null
    const name = cleanName(x.name, 80)
    const phone = normalizePhone(typeof x.phone === 'string' ? x.phone : null)
    const bal = x.balancePaise
    if (!cid || !name || !phone || seen.has(cid)) return null
    if (typeof bal !== 'number' || !Number.isInteger(bal) || Math.abs(bal) >= 1e11) return null
    const day = (d: unknown) => (typeof d === 'string' && DAY_RE.test(d) ? d : null)
    seen.add(cid)
    const part = x.planPartPaise
    const planPart = typeof part === 'number' && Number.isInteger(part) && part > 0 && part < 1e11 ? part : null
    out.push({
      cid, name, phone, balance: bal, promise_day: day(x.promiseDay), oldest_unpaid_day: day(x.oldestUnpaidDay),
      due_day: day(x.dueDay), plan_next_day: planPart ? day(x.planNextDay) : null, plan_part_paise: planPart && day(x.planNextDay) ? planPart : null,
    })
  }
  return out
}

export async function handleReceivables(req: Request): Promise<Response> {
  try {
    if (req.method !== 'PUT') return json({ error: 'method not allowed' }, 405)
    await ensureSchema()
    const shopId = await authShop(req)
    if (!shopId) return json({ error: 'unauthorized' }, 401)
    const b = await readJson<{
      shopName?: unknown; lang?: unknown; signature?: unknown; autoRemind?: unknown; remindEveryDays?: unknown; customers?: unknown
    }>(req, 2 * 1024 * 1024)
    const rows = parseCustomers(b?.customers)
    if (!rows) return json({ error: 'bad customers' }, 400)
    // the shop's own settings ride along: the hourly sweep words and times reminders exactly as the phone would
    const shopName = cleanName(b.shopName, 60)
    const lang = isLang(b.lang) ? b.lang : null
    const signature = typeof b.signature === 'string' ? cleanLine(b.signature).trim().slice(0, 200) : null
    const auto = typeof b.autoRemind === 'boolean' ? b.autoRemind : null
    const every = typeof b.remindEveryDays === 'number' && Number.isInteger(b.remindEveryDays) && b.remindEveryDays >= 1 && b.remindEveryDays <= 90 ? b.remindEveryDays : null
    await sql`UPDATE shops SET name = COALESCE(${shopName}, name), lang = COALESCE(${lang}, lang),
      signature = COALESCE(${signature}, signature), auto_remind = COALESCE(${auto}, auto_remind),
      remind_every_days = COALESCE(${every}, remind_every_days) WHERE id = ${shopId}`
    // A payment that arrived on Razorpay but is not yet in the phone's ledger is taken off what the
    // phone says, so a sync in that window cannot put the old balance back and trigger a reminder.
    await sql`
      WITH incoming AS (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
          AS x(cid text, name text, phone text, balance bigint, promise_day text, oldest_unpaid_day text,
            due_day text, plan_next_day text, plan_part_paise bigint)
      ), unacked AS (
        SELECT body->>'cid' AS cid, SUM((body->>'paise')::bigint) AS paise FROM pending_events
        WHERE shop_id = ${shopId} AND kind = 'payment' AND acked_at IS NULL GROUP BY 1
      )
      INSERT INTO receivables (shop_id, cid, name, phone, balance_paise, promise_day, oldest_unpaid_day, due_day, plan_next_day, plan_part_paise, updated_at)
      SELECT ${shopId}, i.cid, i.name, i.phone, i.balance - COALESCE(u.paise, 0), i.promise_day, i.oldest_unpaid_day,
        i.due_day, i.plan_next_day, i.plan_part_paise, now()
      FROM incoming i LEFT JOIN unacked u ON u.cid = i.cid
      ON CONFLICT (shop_id, cid) DO UPDATE SET
        name = EXCLUDED.name, phone = EXCLUDED.phone, balance_paise = EXCLUDED.balance_paise,
        promise_day = EXCLUDED.promise_day, oldest_unpaid_day = EXCLUDED.oldest_unpaid_day,
        due_day = EXCLUDED.due_day, plan_next_day = EXCLUDED.plan_next_day, plan_part_paise = EXCLUDED.plan_part_paise, updated_at = now()`
    const cids = rows.map((r) => r.cid)
    const gone = (await sql`DELETE FROM receivables WHERE shop_id = ${shopId} AND NOT (cid = ANY(${cids}::text[])) RETURNING cid`) as unknown[]
    log.info('receivables_synced', { fn: 'receivables', customers: rows.length, removed: gone.length })
    return json({ ok: true, customers: rows.length })
  } catch (e) {
    return errorResponse(e) ?? fail('receivables', e)
  }
}

export async function handlePending(req: Request): Promise<Response> {
  try {
    await ensureSchema()
    const shopId = await authShop(req)
    if (!shopId) return json({ error: 'unauthorized' }, 401)
    if (req.method === 'GET') {
      const rows = (await sql`SELECT id, kind, body, created_at FROM pending_events
        WHERE shop_id = ${shopId} AND acked_at IS NULL ORDER BY id LIMIT 200`) as { id: string | number; kind: string; body: unknown; created_at: string }[]
      return json({ events: rows.map((r) => ({ id: String(r.id), kind: r.kind, body: r.body, at: r.created_at })) })
    }
    if (req.method === 'POST') {
      const b = await readJson<{ ids?: unknown }>(req, 64 * 1024)
      const ids = Array.isArray(b?.ids) ? b.ids.filter((x): x is string => typeof x === 'string' && /^\d{1,18}$/.test(x)) : []
      if (!ids.length || ids.length > 500) return json({ error: 'bad ids' }, 400)
      const done = (await sql`UPDATE pending_events SET acked_at = now()
        WHERE shop_id = ${shopId} AND acked_at IS NULL AND id = ANY(${ids}::bigint[]) RETURNING id`) as unknown[]
      return json({ acked: done.length })
    }
    return json({ error: 'method not allowed' }, 405)
  } catch (e) {
    return errorResponse(e) ?? fail('pending', e)
  }
}

function fail(fn: string, e: unknown): Response {
  log.error(`${fn}_failed`, { fn, error: e })
  return json({ error: 'server error' }, 500)
}
