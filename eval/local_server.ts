/**
 * Run the voice function locally: npx tsx --env-file=.env eval/local_server.ts  (ws://localhost:8787, or PORT)
 * Also serves the HTTP functions (/api/*) and the Cloud Run routes (/webhooks/*, /internal/*) on the same
 * port, so `npm run dev` can proxy /api/* here and a tunnel can deliver webhooks.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import server from '../api/voice.js'
import { serveRoute, type Routes } from '../server/node-bridge.js'

type Fn = { default: { fetch: (req: Request) => Promise<Response> } }
const fn = (load: () => Promise<Fn>) => async () => (await load()).default.fetch
const routes: Routes = {
  '/api/remind': fn(() => import('../api/remind.js')),
  '/api/import': fn(() => import('../api/import.js')),
  '/api/backup': fn(() => import('../api/backup.js')),
  '/api/confirm': fn(() => import('../api/confirm.js')),
  '/api/shop/register': fn(() => import('../api/shop/register.js')),
  '/api/receivables': fn(() => import('../api/receivables.js')),
  '/api/pending': fn(() => import('../api/pending.js')),
  '/api/qr': fn(() => import('../api/qr.js')),
  // what Cloud Run serves in production (server/cloudrun.ts), here too for local tests through a tunnel
  '/webhooks/razorpay': async () => (await import('../server/pay/webhook.js')).handleRazorpayWebhook,
  '/webhooks/vonage/inbound': async () => (await import('../server/wa/inbound.js')).handleVonageInbound,
  '/webhooks/vonage/status': async () => (await import('../server/wa/inbound.js')).handleVonageStatus,
  '/internal/reminders-tick': async () => (await import('../server/wa/reminders.js')).handleRemindersTick,
}

async function http(req: IncomingMessage, res: ServerResponse) {
  if (await serveRoute(routes, req, res)) return
  res.writeHead(426, { 'content-type': 'text/plain' })
  res.end('WebSocket upgrade required')
}

server.removeAllListeners('request')
server.on('request', (req, res) => void http(req, res))

const port = Number(process.env.PORT ?? 8787)
server.listen(port, () => console.log(`voice function on ws://localhost:${port} (+ /api/*, /webhooks/*, /internal/*)`))
