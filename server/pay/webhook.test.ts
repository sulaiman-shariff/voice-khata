import { describe, expect, it } from 'vitest'
import { type BookingDb, bookPayment, creditedFrom } from './webhook.js'

/** The booking tables in memory: payments unique on the payment id, like the real primary key. */
function memDb(owners: Record<string, { shopId: string; cid: string }> = {}) {
  const payments = new Map<string, { ref: string; paise: number }>()
  const pending: { shopId: string; kind: string; body: Record<string, unknown> }[] = []
  const status = new Map<string, string>()
  const balances = new Map<string, number>([['s1/c1', 50000]])
  const db: BookingDb = {
    owner: async (_via, ref) => owners[ref] ?? null,
    insertPayment: async (p) => {
      if (payments.has(p.paymentId)) return false
      payments.set(p.paymentId, { ref: p.ref, paise: p.paise })
      return true
    },
    markRef: async (via, ref, s) => { status.set(`${via}:${ref}`, s) },
    takeFromBalance: async (shopId, cid, paise) => {
      const k = `${shopId}/${cid}`
      if (!balances.has(k)) return null
      balances.set(k, balances.get(k)! - paise)
      return { balancePaise: balances.get(k)!, name: 'Ramesh', phone: '919845012345' }
    },
    addPending: async (shopId, kind, body) => { pending.push({ shopId, kind, body }) },
  }
  return { db, payments, pending, status, balances }
}

const linkEvent = (event: string, payId = 'pay_1', amount = 20000) => ({
  event,
  payload: {
    payment_link: { entity: { id: 'plink_1', reference_id: 'r', status: 'partially_paid', notes: [] } },
    payment: { entity: { id: payId, amount, status: 'captured', method: 'upi', created_at: 1_790_000_000 } },
  },
})
const qrEvent = (payId = 'pay_q') => ({
  event: 'qr_code.credited',
  payload: {
    qr_code: { entity: { id: 'qr_X1y2Z3', notes: { shop_id: 's1', cid: 'c1' } } },
    payment: { entity: { id: payId, amount: 30000, status: 'captured', method: 'upi', created_at: 1_790_000_000 } },
  },
})

describe('booking a Razorpay payment', () => {
  it('a repeated webhook books the payment once', async () => {
    const m = memDb({ plink_1: { shopId: 's1', cid: 'c1' } })
    const ev = creditedFrom(linkEvent('payment_link.paid'))!
    expect((await bookPayment(m.db, ev)).status).toBe('booked')
    expect((await bookPayment(m.db, ev)).status).toBe('duplicate')
    expect((await bookPayment(m.db, creditedFrom(linkEvent('payment_link.paid'))!)).status).toBe('duplicate')
    expect(m.payments.size).toBe(1)
    expect(m.pending).toHaveLength(1)
    expect(m.balances.get('s1/c1')).toBe(30000)
  })

  it('a part-paid link carries partial: true to the pending payment event', async () => {
    const m = memDb({ plink_1: { shopId: 's1', cid: 'c1' } })
    await bookPayment(m.db, creditedFrom(linkEvent('payment_link.partially_paid'))!)
    expect(m.pending[0]).toMatchObject({ shopId: 's1', kind: 'payment', body: { cid: 'c1', paise: 20000, paymentId: 'pay_1', via: 'link', partial: true } })
    expect(m.status.get('link:plink_1')).toBe('partially_paid')
    await bookPayment(m.db, creditedFrom(linkEvent('payment_link.paid', 'pay_2', 30000))!)
    expect(m.pending[1].body.partial).toBeUndefined()
  })

  it('a counter QR books through the same path, found by its notes when the row is missing', async () => {
    const m = memDb()
    const r = await bookPayment(m.db, creditedFrom(qrEvent())!)
    expect(r).toMatchObject({ status: 'booked', shopId: 's1', cid: 'c1', left: { balancePaise: 20000 } })
    expect(m.pending[0].body).toMatchObject({ cid: 'c1', paise: 30000, via: 'qr', qrId: 'qr_X1y2Z3', day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
    expect(m.pending[0].body.partial).toBeUndefined()
    expect(m.status.get('qr:qr_X1y2Z3')).toBe('paid')
    expect((await bookPayment(m.db, creditedFrom(qrEvent())!)).status).toBe('duplicate')
  })

  it('a payment nobody can place is acknowledged and ignored', async () => {
    const m = memDb()
    expect((await bookPayment(m.db, creditedFrom(linkEvent('payment_link.paid'))!)).status).toBe('unknown')
    expect(m.payments.size).toBe(0)
    expect(creditedFrom({ event: 'payment.failed' })).toBeNull()
  })
})

describe('a counter link (no QR Codes on the account)', () => {
  it('books through the link path and reaches the phone as the counter QR', async () => {
    const m = memDb({ plink_C1: { shopId: 's1', cid: 'c1' } })
    const ev = creditedFrom({
      event: 'payment_link.paid',
      payload: {
        payment_link: { entity: { id: 'plink_C1', reference_id: 'r', status: 'paid', notes: { shop_id: 's1', cid: 'c1', source: 'counter' } } },
        payment: { entity: { id: 'pay_c', amount: 25000, status: 'captured', method: 'upi', created_at: 1_790_000_000 } },
      },
    })!
    expect(ev).toMatchObject({ via: 'qr', store: 'link', ref: 'plink_C1' })
    expect((await bookPayment(m.db, ev)).status).toBe('booked')
    expect(m.pending[0].body).toMatchObject({ via: 'qr', qrId: 'plink_C1', paise: 25000 })
    expect(m.status.get('link:plink_C1')).toBe('paid')
    expect((await bookPayment(m.db, ev)).status).toBe('duplicate')
  })
  it('a reminder link stays a link', () => {
    expect(creditedFrom(linkEvent('payment_link.paid'))).toMatchObject({ via: 'link', store: 'link' })
  })
})
