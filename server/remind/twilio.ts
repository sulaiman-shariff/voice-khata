/**
 * WhatsApp reminders through Twilio's Messages API (no SDK: one form POST).
 *
 * Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_FROM (default: the shared
 * sandbox number whatsapp:+14155238886). On the free trial / sandbox a customer must first send
 * "join <your-code>" to the sandbox number, and free-form text is delivered only inside the 24 h
 * after the customer last messaged it. A real WhatsApp sender with an approved template lifts both
 * limits: set TWILIO_CONTENT_SID and the message goes as that template with {{1}} name, {{2}}
 * amount, {{3}} shop.
 */

export interface SendResult {
  ok: boolean
  sid?: string
  status?: string
  /** Twilio's error code and message when not ok (e.g. 63015: customer has not joined the sandbox) */
  code?: number
  error?: string
}

export const twilioConfigured = (env: NodeJS.ProcessEnv = process.env): boolean =>
  !!(env.TWILIO_ACCOUNT_SID?.trim() && env.TWILIO_AUTH_TOKEN?.trim())

/** +91 for a bare 10-digit Indian mobile; anything else must already be in +<country><number> form. */
export function toE164(raw: string): string | null {
  const d = raw.replace(/[^\d+]/g, '')
  if (/^[6-9]\d{9}$/.test(d)) return `+91${d}`
  if (/^0[6-9]\d{9}$/.test(d)) return `+91${d.slice(1)}`
  if (/^91[6-9]\d{9}$/.test(d)) return `+${d}`
  if (/^\+\d{8,15}$/.test(d)) return d
  return null
}

export async function sendWhatsApp(
  to: string, body: string, vars?: { name: string; amount: string; shop: string }, env: NodeJS.ProcessEnv = process.env,
): Promise<SendResult> {
  const sid = env.TWILIO_ACCOUNT_SID?.trim()
  const token = env.TWILIO_AUTH_TOKEN?.trim()
  if (!sid || !token) return { ok: false, error: 'twilio not configured' }
  const from = env.TWILIO_WHATSAPP_FROM?.trim() || 'whatsapp:+14155238886'
  const form = new URLSearchParams({ From: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`, To: `whatsapp:${to}` })
  const content = env.TWILIO_CONTENT_SID?.trim()
  if (content && vars) {
    form.set('ContentSid', content)
    form.set('ContentVariables', JSON.stringify({ 1: vars.name, 2: vars.amount, 3: vars.shop }))
  } else form.set('Body', body)
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
    signal: AbortSignal.timeout(10_000),
  })
  const j = (await res.json().catch(() => ({}))) as { sid?: string; status?: string; code?: number; message?: string }
  if (!res.ok) return { ok: false, code: j.code, error: j.message ?? `twilio ${res.status}` }
  return { ok: true, sid: j.sid, status: j.status }
}
