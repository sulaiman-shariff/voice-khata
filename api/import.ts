/**
 * POST /api/import {image: "data:image/jpeg;base64,..."} -> {rows, ms}
 * Reads a photo of a paper khata page (server/parse/vision.ts). Nothing is stored: the image goes
 * to Gemini and the rows come back to the phone for review. Own pages only, size-capped.
 */
import { log, logged } from '../server/log.js'
import { json } from '../server/db.js'
import { geminiKeys } from '../server/parse/llm.js'
import { VISION_MODEL, readLedgerPhoto } from '../server/parse/vision.js'

const ALLOWED_ORIGIN = /^https:\/\/voice-khata[a-z0-9-]*\.vercel\.app$|^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.\d+\.\d+\.\d+)(:\d+)?$/
const MAX_CHARS = 6_000_000 // ~4.5 MB of base64; the phone sends a ~1600 px JPEG (a few hundred KB)
const DATA_URL = /^data:(image\/(?:jpeg|png|webp|heic|heif));base64,([A-Za-z0-9+/=]+)$/

export async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  const origin = req.headers.get('origin')
  if (origin && !ALLOWED_ORIGIN.test(origin)) return json({ error: 'origin not allowed' }, 403)
  if (!geminiKeys().length) return json({ error: 'no GEMINI_API_KEY on the server' }, 503)
  const text = await req.text()
  if (text.length > MAX_CHARS) return json({ error: 'photo too large' }, 413)
  let image: unknown
  try {
    image = (JSON.parse(text) as { image?: unknown }).image
  } catch {
    return json({ error: 'bad json' }, 400)
  }
  const m = typeof image === 'string' ? DATA_URL.exec(image) : null
  if (!m) return json({ error: 'send a JPEG/PNG/WebP photo' }, 400)
  try {
    const r = await readLedgerPhoto(m[2], m[1])
    log.info('import_photo', { model: VISION_MODEL, ms: Math.round(r.ms), rows: r.rows.length, kb: Math.round(m[2].length * 0.75 / 1024) })
    return json(r)
  } catch (e) {
    log.error('import_photo_failed', { error: e })
    return json({ error: 'could not read the photo, try again' }, 502)
  }
}

export default { fetch: logged('import', handle) }
