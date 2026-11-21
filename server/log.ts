/**
 * Structured server logging: one JSON object per line, so Vercel's log viewer (and `vercel logs
 * --json`) can filter on any field. Every line carries `ev` (event name) plus whatever context the
 * logger was created with (session id, turn number, ...).
 *
 *   LOG_LEVEL=debug|info|warn|error   (default info; VK_DEBUG=1 implies debug)
 *
 * Production logs include transcripts and replies (customer names and amounts): see README,
 * "Responsible AI and privacy". Never logged: API keys and tokens (any field whose name looks like
 * a secret is masked), the client's ledger snapshot (only counts), raw IP addresses (hashed).
 */
import { createHash } from 'node:crypto'

export type Level = 'debug' | 'info' | 'warn' | 'error'
export type Fields = Record<string, unknown>

export interface Logger {
  debug(ev: string, f?: Fields): void
  info(ev: string, f?: Fields): void
  warn(ev: string, f?: Fields): void
  error(ev: string, f?: Fields): void
  /** A logger whose lines all carry `f` as well. */
  child(f: Fields): Logger
  enabled(level: Level): boolean
}

const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const SECRET = /key|token|secret|password|authorization|cookie/i
const MAX_STR = 1000

function envLevel(): Level {
  const l = process.env.LOG_LEVEL as Level | undefined
  if (l && l in RANK) return l
  return process.env.VK_DEBUG ? 'debug' : 'info'
}

/** JSON-safe, size-capped copy of a value; secrets masked, errors reduced to their message. */
function clean(v: unknown, depth = 0): unknown {
  if (v === null || v === undefined) return v
  if (typeof v === 'string') return v.length > MAX_STR ? `${v.slice(0, MAX_STR)}…(${v.length})` : v
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 10) / 10 : String(v)
  if (typeof v === 'boolean') return v
  if (v instanceof Error) return v.message.slice(0, MAX_STR)
  if (Buffer.isBuffer(v) || v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return `<${(v as { byteLength: number }).byteLength} bytes>`
  if (depth > 4) return '…'
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => clean(x, depth + 1))
  if (typeof v === 'object') {
    const out: Fields = {}
    for (const [k, x] of Object.entries(v as Fields)) out[k] = SECRET.test(k) ? '***' : clean(x, depth + 1)
    return out
  }
  return String(v)
}

export type Sink = (level: Level, line: string) => void
const consoleSink: Sink = (level, line) => {
  // Vercel tags stderr lines as errors: warn/error go there, the rest to stdout
  if (level === 'error' || level === 'warn') console.error(line)
  else console.log(line)
}

export function createLogger(base: Fields = {}, opts: { level?: Level; sink?: Sink } = {}): Logger {
  const min = RANK[opts.level ?? envLevel()]
  const sink = opts.sink ?? consoleSink
  const emit = (level: Level, ev: string, f?: Fields) => {
    if (RANK[level] < min) return
    let line: string
    try {
      line = JSON.stringify({ t: new Date().toISOString(), lvl: level, ev, ...(clean(base) as Fields), ...(f ? (clean(f) as Fields) : {}) })
    } catch {
      line = JSON.stringify({ t: new Date().toISOString(), lvl: level, ev, note: 'unserializable fields' })
    }
    sink(level, line)
  }
  return {
    debug: (ev, f) => emit('debug', ev, f),
    info: (ev, f) => emit('info', ev, f),
    warn: (ev, f) => emit('warn', ev, f),
    error: (ev, f) => emit('error', ev, f),
    child: (f) => createLogger({ ...base, ...f }, { level: opts.level, sink }),
    enabled: (level) => RANK[level] >= min,
  }
}

/** Logs nothing (tests, and callers that were not given a logger). */
export const nullLogger: Logger = {
  debug() {}, info() {}, warn() {}, error() {},
  child: () => nullLogger,
  enabled: () => false,
}

/** Short, stable, non-reversible id for an IP address (enough to group a client's sessions). */
export const hashIp = (ip: string) => createHash('sha256').update(`vk|${ip}`).digest('hex').slice(0, 10)

/** Short random id for a session or request. */
export const shortId = () => Math.random().toString(36).slice(2, 10)

/** The process-wide logger for code outside a session. */
export const log = createLogger({ svc: 'voice-khata', region: process.env.VERCEL_REGION ?? 'local' })

/**
 * Wrap a fetch-style handler with one log line per request: method, path (never the query string:
 * backup ids and confirmation tokens are bearer secrets), status and duration.
 */
export function logged(fn: string, handle: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    const t0 = Date.now()
    const L = log.child({ fn, rid: shortId() })
    try {
      const res = await handle(req)
      const f = { method: req.method, path: new URL(req.url).pathname, status: res.status, ms: Date.now() - t0 }
      if (res.status >= 500) L.error('request', f)
      else if (res.status >= 400) L.warn('request', f)
      else L.info('request', f)
      return res
    } catch (e) {
      L.error('request_failed', { method: req.method, ms: Date.now() - t0, error: e })
      throw e
    }
  }
}
