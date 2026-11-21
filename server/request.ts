import { json } from './db.js'

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Body as text, refusing anything over `max` bytes. */
export async function readText(req: Request, max: number): Promise<string> {
  if (Number(req.headers.get('content-length') ?? 0) > max) throw new HttpError(413, 'too large')
  const text = await req.text()
  if (text.length > max) throw new HttpError(413, 'too large')
  return text
}

export async function readJson<T = unknown>(req: Request, max: number): Promise<T> {
  const text = await readText(req, max)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new HttpError(400, 'bad json')
  }
}

export const errorResponse = (e: unknown): Response | null => (e instanceof HttpError ? json({ error: e.message }, e.status) : null)

/** Scheduler jobs (and the old Vercel cron) prove themselves with the shared CRON_SECRET. */
export function cronAuthorized(req: Request, env = process.env): boolean {
  const secret = env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}` || req.headers.get('x-cron-secret') === secret
}

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
