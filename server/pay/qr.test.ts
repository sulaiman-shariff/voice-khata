import { beforeEach, describe, expect, it } from 'vitest'
import { type QrDeps, type QrStore, COUNTER_LINK_MS, handleQr, resetQrOff } from './qr.js'
import { RazorpayError, type LinkRequest, type QrRequest } from './razorpay.js'

const NOW = new Date('2026-11-22T06:00:00Z')

function setup(opts: { qr?: 'ok' | 'not_enabled' | 'none'; link?: boolean } = {}) {
  const qrs = new Map<string, string>()
  const links = new Map<string, string>()
  const calls = { qr: [] as QrRequest[], link: [] as LinkRequest[], closed: [] as string[], cancelled: [] as string[] }
  const store: QrStore = {
    ensure: async () => {},
    shopName: async () => 'Sharma Kirana',
    saveQr: async (r) => { qrs.set(r.id, 'active') },
    saveLink: async (r) => { links.set(r.rzpLinkId, 'created') },
    status: async (_s, kind, id) => (kind === 'qr' ? qrs : links).get(id) ?? null,
    markClosed: async (kind, id) => {
      if (kind === 'qr') qrs.set(id, 'closed')
      else links.set(id, 'cancelled')
    },
  }
  const mode = opts.qr ?? 'ok'
  const deps: QrDeps = {
    createQr: mode === 'none' ? null : async (r) => {
      calls.qr.push(r)
      if (mode === 'not_enabled') throw new RazorpayError(400, 'QR code feature is not enabled for this merchant')
      return { id: 'qr_AAA111', image_url: 'https://rzp.io/i/q', status: 'active', close_by: 0, payment_amount: r.amountPaise }
    },
    closeQr: async (id) => { calls.closed.push(id) },
    createLink: opts.link === false ? null : async (r) => {
      calls.link.push(r)
      return { id: 'plink_BBB222', short_url: 'https://rzp.io/rzp/c', status: 'created', amount: r.amountPaise, amount_paid: 0, expire_by: 0, reference_id: r.referenceId }
    },
    cancelLink: async (id) => { calls.cancelled.push(id) },
    authShop: async () => 's1',
    store,
    now: () => NOW,
  }
  const call = async (method: string, body?: unknown, id?: string) =>
    (await handleQr(new Request(`http://x/api/qr${id ? `?id=${id}` : ''}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) }), deps)).json()
  return { deps, calls, call, qrs, links }
}

describe('counter QR endpoint', () => {
  beforeEach(() => resetQrOff())

  it('a Razorpay QR code when the account has QR Codes', async () => {
    const t = setup()
    expect(await t.call('POST', { cid: 'c1', paise: 25000, name: 'Ramesh' })).toMatchObject({ mode: 'qr', id: 'qr_AAA111', imageUrl: 'https://rzp.io/i/q', paise: 25000 })
    expect(t.calls.link).toEqual([])
  })

  it('QR Codes not enabled: an exact-amount counter payment link instead, and later requests skip the QR call', async () => {
    const t = setup({ qr: 'not_enabled' })
    const r = await t.call('POST', { cid: 'c1', paise: 25000, name: 'Ramesh' })
    expect(r).toEqual({ mode: 'link', id: 'plink_BBB222', linkUrl: 'https://rzp.io/rzp/c', closeBy: NOW.getTime() + COUNTER_LINK_MS, paise: 25000 })
    const l = t.calls.link[0]
    expect(l).toMatchObject({ amountPaise: 25000, notes: { shop_id: 's1', cid: 'c1', source: 'counter' }, description: 'Sharma Kirana: Ramesh' })
    expect(l.minPartialPaise).toBeUndefined() // the whole amount at once
    expect(l.customer).toBeUndefined()
    expect(l.expireBy.getTime() - NOW.getTime()).toBeGreaterThanOrEqual(15 * 60_000) // Razorpay's minimum
    expect(t.links.get('plink_BBB222')).toBe('created')
    await t.call('POST', { cid: 'c1', paise: 10000 })
    expect(t.calls.qr).toHaveLength(1)
    expect(t.calls.link).toHaveLength(2)
  })

  it('no QR client but keys for links: a link', async () => {
    expect(await setup({ qr: 'none' }).call('POST', { cid: 'c1', paise: 5000 })).toMatchObject({ mode: 'link' })
  })

  it('the upi:// fallback only when Razorpay is not set up', async () => {
    expect(await setup({ qr: 'none', link: false }).call('POST', { cid: 'c1', paise: 5000 })).toEqual({ fallback: true, reason: 'unconfigured' })
    const noDb = setup()
    noDb.deps.store = null
    expect(await noDb.call('POST', { cid: 'c1', paise: 5000 })).toEqual({ fallback: true, reason: 'unconfigured' })
  })

  it('DELETE cancels a counter link and closes a QR code, once', async () => {
    const t = setup({ qr: 'not_enabled' })
    await t.call('POST', { cid: 'c1', paise: 25000 })
    expect(await t.call('DELETE', undefined, 'plink_BBB222')).toEqual({ ok: true })
    expect(t.calls.cancelled).toEqual(['plink_BBB222'])
    expect(t.links.get('plink_BBB222')).toBe('cancelled')
    await t.call('DELETE', undefined, 'plink_BBB222')
    expect(t.calls.cancelled).toHaveLength(1)
    resetQrOff() // another account: QR Codes on
    const q = setup()
    await q.call('POST', { cid: 'c1', paise: 25000 })
    await q.call('DELETE', undefined, 'qr_AAA111')
    expect(q.calls.closed).toEqual(['qr_AAA111'])
    expect(await q.call('GET', undefined, 'qr_AAA111')).toEqual({ id: 'qr_AAA111', status: 'closed' })
    expect(await q.call('DELETE', undefined, 'plink_ZZZ999')).toEqual({ error: 'not found' })
  })

  it('refuses bad amounts', async () => {
    const t = setup()
    expect(await t.call('POST', { cid: 'c1', paise: 50 })).toEqual({ error: 'bad request' })
    expect(await t.call('POST', { cid: 'c1', paise: 10.5 })).toEqual({ error: 'bad request' })
  })
})
