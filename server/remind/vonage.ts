/**
 * WhatsApp reminders through the Vonage Messages API (no SDK: one JSON POST).
 *
 * Env: VONAGE_API_KEY, VONAGE_API_SECRET, VONAGE_WHATSAPP_FROM (digits, no +).
 * Sandbox: the shared sandbox number (dashboard → Messaging → Messages Sandbox, e.g. 14157386102)
 * sends any text to numbers that sent the sandbox passphrase on WhatsApp. It goes through
 * messages-sandbox.nexmo.com; a real (approved) Vonage WhatsApp number uses api.nexmo.com. Set
 * VONAGE_SANDBOX=false for a real number. Messages come from Vonage's number, never the shop's.
 */
import type { SendResult } from './twilio.js'

export const vonageConfigured = (env: NodeJS.ProcessEnv = process.env): boolean =>
  !!(env.VONAGE_API_KEY?.trim() && env.VONAGE_API_SECRET?.trim() && env.VONAGE_WHATSAPP_FROM?.trim())

export function vonageEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  const sandbox = env.VONAGE_SANDBOX ? env.VONAGE_SANDBOX !== 'false' : true
  return sandbox ? 'https://messages-sandbox.nexmo.com/v1/messages' : 'https://api.nexmo.com/v1/messages'
}

/** `to` is E.164 (+919876543210); Vonage wants digits only. */
export async function sendVonageWhatsApp(to: string, body: string, env: NodeJS.ProcessEnv = process.env): Promise<SendResult> {
  const key = env.VONAGE_API_KEY?.trim()
  const secret = env.VONAGE_API_SECRET?.trim()
  const from = env.VONAGE_WHATSAPP_FROM?.replace(/\D/g, '')
  if (!key || !secret || !from) return { ok: false, error: 'vonage not configured' }
  const res = await fetch(vonageEndpoint(env), {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ from, to: to.replace(/\D/g, ''), message_type: 'text', text: body, channel: 'whatsapp' }),
    signal: AbortSignal.timeout(10_000),
  })
  const j = (await res.json().catch(() => ({}))) as { message_uuid?: string; title?: string; detail?: string; type?: string }
  if (!res.ok) return { ok: false, code: res.status, error: [j.title, j.detail].filter(Boolean).join(': ') || `vonage ${res.status}` }
  return { ok: true, sid: j.message_uuid, status: 'accepted' }
}
