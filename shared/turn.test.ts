import { describe, expect, it } from 'vitest'
import { turnComplete } from './intent.js'

describe('turnComplete', () => {
  it.each([
    'Ramesh ka 340 udhaar',
    'रमेश का 340 रुपये उधार लिख दो',
    'Suresh ne 60 rupaye jama kiye',
    'Anil ko sawa sau udhaar diya',
    'Ramesh ka 340 udhaar, kal 200 diya tha',
    'ರಮೇಶ್ ಮುನ್ನೂರ ನಲವತ್ತು ರೂಪಾಯಿ ಕೊಟ್ಟರು',
    'Sunita took 1,500 rupees on credit.',
    'haan', 'nahi', 'nahi, 430', 'hata do',
    'Ramesh ka total kitna hai',
    'aaj ka hisaab batao',
  ])('complete: %s', (t) => expect(turnComplete(t)).toBe(true))

  it.each([
    'Ramesh ka',
    'Ramesh ka teen sau',
    'Ramesh ka 340',
    'Ramesh ka 340 rupaye',
    'Ramesh ka 340 udhaar aur',
    'Ramesh ne kal',
    'रमेश का 340 रुपये उधार लिख',
    'Ramesh ka do',
    'Ramesh 340',
    'Ramesh ka total',
    '',
  ])('not yet: %s', (t) => expect(turnComplete(t)).toBe(false))
})
