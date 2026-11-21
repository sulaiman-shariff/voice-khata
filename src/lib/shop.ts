/**
 * The shop's identity on the server, for WhatsApp payment links and automatic reminders.
 *
 * No account: the first time the server is needed, the phone registers and keeps an id and a secret
 * here. Requests carry `Authorization: Bearer <shopId>.<secret>`. The server keeps only a hash of
 * the secret. Losing it (a new phone, cleared site data) just registers a new shop. The ledger stays
 * on the phone either way; the server holds only what reminders need (src/lib/sync.ts).
 */
import { api } from './api'

export interface ShopCred {
  shopId: string
  secret: string
}

const KEY = 'vk-shop'

export function shopCred(): ShopCred | null {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? 'null') as ShopCred | null
    return c && /^[0-9a-f]{32}$/.test(c.shopId) && /^[0-9a-f]{64}$/.test(c.secret) ? c : null
  } catch {
    return null
  }
}

export const shopAuth = (c: ShopCred) => `Bearer ${c.shopId}.${c.secret}`

let registering: Promise<ShopCred | null> | null = null

/** This phone's shop, registering it on first use. null when the server cannot be reached. */
export function ensureShop(name: string, lang: string): Promise<ShopCred | null> {
  const have = shopCred()
  if (have) return Promise.resolve(have)
  registering ??= (async () => {
    try {
      const res = await fetch(api('/api/shop/register'), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, lang }),
      })
      if (!res.ok) return null
      const c = (await res.json()) as ShopCred
      try { localStorage.setItem(KEY, JSON.stringify(c)) } catch { /* private mode: register again next time */ }
      return shopCred() ?? c
    } catch {
      return null
    } finally {
      registering = null
    }
  })()
  return registering
}

/** The server forgot this shop (401): start over with a new one on the next call. */
export function forgetShop() {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}
