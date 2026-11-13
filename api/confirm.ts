import { ensureSchema, json, randomHex, sql } from '../server/db.js'

export const EXPIRY_DAYS = 30
const TOKEN_RE = /^[0-9a-f]{32}$/
const LANGS = ['hi', 'en', 'kn', 'ta', 'te', 'ml', 'mr', 'bn', 'gu', 'pa']
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

interface Row {
  shop: string
  paise: string | number
  direction: string
  day: string
  lang: string
  status: string
  expired: boolean
}

export async function handle(req: Request): Promise<Response> {
  try {
    await ensureSchema()
    if (req.method === 'GET') {
      const token = new URL(req.url).searchParams.get('token') ?? ''
      if (!TOKEN_RE.test(token)) return json({ error: 'bad token' }, 400)
      const rows = (await sql`SELECT shop, paise, direction, day, lang, status,
        created_at < now() - make_interval(days => ${EXPIRY_DAYS}) AS expired
        FROM confirm_links WHERE token = ${token}`) as Row[]
      if (!rows.length) return json({ error: 'not found' }, 404)
      const r = rows[0]
      if (r.expired) return json({ error: 'expired', status: 'expired' }, 410)
      return json({ shop: r.shop, paise: Number(r.paise), direction: r.direction, day: r.day, lang: r.lang, status: r.status })
    }
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

    let b: Record<string, unknown>
    try {
      b = await req.json()
    } catch {
      return json({ error: 'bad json' }, 400)
    }
    if (!b || typeof b !== 'object') return json({ error: 'bad json' }, 400)

    if ('answer' in b) {
      const { token, answer } = b
      if (typeof token !== 'string' || !TOKEN_RE.test(token)) return json({ error: 'bad token' }, 400)
      if (answer !== 'confirmed' && answer !== 'disputed') return json({ error: 'bad answer' }, 400)
      const upd = (await sql`UPDATE confirm_links SET status = ${answer}, answered_at = now()
        WHERE token = ${token} AND status = 'pending' AND created_at >= now() - make_interval(days => ${EXPIRY_DAYS})
        RETURNING token`) as unknown[]
      if (upd.length) return json({ ok: true, status: answer })
      const cur = (await sql`SELECT status, created_at < now() - make_interval(days => ${EXPIRY_DAYS}) AS expired FROM confirm_links WHERE token = ${token}`) as { status: string; expired: boolean }[]
      if (!cur.length) return json({ error: 'not found' }, 404)
      if (cur[0].expired) return json({ error: 'expired' }, 410)
      return json({ error: 'already answered', status: cur[0].status }, 409)
    }

    const { shop, paise, direction, day, lang } = b
    if (typeof shop !== 'string' || !shop.trim() || shop.length > 60) return json({ error: 'bad shop' }, 400)
    if (typeof paise !== 'number' || !Number.isInteger(paise) || paise <= 0 || paise >= 1e9) return json({ error: 'bad paise' }, 400)
    if (direction !== 'credit' && direction !== 'payment') return json({ error: 'bad direction' }, 400)
    if (typeof day !== 'string' || !DAY_RE.test(day)) return json({ error: 'bad day' }, 400)
    if (typeof lang !== 'string' || !LANGS.includes(lang)) return json({ error: 'bad lang' }, 400)
    const token = randomHex(16)
    await sql`INSERT INTO confirm_links (token, shop, paise, direction, day, lang) VALUES (${token}, ${shop.trim()}, ${paise}, ${direction}, ${day}, ${lang})`
    return json({ token })
  } catch (e) {
    console.error('confirm error', (e as Error).message)
    return json({ error: 'server error' }, 500)
  }
}

export default { fetch: handle }
