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
    for (const [k, fn] of Object.entries(R)) expect(guardReply((fn as (...a: unknown[]) => string)('X', 100, 'credit')), k).not.toBeNull()
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
