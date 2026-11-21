/**
 * Run the voice function locally: npx tsx --env-file=.env eval/local_server.ts  (ws://localhost:8787, or PORT)
 * Also serves the HTTP functions (/api/remind, /api/backup, /api/confirm) on the same port, as
 * Vercel would, so `npm run dev` can proxy /api/* here.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import server from '../api/voice.js'

type Fn = { fetch: (req: Request) => Promise<Response> }
const routes: Record<string, () => Promise<{ default: Fn }>> = {
  '/api/remind': () => import('../api/remind.js'),
  '/api/backup': () => import('../api/backup.js'),
  '/api/confirm': () => import('../api/confirm.js'),
}

async function http(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const route = routes[url.pathname]
  if (!route) {
    res.writeHead(426, { 'content-type': 'text/plain' })
    res.end('WebSocket upgrade required')
    return
  }
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks)
  try {
    const r = await (await route()).default.fetch(new Request(url, { method: req.method, headers, body }))
    res.writeHead(r.status, Object.fromEntries(r.headers))
    res.end(Buffer.from(await r.arrayBuffer()))
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: String(e) }))
  }
}

server.removeAllListeners('request')
server.on('request', (req, res) => void http(req, res))

const port = Number(process.env.PORT ?? 8787)
server.listen(port, () => console.log(`voice function on ws://localhost:${port} (+ /api/remind, /api/backup, /api/confirm)`))
