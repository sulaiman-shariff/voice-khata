import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { QR_OPEN_MS, cancelPaymentLink, createPaymentLink, createQr, parseLinkPaid, parseQrCredited, qrNotEnabled, verifyRazorpaySignature } from './razorpay.js'

const paid = (event = 'payment_link.paid', notes: unknown = { shop_id: 's', cid: 'c' }) => ({
  event,
  payload: {
    payment_link: { entity: { id: 'plink_1', reference_id: 'ref1', status: 'paid', notes } },
    payment: { entity: { id: 'pay_1', amount: 50000, status: 'captured', method: 'upi', created_at: 1_790_000_000 } },
  },
})

describe('Razorpay', () => {
  it('signature: hex HMAC of the exact body', () => {
    const body = JSON.stringify(paid())
    const sig = createHmac('sha256', 'whsec').update(body).digest('hex')
    expect(verifyRazorpaySignature(body, sig, 'whsec')).toBe(true)
    expect(verifyRazorpaySignature(body + ' ', sig, 'whsec')).toBe(false)
    expect(verifyRazorpaySignature(body, sig, 'other')).toBe(false)
    expect(verifyRazorpaySignature(body, null, 'whsec')).toBe(false)
    expect(verifyRazorpaySignature(body, sig, '')).toBe(false)
  })
  it('reads a paid or partly paid link', () => {
    expect(parseLinkPaid(paid())).toMatchObject({ linkId: 'plink_1', paymentId: 'pay_1', paymentPaise: 50000, notes: { shop_id: 's', cid: 'c' } })
    expect(parseLinkPaid(paid('payment_link.partially_paid'))?.event).toBe('payment_link.partially_paid')
    // Razorpay sends empty notes as []
    expect(parseLinkPaid(paid('payment_link.paid', []))?.notes).toEqual({})
  })
  it('ignores other events and broken payloads', () => {
    expect(parseLinkPaid(paid('payment.failed'))).toBeNull()
    expect(parseLinkPaid({ event: 'payment_link.paid', payload: {} })).toBeNull()
    const p = paid()
    p.payload.payment.entity.status = 'authorized'
    expect(parseLinkPaid(p)).toBeNull()
  })
  it('creates a link: INR, our reference, no Razorpay SMS or email, partial when asked', async () => {
    let sent: { url: string; body: Record<string, unknown>; auth: string } | null = null
    const fake = (async (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get('authorization') ?? '' }
      return new Response(JSON.stringify({ id: 'plink_9', short_url: 'https://rzp.io/rzp/x', status: 'created', amount: 50000, amount_paid: 0, expire_by: 1, reference_id: 'r' }))
    }) as unknown as typeof fetch
    const link = await createPaymentLink({ keyId: 'rzp_test_k', keySecret: 's' }, {
      amountPaise: 50000, referenceId: 'r', description: 'Shop: Ramesh', customer: { name: 'Ramesh', contact: '919845012345' },
      notes: { shop_id: 's', cid: 'c' }, expireBy: new Date('2026-12-01T00:00:00Z'), minPartialPaise: 1000,
    }, fake)
    expect(link.short_url).toBe('https://rzp.io/rzp/x')
    expect(sent!.url).toBe('https://api.razorpay.com/v1/payment_links')
    expect(sent!.auth).toBe(`Basic ${Buffer.from('rzp_test_k:s').toString('base64')}`)
    expect(sent!.body).toMatchObject({
      amount: 50000, currency: 'INR', accept_partial: true, first_min_partial_amount: 1000, reference_id: 'r',
      notify: { sms: false, email: false }, customer: { contact: '+919845012345' },
    })
  })
})

const credited = (over: Record<string, unknown> = {}) => ({
  event: 'qr_code.credited',
  payload: {
    qr_code: { entity: { id: 'qr_ABC123', status: 'closed', notes: { shop_id: 's', cid: 'c' } } },
    payment: { entity: { id: 'pay_9', amount: 25000, status: 'captured', method: 'upi', created_at: 1_790_000_000, ...over } },
  },
})

