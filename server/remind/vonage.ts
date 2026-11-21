/**
 * WhatsApp reminders through the Vonage Messages API (no SDK: one JSON POST).
 *
 * Env: VONAGE_API_KEY, VONAGE_API_SECRET, VONAGE_WHATSAPP_FROM (digits, no +).
 * Sandbox: the shared sandbox number (dashboard → Messaging → Messages Sandbox, e.g. 14157386102)
 * sends any text to numbers that sent the sandbox passphrase on WhatsApp. It goes through
 * messages-sandbox.nexmo.com; a real (approved) Vonage WhatsApp number uses api.nexmo.com. Set
 * VONAGE_SANDBOX=false for a real number. Messages come from Vonage's number, never the shop's.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
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

const b64url = (b: Buffer) => b.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

/**
 * Vonage signs webhooks with a JWT (HS256, the account's signature secret) in `Authorization: Bearer`.
 * Its `payload_hash` claim is the SHA-256 of the body, so the body cannot be swapped under a valid token.
 */
export function verifyVonageJwt(authorization: string | null, rawBody: string, secret: string, now = Date.now()): boolean {
  if (!authorization?.startsWith('Bearer ') || !secret) return false
  const parts = authorization.slice(7).trim().split('.')
  if (parts.length !== 3) return false
  const [h, p, s] = parts
  let header: { alg?: string }
  let claims: { iat?: number; payload_hash?: string }
  try {
    header = JSON.parse(Buffer.from(h, 'base64url').toString())
    claims = JSON.parse(Buffer.from(p, 'base64url').toString())
  } catch {
    return false
  }
  if (header.alg !== 'HS256') return false
  const want = Buffer.from(b64url(createHmac('sha256', secret).update(`${h}.${p}`).digest()))
  const got = Buffer.from(s)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return false
  if (typeof claims.iat === 'number' && Math.abs(now / 1000 - claims.iat) > 24 * 3600) return false
  if (claims.payload_hash && claims.payload_hash !== createHash('sha256').update(rawBody).digest('hex')) return false
  return true
}

/** The parts of an inbound WhatsApp message we use. */
export interface Inbound {
  messageId: string
  from: string
  text: string
  payload?: string
}

export function parseInbound(body: unknown): Inbound | null {
  const b = body as {
    channel?: string
    message_uuid?: string
    from?: string
    message_type?: string
    text?: string
    reply?: { id?: string; title?: string }
    button?: { payload?: string; text?: string }
  }
  if (!b || b.channel !== 'whatsapp' || !b.from || !b.message_uuid) return null
  const from = String(b.from).replace(/\D/g, '')
  if (b.message_type === 'reply') return { messageId: b.message_uuid, from, text: b.reply?.title ?? '', payload: b.reply?.id }
  if (b.message_type === 'button') return { messageId: b.message_uuid, from, text: b.button?.text ?? '', payload: b.button?.payload }
  return { messageId: b.message_uuid, from, text: typeof b.text === 'string' ? b.text : '' }
}
