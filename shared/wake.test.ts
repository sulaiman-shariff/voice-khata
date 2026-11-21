import { describe, expect, it } from 'vitest'
import { isSleepWord, spotWake } from './wake.js'

describe('spotWake', () => {
  it('finds the word and returns the rest', () => {
    expect(spotWake('KhataBhai, Ramesh 300 udhaar')).toEqual({ found: true, rest: 'Ramesh 300 udhaar' })
  })
  it('works in other scripts', () => {
    expect(spotWake('खाता भाई रमेश 300')).toMatchObject({ found: true, rest: 'रमेश 300' })
    expect(spotWake('ಖಾತಾ ಭಾಯ್').found).toBe(true)
    expect(spotWake('Khata Bhai').rest).toBe('')
  })
  it('finds it mid-sentence', () => {
    expect(spotWake('bolo KhataBhai wale bhaiya ko')).toEqual({ found: true, rest: 'bolo wale bhaiya ko' })
  })
  it('ignores talk that merely has khata or bhai', () => {
    expect(spotWake('Ramesh ka khata kholo').found).toBe(false)
    expect(spotWake('bhai 300 do').found).toBe(false)
  })
})

describe('isSleepWord', () => {
  it('knows bas / ho gaya / theek hai bas', () => {
    for (const t of ['bas', 'Bas.', 'ho gaya', 'theek hai bas', 'बस', 'हो गया', 'ठीक है बस', 'ಸಾಕು', "that's all"]) expect(isSleepWord(t), t).toBe(true)
  })
  it('does not take a ledger line for it', () => {
    for (const t of ['Ramesh 300', 'bas 300 ka', 'ho gaya Ramesh ka']) expect(isSleepWord(t), t).toBe(false)
  })
})
