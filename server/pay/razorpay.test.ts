import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createPaymentLink, parseLinkPaid, verifyRazorpaySignature } from './razorpay.js'

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
