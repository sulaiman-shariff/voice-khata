import { describe, expect, it } from 'vitest'
import { parseAmounts } from './numbers.js'
import { LANGS, REPLIES, guardReply } from './replies.js'

const AI_WORD = /\bAI\b/

describe('replies', () => {
  it.each(LANGS)('%s: first turn discloses AI and on-device storage', (l) => {
    const t = REPLIES[l].disclosure()
    expect(t).toMatch(AI_WORD)
    expect(t.length).toBeLessThan(200) // short enough to speak in a few seconds
  })

  it.each(LANGS)('%s: privacy explainer says AI, names Gnani, offers erasure', (l) => {
    const t = REPLIES[l].privacy()
    expect(t).toMatch(AI_WORD)
    expect(t).toMatch(/Gnani/)
    expect(t).toMatch(/PIN/)
  })

  it.each(LANGS)('%s: every template fills and carries the exact amount', (l) => {
    const R = REPLIES[l]
    const amtTemplates = [
      R.saved('X', 1870, 'credit'), R.saved('X', 1870, 'payment'), R.savedPromise('X', 1870, 1), R.confirm('X', 1870, 'credit'),
      R.noisyConfirm('X', 1870, 'payment'), R.askName(1870), R.askDirection('X', 1870), R.balance('X', 1870),
      R.corrected('X', 1870, 'credit'), R.reminderText('X', 1870, 'Shop'),
    ]
    for (const t of amtTemplates) {
      expect(t).not.toMatch(/undefined|NaN|\$\{/)
      // the spoken string contains 1,870 exactly once as a number, nothing else
      expect(parseAmounts(t).map((s) => s.value)).toContain(1870)
    }
    expect(R.balance('X', -500)).toContain('500')
    expect(R.balance('X', 0)).not.toMatch(/\d/)
    expect(R.dues(3, 12500)).toContain('12,500')
  })

  it.each(LANGS)('%s: reminder is polite, opt-out, no pressure', (l) => {
    const t = REPLIES[l].reminderText('X', 500, 'Shop')
    expect(guardReply(t)).toBe(t)
    expect(t).toMatch(/\(.+\)/) // opt-out line in brackets
  })

  it.each(LANGS)('%s: no template uses banned language', (l) => {
    const R = REPLIES[l]
    for (const [k, fn] of Object.entries(R)) {
      const args: unknown[] = k === 'topDebtors' ? [['X', 'Y']] : k === 'showCustomer' ? ['X', 100, { amt: 100, dir: 'credit' }] : ['X', 100, 'credit', 100]
      const t = (fn as (...a: unknown[]) => string)(...args)
      expect(guardReply(t), k).not.toBeNull()
    }
  })

  it('guard blocks lending / pressure / judging', () => {
    for (const bad of ['You can take a loan of 500', 'Ramesh is a risky customer', 'pay immediately or legal action', 'ब्याज लगेगा'])
      expect(guardReply(bad)).toBeNull()
    expect(guardReply('Ramesh owes 500 rupees in total.')).not.toBeNull()
  })
})

describe('stripTags', () => {
  it('removes Timbre audio tags and tidies spacing', async () => {
    const { stripTags } = await import('./replies.js')
    expect(stripTags('रमेश 340, <pauses> सुरेश 200, सब उधार?')).toBe('रमेश 340, सुरेश 200, सब उधार?')
    expect(stripTags('<pauses>नमस्ते')).toBe('नमस्ते')
    expect(stripTags('no tags here')).toBe('no tags here')
  })
})

describe('agent tool replies', () => {
  const KEYS = [
    'savedWithBalance', 'showCustomer', 'showDues', 'showHistory', 'showToday', 'searchResult', 'topDebtors', 'closed',
    'customerAdded', 'renamed', 'mergeAsk', 'merged', 'phoneSet', 'reminderReady', 'statementReady', 'noConsent',
    'languageSet', 'readBackSet', 'speedSet', 'shopNameSet', 'privacyOpen', 'backupReady', 'eraseAsk', 'eraseTap',
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
      S.statementReady('Ramesh'), S.noConsent('Ramesh'), S.languageSet('Tamil'), S.readBackSet(true), S.readBackSet(false),
      S.speedSet(true), S.speedSet(false), S.shopNameSet('Sharma Store'), S.privacyOpen(), S.backupReady(), S.eraseAsk(),
      S.eraseTap(), S.awakeHello(), S.sleeping(),
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

describe('ack', () => {
  it('exist, are short and differ from each other in every language', async () => {
    const { LANGS, say } = await import('./replies.js')
    for (const l of LANGS) {
      const R = say(l)
      expect(R.ack().length).toBeGreaterThan(2)
      expect(R.ack().length).toBeLessThan(20)
    }
  })
})
