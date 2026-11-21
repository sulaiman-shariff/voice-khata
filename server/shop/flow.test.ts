/**
 * The whole money loop against Neon, with Vonage and Razorpay faked:
 * register -> sync -> automatic reminder with a link -> customer pays -> receipt -> the phone picks the
 * payment up -> customer replies (balance, wrong, STOP).
 * Runs only with DATABASE_URL (like server/db.test.ts); cleans up its own shop.
 */
import { createHmac } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ensureSchema, hasDb, sql } from '../db.js'
import { handleRazorpayWebhook } from '../pay/webhook.js'
import { setServices } from '../services.js'
import { handleVonageInbound } from '../wa/inbound.js'
import { handleRemindersTick } from '../wa/reminders.js'
import { handlePending, handleReceivables, handleRegister } from './api.js'

const sent: { to: string; text: string }[] = []
const links: { amountPaise: number; referenceId: string }[] = []
let n = 0
const PHONE = `910000${String(Date.now()).slice(-6)}` // +91 0…: no real Indian mobile starts with 0

const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://x${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) })

describe.skipIf(!hasDb())('neon: reminders and payments', { timeout: 60_000 }, () => {
  let auth = ''
  let shopId = ''
  beforeAll(async () => {
    process.env.CRON_SECRET = 'cron-test'
    process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec-test'
    process.env.VONAGE_WEBHOOK_TOKEN = 'vtok'
    delete process.env.VONAGE_SIGNATURE_SECRET
    setServices({
      createLink: async (r) => {
        links.push(r)
        return { id: `plink_${r.referenceId}`, short_url: `https://rzp.io/rzp/${r.referenceId}`, status: 'created', amount: r.amountPaise, amount_paid: 0, expire_by: 0, reference_id: r.referenceId }
      },
      sendWa: async (to, text) => {
        sent.push({ to, text })
        return `msg-${Date.now()}-${n++}`
      },
      now: () => new Date('2026-11-22T06:00:00Z'), // 11:30 in India
    })
    await ensureSchema()
  }, 120_000)
  afterAll(async () => {
    setServices(null)
    if (shopId) {
      await sql`DELETE FROM shops WHERE id = ${shopId}`
      await sql`DELETE FROM payment_links WHERE shop_id = ${shopId}`
      await sql`DELETE FROM payments WHERE shop_id = ${shopId}`
      await sql`DELETE FROM pending_events WHERE shop_id = ${shopId}`
      await sql`DELETE FROM wa_messages WHERE shop_id = ${shopId}`
    }
    await sql`DELETE FROM wa_messages WHERE phone = ${PHONE}`
    await sql`DELETE FROM wa_optouts WHERE phone = ${PHONE}`
  }, 60_000)

  it('registers a shop and syncs its settings and opted-in customers', async () => {
    const r = await (await handleRegister(req('POST', '/api/shop/register', { name: 'Test Kirana', lang: 'en' }), `ip-${Date.now()}`)).json()
    expect(r.shopId).toMatch(/^[0-9a-f]{32}$/)
    shopId = r.shopId
    auth = `Bearer ${r.shopId}.${r.secret}`
    expect((await handleReceivables(req('PUT', '/api/receivables', { customers: [] }, { authorization: `Bearer ${r.shopId}.${'0'.repeat(64)}` }))).status).toBe(401)
    const ok = await handleReceivables(req('PUT', '/api/receivables', {
      shopName: 'Test Kirana', lang: 'en', signature: 'Rakesh · Jayanagar', autoRemind: true, remindEveryDays: 7,
      customers: [
        { cid: 'c1', name: 'Ramesh', phone: PHONE.slice(2), balancePaise: 50000 },
        { cid: 'c2', name: 'Suresh', phone: '9845000000', balancePaise: 0 },
      ],
    }, { authorization: auth }))
    expect(ok.status).toBe(200)
    const rows = (await sql`SELECT cid, phone, balance_paise FROM receivables WHERE shop_id = ${shopId} ORDER BY cid`) as { cid: string; phone: string; balance_paise: string }[]
    expect(rows.map((x) => [x.cid, x.phone, Number(x.balance_paise)])).toEqual([['c1', PHONE, 50000], ['c2', '919845000000', 0]])
  })

  it('a later sync replaces the set: a customer who stopped agreeing is removed', async () => {
    await handleReceivables(req('PUT', '/api/receivables', { customers: [{ cid: 'c1', name: 'Ramesh', phone: PHONE, balancePaise: 50000 }] }, { authorization: auth }))
    const rows = (await sql`SELECT cid FROM receivables WHERE shop_id = ${shopId}`) as unknown[]
    expect(rows.length).toBe(1)
  })

  it('the hourly sweep sends one reminder with a Razorpay link, worded like the phone', async () => {
    expect((await handleRemindersTick(req('POST', '/internal/reminders-tick'))).status).toBe(401)
    const before = sent.length
    const r = await (await handleRemindersTick(req('POST', '/internal/reminders-tick', undefined, { 'x-cron-secret': 'cron-test' }))).json()
    expect(r.sent).toBeGreaterThanOrEqual(1)
    const mine = sent.slice(before).filter((m) => m.to === PHONE)
    expect(mine.length).toBe(1)
    expect(mine[0].text).toContain('*Test Kirana* — Payment reminder')
    expect(mine[0].text).toContain('*₹500*')
    expect(mine[0].text).toMatch(/https:\/\/rzp\.io\/rzp\/[0-9a-f]{24}/)
    expect(mine[0].text).toContain('Reply: 1 Pay now')
    expect(mine[0].text).toContain('Rakesh · Jayanagar')
    // reminded now: the next sweep leaves them alone
    const again = await (await handleRemindersTick(req('POST', '/internal/reminders-tick', undefined, { 'x-cron-secret': 'cron-test' }))).json()
    expect(sent.slice(before).filter((m) => m.to === PHONE).length).toBe(1)
    expect(again.failed).toBe(0)
  })

  it('a payment books once, lowers the balance, sends a receipt, and waits for the phone', async () => {
    const link = (await sql`SELECT rzp_link_id FROM payment_links WHERE shop_id = ${shopId} AND cid = 'c1'`) as { rzp_link_id: string }[]
    const payId = `pay_${Date.now()}`
    const body = JSON.stringify({
      event: 'payment_link.partially_paid',
      payload: {
        payment_link: { entity: { id: link[0].rzp_link_id, reference_id: 'x', status: 'partially_paid', notes: [] } },
        payment: { entity: { id: payId, amount: 20000, status: 'captured', method: 'upi', created_at: 1_795_000_000 } },
      },
    })
    const sig = createHmac('sha256', 'whsec-test').update(body).digest('hex')
    expect((await handleRazorpayWebhook(req('POST', '/webhooks/razorpay', body, { 'x-razorpay-signature': 'bad' }))).status).toBe(401)
    const before = sent.length
    expect((await handleRazorpayWebhook(req('POST', '/webhooks/razorpay', body, { 'x-razorpay-signature': sig }))).status).toBe(200)
    // Razorpay delivers it again: nothing changes
    expect(await (await handleRazorpayWebhook(req('POST', '/webhooks/razorpay', body, { 'x-razorpay-signature': sig }))).json()).toEqual({ ok: true, duplicate: true })
    const bal = (await sql`SELECT balance_paise FROM receivables WHERE shop_id = ${shopId} AND cid = 'c1'`) as { balance_paise: string }[]
    expect(Number(bal[0].balance_paise)).toBe(30000)
    const receipts = sent.slice(before)
    expect(receipts.length).toBe(1)
    expect(receipts[0].text).toBe('Thank you Ramesh! Test Kirana has received 200 rupees. 300 rupees is still due.')

    // a sync from the phone before it picked the payment up cannot put the old balance back
    await handleReceivables(req('PUT', '/api/receivables', { customers: [{ cid: 'c1', name: 'Ramesh', phone: PHONE, balancePaise: 50000 }] }, { authorization: auth }))
    const still = (await sql`SELECT balance_paise FROM receivables WHERE shop_id = ${shopId} AND cid = 'c1'`) as { balance_paise: string }[]
    expect(Number(still[0].balance_paise)).toBe(30000)

    const pending = await (await handlePending(req('GET', '/api/pending', undefined, { authorization: auth }))).json()
    const pay = pending.events.find((e: { kind: string }) => e.kind === 'payment')
    expect(pay.body).toMatchObject({ cid: 'c1', paise: 20000, paymentId: payId, method: 'upi' })
    const acked = await (await handlePending(req('POST', '/api/pending', { ids: pending.events.map((e: { id: string }) => e.id) }, { authorization: auth }))).json()
    expect(acked.acked).toBe(pending.events.length)
    expect((await (await handlePending(req('GET', '/api/pending', undefined, { authorization: auth }))).json()).events).toEqual([])
  })

  it('customer replies: balance with a link, wrong goes to the shop, STOP stops reminders', async () => {
    const inbound = (id: string, text: string, k = 'vtok') => handleVonageInbound(req('POST', `/webhooks/vonage/inbound?k=${k}`,
      { channel: 'whatsapp', message_uuid: id, from: PHONE, to: '14157386102', message_type: 'text', text }))
    expect((await inbound(`in-${Date.now()}-x`, '2', 'wrong')).status).toBe(401)

    let before = sent.length
    await inbound(`in-${Date.now()}-a`, '2')
    expect(sent[before].text).toContain('Ramesh, your balance at Test Kirana is 300 rupees.')
    expect(sent[before].text).toMatch(/Tap to pay 300 rupees: https:\/\/rzp\.io\//)
    // the link is for what is owed now (300), not the old 500
    expect(links.at(-1)!.amountPaise).toBe(30000)

    const id = `in-${Date.now()}-b`
    before = sent.length
    await inbound(id, 'yeh galat hai')
    await inbound(id, 'yeh galat hai') // Vonage retried: answered once
    expect(sent.length - before).toBe(1)
    expect(sent[before].text).toContain('we have told Test Kirana')

    await inbound(`in-${Date.now()}-c`, 'STOP')
    expect(sent.at(-1)!.text).toBe('Okay, you will not get messages like this any more.')
    const ev = await (await handlePending(req('GET', '/api/pending', undefined, { authorization: auth }))).json()
    expect(ev.events.map((e: { kind: string }) => e.kind).sort()).toEqual(['dispute', 'optout'])

    await sql`UPDATE receivables SET last_reminded_at = NULL WHERE shop_id = ${shopId}`
    before = sent.length
    await handleRemindersTick(req('POST', '/internal/reminders-tick', undefined, { 'x-cron-secret': 'cron-test' }))
    expect(sent.slice(before).filter((m) => m.to === PHONE)).toEqual([])
  })
})
