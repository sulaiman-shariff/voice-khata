import { describe, expect, it } from 'vitest'
import { type LlmReading, validate } from './llm.js'

const R = (p: Partial<LlmReading>): LlmReading => ({
  intent: 'entries', entries: [], correction: null, query_name: null, period: null, sure: true, unsure_reason: null, ...p,
})

describe('validate (no invented money)', () => {
  it('keeps an amount the parser heard', () => {
    const i = validate('Ramesh ka 340 udhaar', R({ entries: [{ name: 'Ramesh', amount: 340, direction: 'credit', day_offset: 0, promise: false }] }))
    expect(i.type === 'entries' && i.entries[0].amount.value).toBe(340)
    expect(i.type === 'entries' && i.entries[0].confidence).toBe('high')
  })
  it('drops an amount that was never said', () => {
    const i = validate('Ramesh ka 340 udhaar', R({ entries: [{ name: 'Ramesh', amount: 430, direction: 'credit', day_offset: 0, promise: false }] }))
    expect(i.type).toBe('unknown')
  })
  it('drops a summed amount', () => {
    const i = validate('Ramesh ka 340 aur 200', R({ entries: [{ name: 'Ramesh', amount: 540, direction: 'credit', day_offset: 0, promise: false }] }))
    expect(i.type).toBe('unknown')
  })
  it('accepts a confusable alternative but marks it low', () => {
    const i = validate('Deepak ne saath rupaye diye', R({ entries: [{ name: 'Deepak', amount: 7, direction: 'payment', day_offset: 0, promise: false }] }))
    expect(i.type === 'entries' && i.entries[0].amount.value).toBe(7)
    expect(i.type === 'entries' && i.entries[0].confidence).toBe('low')
  })
  it('unsure model output is low', () => {
    const i = validate('Ramesh 340', R({ sure: false, unsure_reason: 'direction unclear', entries: [{ name: 'Ramesh', amount: 340, direction: null, day_offset: 0, promise: false }] }))
    expect(i.type === 'entries' && i.entries[0].confidence).toBe('low')
  })
  it('correction to an unheard amount is refused', () => {
    expect(validate('nahi wo galat hai', R({ intent: 'correct', correction: { amount: 430, direction: null, name: null } })).type).toBe('no')
  })
  it('correction to a heard amount passes', () => {
    const i = validate('nahi, chaar sau tees', R({ intent: 'correct', correction: { amount: 430, direction: null, name: null } }))
    expect(i.type === 'correct' && i.amount?.value).toBe(430)
  })
})
