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
    expect(spotWake('Khatabai Ramesh 300', { fuzzy: true })).toMatchObject({ found: true, rest: 'Ramesh 300' })
    expect(spotWake('Khatabhei Ramesh', { fuzzy: true }).found).toBe(true)
    expect(spotWake('Khatabhei Ramesh').found).toBe(false)
    expect(spotWake('khata', { fuzzy: true }).found).toBe(false)
    expect(spotWake('bhai 300', { fuzzy: true }).found).toBe(false)
  })
  it('asleep, catches how recognisers mishear it at the start of a turn', () => {
    for (const t of ['Hata bhai, Ramesh 300 udhaar', 'Khadha bhai Mohan 50 jama', 'Hatabhai Ramesh 300',
      'हटा भाई रमेश 300', 'खड़ा भाई सुरेश', 'ಹಾತಾ ಭಾಯ್ ರಮೇಶ್', 'ಖಾದಾ ಭಾಯ್']) expect(spotWake(t, { weak: true }).found, t).toBe(true)
    expect(spotWake('Hata bhai, Ramesh 300 udhaar', { weak: true }).rest).toBe('Ramesh 300 udhaar')
  })
  it('"aata bhai" (aata is flour) wakes only to confirm the phone detector', () => {
    for (const t of ['Aata bhai 300 ka hua', 'ata bhai Suresh ka hisaab', 'Aata Bhai.', 'आता भाई', 'ಆತಾ ಭಾಯ್']) {
      expect(spotWake(t, { weak: true }).found, t).toBe(false)
      expect(spotWake(t, { weak: true, fuzzy: true }).found, t).toBe(true)
    }
  })
  it('awake, the misheard forms are ordinary words: never a wake, never stripped', () => {
    for (const t of ['hata bhai', 'Hata bhai, Ramesh 300 udhaar', 'Hatabhai', 'Khadha bhai Mohan 50 jama']) expect(spotWake(t), t).toEqual({ found: false, rest: t })
    expect(spotWake('KhataBhai, Ramesh 300 udhaar')).toEqual({ found: true, rest: 'Ramesh 300 udhaar' })
  })
  it('ordinary chatter does not wake', () => {
    for (const t of ['aata hai', 'abhi aata hai bhai', 'bhai sahab', 'bhai sahab aaiye', 'hata do', 'isko hata do', 'isko hata bhai', 'khana kha lo',
      'khana', 'aata do kilo', 'आता है', 'भाई साहब', 'हटा दो', 'खाना खा लो', 'ಹಟ ಮಾಡಬೇಡ', 'kal aata bhai', 'ata hai bhai', 'hata', 'bhai']) {
      expect(spotWake(t, { weak: true }).found, t).toBe(false)
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
