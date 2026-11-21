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
  it('knows the spelling variants', () => {
    for (const t of ['खाते भाई रमेश', 'Khate Bhai', 'ಖಾತಾ ಬಾಯಿ', 'Khata Bye', 'khata bai']) expect(spotWake(t).found, t).toBe(true)
  })
  it('a phone wake accepts a one-letter slip in the joined key', () => {
    expect(spotWake('Khatabai Ramesh 300', true)).toMatchObject({ found: true, rest: 'Ramesh 300' })
    expect(spotWake('Khatabhei Ramesh', true).found).toBe(true)
    expect(spotWake('Khatabhei Ramesh', false).found).toBe(false)
    expect(spotWake('khata', true).found).toBe(false)
    expect(spotWake('bhai 300', true).found).toBe(false)
  })
  it('catches how recognisers mishear it at the start of a turn', () => {
    for (const t of ['Hata bhai, Ramesh 300 udhaar', 'ata bhai Suresh ka hisaab', 'Khadha bhai Mohan 50 jama', 'Aata Bhai.', 'Hatabhai Ramesh 300',
      'हटा भाई रमेश 300', 'आता भाई', 'खड़ा भाई सुरेश', 'ಹಾತಾ ಭಾಯ್ ರಮೇಶ್', 'ಆತಾ ಭಾಯ್', 'ಖಾದಾ ಭಾಯ್']) expect(spotWake(t).found, t).toBe(true)
    expect(spotWake('Hata bhai, Ramesh 300 udhaar').rest).toBe('Ramesh 300 udhaar')
  })
  it('ordinary chatter does not wake', () => {
    for (const t of ['aata hai', 'abhi aata hai bhai', 'bhai sahab', 'bhai sahab aaiye', 'hata do', 'isko hata do', 'isko hata bhai', 'khana kha lo',
      'khana', 'aata do kilo', 'आता है', 'भाई साहब', 'हटा दो', 'खाना खा लो', 'ಹಟ ಮಾಡಬೇಡ', 'kal aata bhai', 'ata hai bhai', 'hata', 'bhai']) {
      expect(spotWake(t).found, t).toBe(false)
    }
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
    for (const t of ['Ramesh 300', 'Basu', 'bas 300 ka', 'ho gaya Ramesh ka']) expect(isSleepWord(t), t).toBe(false)
  })
})
