import { log, logged } from '../server/log.js'
import { ensureSchema, json, randomHex, sql } from '../server/db.js'

export const MAX_BLOB = 4 * 1024 * 1024
const ID_RE = /^[0-9a-f]{32}$/
const B64_RE = /^[A-Za-z0-9+/=]+$/

/** Server only stores the ciphertext envelope; it never has the key. */
function validBlob(blob: unknown): blob is string {
  if (typeof blob !== 'string' || blob.length === 0 || blob.length > MAX_BLOB) return false
  try {
    const o = JSON.parse(blob)
    return o?.v === 1 && [o.salt, o.iv, o.ct].every((x) => typeof x === 'string' && B64_RE.test(x))
  } catch {
    return false
  }
}

export async function handle(req: Request): Promise<Response> {
  try {
    await ensureSchema()
    if (req.method === 'GET') {
      const id = new URL(req.url).searchParams.get('id') ?? ''
      if (!ID_RE.test(id)) return json({ error: 'bad id' }, 400)
      const rows = (await sql`SELECT blob FROM backups WHERE id = ${id}`) as { blob: string }[]
      if (!rows.length) return json({ error: 'not found' }, 404)
      return json({ blob: rows[0].blob })
    }
    if (req.method === 'DELETE') {
      const id = new URL(req.url).searchParams.get('id') ?? ''
      if (!ID_RE.test(id)) return json({ error: 'bad id' }, 400)
      await sql`DELETE FROM backups WHERE id = ${id}`
      return json({ ok: true })
    }
    if (req.method === 'POST') {
      const len = Number(req.headers.get('content-length') ?? 0)
      if (len > MAX_BLOB + 1024) return json({ error: 'too large' }, 413)
      const text = await req.text()
      if (text.length > MAX_BLOB + 1024) return json({ error: 'too large' }, 413)
      let body: { id?: unknown; blob?: unknown }
      try {
        body = JSON.parse(text)
      } catch {
        return json({ error: 'bad json' }, 400)
      }
      if (typeof body.blob === 'string' && body.blob.length > MAX_BLOB) return json({ error: 'too large' }, 413)
      if (!validBlob(body.blob)) return json({ error: 'bad blob' }, 400)
      const bytes = body.blob.length
      if (body.id !== undefined) {
        if (typeof body.id !== 'string' || !ID_RE.test(body.id)) return json({ error: 'bad id' }, 400)
        const r = (await sql`UPDATE backups SET blob = ${body.blob}, bytes = ${bytes}, updated_at = now() WHERE id = ${body.id} RETURNING id`) as unknown[]
        if (!r.length) return json({ error: 'not found' }, 404)
        return json({ id: body.id })
      }
      const id = randomHex(16)
      await sql`INSERT INTO backups (id, blob, bytes) VALUES (${id}, ${body.blob}, ${bytes})`
      return json({ id })
    }
    return json({ error: 'method not allowed' }, 405)
  } catch (e) {
    log.error('backup_failed', { fn: 'backup', error: e })
    return json({ error: 'server error' }, 500)
  }
}

export default { fetch: logged('backup', handle) }
