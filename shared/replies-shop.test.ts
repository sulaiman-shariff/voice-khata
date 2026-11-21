/** The shop-day templates in every language: every slot filled, the digits said, the tone guard passed. */
import { describe, expect, it } from 'vitest'
import { CASH_CATEGORIES } from './ledger.js'
import { LANGS, guardReply } from './replies.js'
import { SHOP_REPLIES } from './replies-shop.js'

describe.each(LANGS)('%s', (l) => {
  const S = SHOP_REPLIES[l]
  const all = [
    S.dailySummary({ credit: 1870, paid: 500, newCustomers: 2, top: [{ name: 'Ramesh', amt: 640 }, { name: 'Suresh', amt: 300 }], promises: ['Geeta'], cashIn: 2000, cashOut: 800 }),
    S.dailySummary({ credit: 0, paid: 0, newCustomers: 0, top: [], promises: [] }),
    S.morningBriefing({ promises: 3, due: 1, old: 2, total: 4500 }), S.morningBriefing({ promises: 0, due: 0, old: 0, total: 0 }),
    S.overdueList(2, 30, 1870, ['Ramesh', 'Suresh']), S.noOverdue(30), S.collectToday(3, 1870, ['Ramesh']), S.nothingToCollect(),
    S.planAsk('Ramesh', 3000, 3, 1000, 7), S.planAsk('Ramesh', 3000, 3, 1000, 10), S.planSet('Ramesh', 1000, 30), S.planCancelAsk('Ramesh'),
    S.planCancelled('Ramesh'), S.noPlan('Ramesh'),
    ...CASH_CATEGORIES.flatMap((c) => [S.cashSaved(800, 'out', c), S.cashSaved(2000, 'in', c), S.cashAsk(800, 'out', c)]),
    S.supplierSaved('Gupta', 5000, 'credit', 5000), S.supplierSaved('Gupta', 2000, 'payment', 0), S.supplierSaved('Gupta', 2000, 'payment', -100),
    S.supplierBalance('Gupta', 3000), S.supplierBalance('Gupta', -100), S.supplierBalance('Gupta', 0), S.noSupplierReminder('Gupta'),
    S.dueNoted(15), S.instalmentLine('₹1,000'), S.nicknameAsk('Ramesh'), S.tagSkipped('Ramesh 2'), S.tagSet('Ramesh', 'Doodhwala'),
    S.soundAlikeAsk('Ramesh', 'Rakesh', 200, 'credit'),
  ]

  it('fills every slot and passes the tone guard', () => {
    for (const t of all) {
      expect(t).not.toMatch(/undefined|NaN|\$\{|\[object/)
      expect(t.length).toBeGreaterThan(3)
      expect(guardReply(t), t).toBe(t)
    }
  })

  it('says the amounts and names', () => {
    const d = all[0]
    for (const x of ['1,870', '500', '640', 'Ramesh', 'Geeta', '2,000', '800']) expect(d, x).toContain(x)
    expect(S.planAsk('Ramesh', 3000, 3, 1000, 7)).toMatch(/3,000[\s\S]*1,000|1,000[\s\S]*3,000/)
    expect(S.soundAlikeAsk('Ramesh', 'Rakesh', 200, 'credit')).toMatch(/Ramesh[\s\S]*Rakesh/)
    expect(S.supplierSaved('Gupta', 5000, 'credit', 7000)).toContain('7,000')
    expect(S.dueNoted(15)).toContain('15')
    expect(S.morningBriefing({ promises: 3, due: 0, old: 0, total: 4500 })).toContain('4,500')
  })
})
