/**
 * The outside world the WhatsApp and payment handlers talk to, behind one seam so tests can swap it.
 * Defaults read the environment on every call (Vercel and Cloud Run both inject secrets as env vars).
 */
import { createPaymentLink, razorpayKeys, type LinkRequest, type PaymentLink } from './pay/razorpay.js'
import { sendVonageWhatsApp, vonageConfigured } from './remind/vonage.js'

export interface Services {
  /** null when Razorpay keys are not configured */
  createLink: ((r: LinkRequest) => Promise<PaymentLink>) | null
  /** null when Vonage is not configured; returns the message id */
  sendWa: ((to: string, text: string) => Promise<string>) | null
  now: () => Date
}

export function envServices(env = process.env): Services {
  const keys = razorpayKeys(env)
  return {
    createLink: keys ? (r) => createPaymentLink(keys, r) : null,
    sendWa: vonageConfigured(env)
      ? async (to, text) => {
        const r = await sendVonageWhatsApp(to, text, env)
        if (!r.ok || !r.sid) throw new Error(`vonage: ${r.error ?? r.code ?? 'no message id'}`)
        return r.sid
      }
      : null,
    now: () => new Date(),
  }
}

let override: Services | null = null

export const services = (): Services => override ?? envServices()

/** Tests only. */
export function setServices(s: Services | null) {
  override = s
}
