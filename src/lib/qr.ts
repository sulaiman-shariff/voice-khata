/**
 * Counter QR (server/pay/qr.ts), for exactly what the customer pays now:
 *  - mode 'qr':   a Razorpay QR code; show `imageUrl` as an image
 *  - mode 'link': a Razorpay payment link (the account has no QR Codes); draw `linkUrl` as a QR
 *                 (qrDataUrl below). The customer scans it and pays by UPI on Razorpay's page.
 * Either way the payment books itself: the next pull (every 2 s while it is open) brings a
 * 'payment' notice with `via: 'qr'` and `qrId` = this `id`. Close it with closeQr when it is not needed.
 *
 * `{ fallback: true }`: no Razorpay at all (or no shop registration, offline). Show a plain upi:// QR
 * (src/lib/pay.ts upiUri) and ask "Paid?" by hand.
 */
import QRCode from 'qrcode'
import { api } from './api'
import { forgetShop, shopAuth, shopCred } from './shop'
import { expectPayments } from './sync'

export type QrResult =
  | { mode: 'qr'; id: string; imageUrl: string; closeBy: number; paise: number }
  | { mode: 'link'; id: string; linkUrl: string; closeBy: number; paise: number }
  | { fallback: true; reason: 'unconfigured' | 'not_enabled' | 'failed' | 'no_shop' | 'offline' }

/** open this long on the server (QR_OPEN_MS), plus a little for the last pull */
const QR_POLL_MS = 21 * 60_000

/** A link (or a upi:// string) drawn as a QR image, for an <img src>. */
export const qrDataUrl = (text: string, width = 512): Promise<string> => QRCode.toDataURL(text, { width, margin: 1, errorCorrectionLevel: 'M' })

export async function createQr(cid: string, paise: number, name?: string): Promise<QrResult> {
  const c = shopCred()
  if (!c) return { fallback: true, reason: 'no_shop' }
  try {
    const res = await fetch(api('/api/qr'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: shopAuth(c) },
      body: JSON.stringify({ cid, paise, ...(name ? { name } : {}) }),
    })
    if (res.status === 401) {
      forgetShop()
      return { fallback: true, reason: 'no_shop' }
    }
    const j = (await res.json().catch(() => ({}))) as Partial<{ mode: string; id: string; imageUrl: string; linkUrl: string; closeBy: number; paise: number; fallback: boolean; reason: string }>
    const closeBy = j.closeBy ?? Date.now() + 15 * 60_000
    if (res.ok && !j.fallback && j.id && j.mode === 'qr' && j.imageUrl) {
      expectPayments(QR_POLL_MS)
      return { mode: 'qr', id: j.id, imageUrl: j.imageUrl, closeBy, paise: j.paise ?? paise }
    }
    if (res.ok && !j.fallback && j.id && j.mode === 'link' && j.linkUrl) {
      expectPayments(QR_POLL_MS)
      return { mode: 'link', id: j.id, linkUrl: j.linkUrl, closeBy, paise: j.paise ?? paise }
    }
    return { fallback: true, reason: j.reason === 'unconfigured' || j.reason === 'not_enabled' ? j.reason : 'failed' }
  } catch {
    return { fallback: true, reason: 'offline' }
  }
}

/** Close an open QR / cancel a counter link (paid in cash, sheet closed) so nobody can pay it later. Best effort. */
export async function closeQr(id: string): Promise<void> {
  const c = shopCred()
  if (!c) return
  try {
    await fetch(api(`/api/qr?id=${encodeURIComponent(id)}`), { method: 'DELETE', headers: { authorization: shopAuth(c) } })
  } catch { /* offline: it closes by itself in 15 minutes */ }
}

/** QR: 'active' | 'paid' | 'closed'; link: 'created' | 'paid' | 'cancelled'; null when unknown. */
export async function qrStatus(id: string): Promise<string | null> {
  const c = shopCred()
  if (!c) return null
  try {
    const res = await fetch(api(`/api/qr?id=${encodeURIComponent(id)}`), { headers: { authorization: shopAuth(c) } })
    if (!res.ok) return null
    return ((await res.json()) as { status?: string }).status ?? null
  } catch {
    return null
  }
}
