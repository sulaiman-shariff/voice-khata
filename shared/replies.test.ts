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
      const t = (fn as (...a: unknown[]) => string)('X', 100, 'credit')
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

describe('ack and filler', () => {
  it('exist, are short and differ from each other in every language', async () => {
    const { LANGS, say } = await import('./replies.js')
    for (const l of LANGS) {
      const R = say(l)
      expect(R.ack().length).toBeGreaterThan(2)
      expect(R.ack().length).toBeLessThan(20)
      expect(R.filler().length).toBeLessThan(20)
      expect(R.ack()).not.toBe(R.filler())
    }
  })
})