describe('Razorpay counter QR', () => {
  it('creates a single-use, fixed-amount UPI QR that closes at close_by', async () => {
    let sent: { url: string; body: Record<string, unknown> } | null = null
    const fake = (async (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(String(init.body)) }
      return new Response(JSON.stringify({ id: 'qr_1', image_url: 'https://rzp.io/i/x', status: 'active', close_by: 1_790_000_900, payment_amount: 25000 }))
    }) as unknown as typeof fetch
    const closeBy = new Date(Date.now() + QR_OPEN_MS)
    const qr = await createQr({ keyId: 'k', keySecret: 's' }, { amountPaise: 25000, name: 'Sharma Kirana', description: 'Sharma Kirana: Ramesh', notes: { shop_id: 's', cid: 'c' }, closeBy }, fake)
    expect(qr.image_url).toBe('https://rzp.io/i/x')
    expect(sent!.url).toBe('https://api.razorpay.com/v1/payments/qr_codes')
    expect(sent!.body).toMatchObject({
      type: 'upi_qr', usage: 'single_use', fixed_amount: true, payment_amount: 25000, notes: { shop_id: 's', cid: 'c' },
      close_by: Math.floor(closeBy.getTime() / 1000),
    })
  })
  it('an account without QR codes is a fallback, other errors are not', async () => {
    const fail = (status: number, description: string) => (async () => new Response(JSON.stringify({ error: { description } }), { status })) as unknown as typeof fetch
    const req = { amountPaise: 100, name: 'S', description: 'S', notes: {}, closeBy: new Date() }
    const err = async (f: typeof fetch) => createQr({ keyId: 'k', keySecret: 's' }, req, f).catch((e: unknown) => e)
    expect(qrNotEnabled(await err(fail(400, 'QR code feature is not enabled for this merchant')))).toBe(true)
    expect(qrNotEnabled(await err(fail(404, 'The requested URL was not found on the server.')))).toBe(true)
    expect(qrNotEnabled(await err(fail(401, 'The api key provided is invalid')))).toBe(true)
    expect(qrNotEnabled(await err(fail(500, 'server error')))).toBe(false)
    expect(qrNotEnabled(await err(fail(400, 'amount must be at least INR 1.00')))).toBe(false)
    expect(qrNotEnabled(new Error('x'))).toBe(false)
  })
  it('reads qr_code.credited', () => {
    expect(parseQrCredited(credited())).toEqual({
      event: 'qr_code.credited', qrId: 'qr_ABC123', notes: { shop_id: 's', cid: 'c' }, paymentId: 'pay_9', paymentPaise: 25000, method: 'upi', createdAt: 1_790_000_000,
    })
    expect(parseQrCredited(credited({ status: 'failed' }))).toBeNull()
    expect(parseQrCredited(credited({ amount: 0 }))).toBeNull()
    expect(parseQrCredited(paid())).toBeNull()
    expect(parseQrCredited({ event: 'qr_code.credited', payload: {} })).toBeNull()
  })
})

describe('Razorpay counter link helpers', () => {
  it('a link without a customer sends no customer; cancel posts to /cancel', async () => {
    const sent: { url: string; body?: Record<string, unknown> }[] = []
    const fake = (async (url: string, init: RequestInit) => {
      sent.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined })
      return new Response(JSON.stringify({ id: 'plink_1', short_url: 'https://rzp.io/rzp/x', status: 'created', amount: 100, amount_paid: 0, expire_by: 1, reference_id: 'r' }))
    }) as unknown as typeof fetch
    await createPaymentLink({ keyId: 'k', keySecret: 's' }, { amountPaise: 100, referenceId: 'r', description: 'S', notes: { source: 'counter' }, expireBy: new Date() }, fake)
    expect(sent[0].body).not.toHaveProperty('customer')
    expect(sent[0].body).toMatchObject({ accept_partial: false, notify: { sms: false, email: false } })
    await cancelPaymentLink({ keyId: 'k', keySecret: 's' }, 'plink_1', fake)
    expect(sent[1].url).toBe('https://api.razorpay.com/v1/payment_links/plink_1/cancel')
  })
})
