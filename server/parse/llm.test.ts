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
