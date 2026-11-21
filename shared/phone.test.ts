import { describe, expect, it } from 'vitest'
import { displayPhone, normalizePhone } from './phone.js'

describe('normalizePhone', () => {
  it('adds 91 to a bare Indian mobile, whatever the spacing', () => {
    expect(normalizePhone('98450 12345')).toBe('919845012345')
    expect(normalizePhone('+91-98450-12345')).toBe('919845012345')
    expect(normalizePhone('098450 12345')).toBe('919845012345')
    expect(normalizePhone('919845012345')).toBe('919845012345')
  })
  it('keeps other country codes', () => {
    expect(normalizePhone('+1 415 738 6102')).toBe('14157386102')
  })
  it('refuses what cannot be a number', () => {
    expect(normalizePhone('')).toBeNull()
    expect(normalizePhone(undefined)).toBeNull()
    expect(normalizePhone('12345')).toBeNull()
    expect(normalizePhone('1'.repeat(16))).toBeNull()
  })
  it('displays Indian numbers in the familiar grouping', () => {
    expect(displayPhone('919845012345')).toBe('+91 98450 12345')
    expect(displayPhone('14157386102')).toBe('+14157386102')
  })
})
