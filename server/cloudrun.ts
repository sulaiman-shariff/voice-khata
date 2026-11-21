/**
 * The Cloud Run service: only what outside services and schedules call. The app, the voice socket
 * and everything the phone calls stay on Vercel; both share the Neon database.
 *
 *   POST /webhooks/razorpay           a customer paid a link or a counter QR (X-Razorpay-Signature)
 *   POST /webhooks/vonage/inbound     a customer replied 1/2/3/STOP, a promise, a voice note (Vonage JWT, or ?k= token)
 *   POST /webhooks/vonage/status      delivery receipts             (same)
 *   POST /internal/reminders-tick     hourly automatic reminders    (Cloud Scheduler, x-cron-secret)
 *   GET  /health (Cloud Run reserves /healthz)
 *
 * Start: node --import tsx server/cloudrun.ts (listens on $PORT, 8080 by default).
 */
import http from 'node:http'
import { json } from './db.js'
import { log, logged } from './log.js'
import { serveRoute, type Routes } from './node-bridge.js'

const routes: Routes = {
  '/webhooks/razorpay': async () => logged('razorpay', (await import('./pay/webhook.js')).handleRazorpayWebhook),
  '/webhooks/vonage/inbound': async () => logged('vonage', (await import('./wa/inbound.js')).handleVonageInbound),
  '/webhooks/vonage/status': async () => logged('vonage', (await import('./wa/inbound.js')).handleVonageStatus),
  '/internal/reminders-tick': async () => logged('reminders', (await import('./wa/reminders.js')).handleRemindersTick),
  '/health': async () => async () => json({ ok: true }),
}

const server = http.createServer((req, res) => {
  void serveRoute(routes, req, res).then((hit) => {
    if (!hit) res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}')
  })
})

const port = Number(process.env.PORT ?? 8080)
server.listen(port, () => log.info('cloudrun_listening', { port }))
// Cloud Run sends SIGTERM before stopping an instance: finish what is in flight
process.on('SIGTERM', () => server.close(() => process.exit(0)))
