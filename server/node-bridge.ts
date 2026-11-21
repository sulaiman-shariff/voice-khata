/**
 * Run fetch-style handlers (Request -> Response, as Vercel runs them) on a plain Node HTTP server:
 * eval/local_server.ts (everything, for `npm run dev`) and server/cloudrun.ts (webhooks and jobs).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

export type FetchHandler = (req: Request) => Promise<Response>
export type Routes = Record<string, () => Promise<FetchHandler>>

const MAX_BODY = 5 * 1024 * 1024

/** Answers when the path is one of `routes`; returns false (and writes nothing) when it is not. */
export async function serveRoute(routes: Routes, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const proto = String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0]
  const url = new URL(req.url ?? '/', `${proto}://${req.headers.host ?? 'localhost'}`)
  const route = routes[url.pathname]
  if (!route) return false
  try {
    const chunks: Buffer[] = []
    let size = 0
    for await (const c of req) {
      size += (c as Buffer).length
      if (size > MAX_BODY) {
        res.writeHead(413, { 'content-type': 'application/json' }).end('{"error":"too large"}')
        return true
      }
      chunks.push(c as Buffer)
    }
    const headers = new Headers()
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v)
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : new Uint8Array(Buffer.concat(chunks))
    const r = await (await route())(new Request(url, { method: req.method, headers, body }))
    res.writeHead(r.status, Object.fromEntries(r.headers))
    res.end(Buffer.from(await r.arrayBuffer()))
  } catch (e) {
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'server error' }))
    console.error(e)
  }
  return true
}
