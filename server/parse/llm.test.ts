/**
 * validate(): the model may only choose among amounts that were said. Anything else is refused.
 */
import { describe, expect, it } from 'vitest'
import { type LlmReading, validate } from './llm.js'

const R = (p: Partial<LlmReading>): LlmReading => ({
  intent: 'entries', entries: [], correction: null, query_name: null, period: null, sure: true, unsure_reason: null, ...p,
}) as LlmReading
const one = (amount: number, extra: Partial<LlmReading['entries'][number]> = {}) =>
  R({ entries: [{ name: 'Ramesh', amount, direction: 'credit', day_offset: 0, promise: false, ...extra }] })

describe('validate', () => {
  it('keeps an amount that was said', () => {
    const v = validate('Ramesh ka 340 udhaar', one(340))
    expect(v.type === 'entries' && v.entries[0].amount.value).toBe(340)
  })

  it.each([
    ['Ramesh ka 340 udhaar', 430, 'a different number'],
    ['Ramesh ka 340 aur 200', 540, 'a sum of two said amounts'],
  ])('refuses %s -> %d (%s)', (text, amount) => expect(validate(text, one(amount)).type).toBe('unknown'))

  it('allows the other reading of a confusable word, but only as low confidence (asked)', () => {
    const v = validate('Deepak ne saath rupaye diye', one(7, { direction: 'payment' }))
    expect(v.type === 'entries' && [v.entries[0].amount.value, v.entries[0].confidence]).toEqual([7, 'low'])
  })

  it('a correction to an amount that was never said is refused', () => {
    expect(validate('nahi wo galat hai', R({ intent: 'correct', correction: { amount: 430, direction: null, name: null } })).type).toBe('no')
    const ok = validate('nahi, chaar sau tees', R({ intent: 'correct', correction: { amount: 430, direction: null, name: null } }))
    expect(ok.type === 'correct' && ok.amount?.value).toBe(430)
  })

  it('a model "promise" on a credit is not a promise, and a far-off day is capped at 30', () => {
    const v = validate('Ramesh ka 340', one(340, { day_offset: 99999, promise: true }))
    expect(v.type === 'entries' && [v.entries[0].promise, v.entries[0].dayOffset]).toEqual([false, 30])
  })
})

describe('guard on confident model guesses', () => {
  const entry = (name: string, direction: 'credit' | 'payment') => ({ intent: 'entries' as const, sure: true, entries: [{ name, amount: 340, direction, day_offset: 0, promise: false }] })
  const reasons = (t: string, r: ReturnType<typeof entry>) => {
    const i = validate(t, r)
    return i.type === 'entries' ? i.entries[0].reasons : []
  }
  it('a credit/paid word the sentence never had is marked guessed (read back)', () => {
    expect(reasons('Ramesh wale 340 ka scene', entry('Ramesh', 'credit'))).toContain('direction-guessed')
    expect(reasons('Ramesh ka 340 udhaar wala scene', entry('Ramesh', 'credit'))).not.toContain('direction-guessed')
  })
  it('a name the sentence never had is marked changed (read back), in any script', () => {
    expect(reasons('Sunitu ka 340 udhaar', entry('Geeta', 'credit'))).toContain('name-changed')
    expect(reasons('रमेश का 340 उधार', entry('Ramesh', 'credit'))).not.toContain('name-changed')
  })
  it('a name the model altered (Sunitu -> Sunita) is read back', () => {
    const sunita = entry('Sunita', 'credit')
    sunita.entries[0].amount = 1000
    expect(reasons('Sunitu dobar 1,000 rupees on credit', sunita)).toContain('name-changed')
    expect(reasons('रमेश का 340 उधार', entry('Ramesh', 'credit'))).not.toContain('name-changed')
  })
})
