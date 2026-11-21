/** The hourly sweep's choice per customer: instalment day, due date, or the shop's every-N-days rule. */
import { describe, expect, it } from 'vitest'
import { autoReminderText, sweepAction } from './reminders.js'

const noon = new Date('2026-11-22T06:30:00Z') // 12:00 in India
const night = new Date('2026-11-22T17:30:00Z') // 23:00 in India
const daysAgo = (n: number) => new Date(noon.getTime() - n * 86_400_000)

describe('sweepAction', () => {
  const base = { balancePaise: 300000, everyDays: 7 }

  it('an instalment day: a link for the instalment, once a day, never more than the balance', () => {
    expect(sweepAction({ ...base, lastRemindedAt: daysAgo(1), planNextDay: '2026-11-22', planPartPaise: 100000 }, noon)).toEqual({ kind: 'plan', paise: 100000 })
    expect(sweepAction({ ...base, lastRemindedAt: noon, planNextDay: '2026-11-22', planPartPaise: 100000 }, noon)).toBeNull()
    expect(sweepAction({ ...base, balancePaise: 50000, lastRemindedAt: null, planNextDay: '2026-11-20', planPartPaise: 100000 }, noon)).toEqual({ kind: 'plan', paise: 50000 })
    // on a plan, before its day: nothing, even when the every-N-days rule would fire
    expect(sweepAction({ ...base, lastRemindedAt: daysAgo(30), planNextDay: '2026-11-25', planPartPaise: 100000 }, noon)).toBeNull()
  })

  it('a due date: once on the day, then the usual rhythm', () => {
    expect(sweepAction({ ...base, lastRemindedAt: daysAgo(2), dueDay: '2026-11-22' }, noon)).toEqual({ kind: 'due' })
    expect(sweepAction({ ...base, lastRemindedAt: daysAgo(1), dueDay: '2026-11-20' }, noon)).toBeNull()
    expect(sweepAction({ ...base, lastRemindedAt: daysAgo(2), dueDay: '2026-11-25' }, noon)).toBeNull()
  })

  it('the every-N-days rule; never at night; nothing at a zero balance', () => {
    expect(sweepAction({ ...base, lastRemindedAt: daysAgo(8) }, noon)).toEqual({ kind: 'interval' })
    expect(sweepAction({ ...base, lastRemindedAt: daysAgo(3) }, noon)).toBeNull()
    expect(sweepAction({ ...base, lastRemindedAt: null, dueDay: '2026-11-22' }, night)).toBeNull()
    expect(sweepAction({ ...base, balancePaise: 0, lastRemindedAt: null, dueDay: '2026-11-22' }, noon)).toBeNull()
  })
})

describe('autoReminderText', () => {
  const r = { lang: 'en', shop_name: 'Sharma Store', name: 'Ramesh', balance_paise: 300000 }
  it('an instalment line under the balance only on an instalment day', () => {
    const plain = autoReminderText(r, 'https://rzp.io/x')
    const part = autoReminderText(r, 'https://rzp.io/x', 100000)
    expect(part.split('\n').length).toBe(plain.split('\n').length + 1)
    expect(part).toContain('1,000')
    expect(part.split('\n')[3]).toContain('1,000')
  })
})
