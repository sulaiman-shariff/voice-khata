/**
 * Shop identity without accounts: the phone registers once and gets an id plus a secret it keeps
 * (and puts in its PIN-locked backup). Requests carry `Authorization: Bearer <shopId>.<secret>`.
 * The server keeps only the secret's SHA-256.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { randomHex, sql } from '../db.js'

const ID_RE = /^[0-9a-f]{32}$/
const SECRET_RE = /^[0-9a-f]{64}$/

const hash = (secret: string) => createHash('sha256').update(`vk-shop|${secret}`).digest('hex')

export async function registerShop(name: string, lang: string): Promise<{ shopId: string; secret: string }> {
  const shopId = randomHex(16)
  const secret = randomHex(32)
  await sql`INSERT INTO shops (id, secret_hash, name, lang) VALUES (${shopId}, ${hash(secret)}, ${name}, ${lang})`
  return { shopId, secret }
}

export function parseShopToken(authorization: string | null): { shopId: string; secret: string } | null {
  const m = /^Bearer ([0-9a-f]{32})\.([0-9a-f]{64})$/.exec(authorization?.trim() ?? '')
  if (!m || !ID_RE.test(m[1]) || !SECRET_RE.test(m[2])) return null
  return { shopId: m[1], secret: m[2] }
}

/** The shop id when the request's token is right, else null. */
export async function authShop(req: Request): Promise<string | null> {
  const t = parseShopToken(req.headers.get('authorization'))
  if (!t) return null
  const rows = (await sql`UPDATE shops SET seen_at = now() WHERE id = ${t.shopId} RETURNING secret_hash`) as { secret_hash: string }[]
  if (!rows.length) return null
  const a = Buffer.from(rows[0].secret_hash)
  const b = Buffer.from(hash(t.secret))
  return a.length === b.length && timingSafeEqual(a, b) ? t.shopId : null
}
