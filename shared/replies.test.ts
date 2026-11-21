/**
 * What the agent says, in every language: the read-back carries the exact amount, the shop never
 * pressures a customer, and it never hides that it is an AI.
 */
import { describe, expect, it } from 'vitest'
import { parseAmounts } from './numbers.js'
import { LANGS, REPLIES, guardReply } from './replies.js'

describe.each(LANGS)('%s', (l) => {
  const R = REPLIES[l]

  it('every read-back and question carries the exact amount', () => {
    for (const t of [
      R.saved('X', 1870, 'credit'), R.savedPromise('X', 1870, 1), R.confirm('X', 1870, 'credit'), R.confirmNew('X', 1870, 'credit'),
      R.noisyConfirm('X', 1870, 'payment'), R.askName(1870), R.askDirection('X', 1870), R.balance('X', 1870),
      R.corrected('X', 1870, 'credit'), R.reminderText('X', 1870, 'Shop'),
    ]) {
      expect(t).not.toMatch(/undefined|NaN|\$\{/)
      expect(parseAmounts(t).map((s) => s.value)).toContain(1870)
    }
  })

  it('no template uses lending, pressure or judging language; reminders carry an opt-out', () => {
    for (const [k, fn] of Object.entries(R)) {
      const args: unknown[] = k === 'topDebtors' ? [['X', 'Y']] : k === 'showCustomer' ? ['X', 100, { amt: 100, dir: 'credit' }] : ['X', 100, 'credit', 100]
      expect(guardReply((fn as (...a: unknown[]) => string)(...args)), k).not.toBeNull()
    }
    expect(R.reminderText('X', 500, 'Shop')).toMatch(/\(.+\)/)
  })

  it('the first-run disclosure and the privacy answer say it is an AI', () => {
    expect(R.disclosure()).toMatch(/\bAI\b/)
    expect(R.privacy()).toMatch(/\bAI\b/)
  })
})

it('the guard blocks lending, pressure and judging, and lets a plain balance through', () => {
  for (const bad of ['You can take a loan of 500', 'Ramesh is a risky customer', 'pay immediately or legal action', 'ब्याज लगेगा'])
    expect(guardReply(bad)).toBeNull()
  expect(guardReply('Ramesh owes 500 rupees in total.')).not.toBeNull()
})

describe('agent tool replies', () => {
  const KEYS = [
    'savedWithBalance', 'showCustomer', 'showDues', 'showHistory', 'showToday', 'searchResult', 'topDebtors', 'closed',
    'customerAdded', 'renamed', 'mergeAsk', 'merged', 'phoneSet', 'reminderReady', 'statementReady', 'noConsent', 'alreadyWritten',
    'languageSet', 'readBackSet', 'speedSet', 'shopNameSet', 'privacyOpen', 'backupReady', 'eraseAsk', 'eraseType',
    'awakeHello', 'sleeping',
  ]

  it('every language has every template, and money templates contain the digits', () => {
    for (const l of LANGS) {
      const R = REPLIES[l] as unknown as Record<string, unknown>
      for (const k of KEYS) expect(typeof R[k], `${l}.${k}`).toBe('function')
      const S = REPLIES[l]
      const t = S.savedWithBalance('Ramesh', 300, 'credit', 640)
      expect(t, l).toContain('300')
      expect(t, l).toContain('640')
      expect(S.savedWithBalance('Ramesh', 300, 'payment', -50), l).toContain('50')
      expect(S.showDues(3, 12500), l).toContain('12,500')
      expect(S.showToday(1870, 500), l).toContain('1,870')
      expect(S.showToday(1870, 500), l).toContain('500')
      expect(S.showCustomer('Ramesh', 640, { amt: 200, dir: 'credit' }), l).toContain('200')
      expect(S.showCustomer('Ramesh', 640), l).toContain('640')
    }
  })

  it.each(LANGS)('%s: all new templates fill every slot and pass the guard', (l) => {
    const S = REPLIES[l]
    const out = [
      S.savedWithBalance('Ramesh', 300, 'credit', 640), S.savedWithBalance('Ramesh', 300, 'payment', 0),
      S.showCustomer('Ramesh', 0), S.showCustomer('Ramesh', -80, { amt: 80, dir: 'payment' }),
      S.showDues(3, 12500), S.showHistory('Ramesh', 4), S.showToday(10, 20), S.searchResult('milk', 2), S.searchResult('milk', 0),
      S.topDebtors(['Ramesh', 'Suresh']), S.topDebtors([]), S.closed(), S.customerAdded('Ramesh'), S.renamed('Ramesh', 'Rakesh'),
      S.mergeAsk('Ramesh', 'Rakesh'), S.merged('Ramesh', 'Rakesh'), S.phoneSet('Ramesh'), S.reminderReady('Ramesh'),
      S.statementReady('Ramesh'), S.noConsent('Ramesh'), S.alreadyWritten('Ramesh', 300), S.languageSet('Tamil'), S.readBackSet(true), S.readBackSet(false),
      S.speedSet(true), S.speedSet(false), S.shopNameSet('Sharma Store'), S.privacyOpen(), S.backupReady(), S.eraseAsk(),
      S.eraseType('DELETE'), S.awakeHello(), S.sleeping(),
    ]
    for (const t of out) {
      expect(t).not.toMatch(/undefined|NaN|\$\{/)
      expect(t.length).toBeGreaterThan(5)
      expect(guardReply(t), t).toBe(t)
    }
    expect(S.topDebtors(['Ramesh', 'Suresh'])).toMatch(/Ramesh.*Suresh/)
    expect(S.renamed('Ramesh', 'Rakesh')).toMatch(/Ramesh.*Rakesh|Rakesh.*Ramesh/)
    expect(S.readBackSet(true)).not.toBe(S.readBackSet(false))
    expect(S.speedSet(true)).not.toBe(S.speedSet(false))
  })
})
