import { log, logged } from '../server/log.js'
import { ensureSchema, json, sql } from '../server/db.js'

/** Daily cron: delete confirmation links older than 30 days. */
export async function handle(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return json({ error: 'unauthorized' }, 401)
  try {
    await ensureSchema()
    const rows = (await sql`DELETE FROM confirm_links WHERE created_at < now() - interval '30 days' RETURNING token`) as unknown[]
    log.info('cleanup_done', { fn: 'cleanup', deleted: rows.length })
    return json({ deleted: rows.length })
  } catch (e) {
    log.error('cleanup_failed', { fn: 'cleanup', error: e })
    return json({ error: 'server error' }, 500)
  }
}

export default { fetch: logged('cleanup', handle) }
