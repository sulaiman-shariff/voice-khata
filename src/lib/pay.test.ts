import { describe, expect, it } from 'vitest'
import { isUpiId, readPayRequest, upiUri } from './pay'

describe('UPI pay links', () => {
  it('accepts name@bank UPI IDs only', () => {
    expect(isUpiId('sharma@okaxis')).toBe(true)
    expect(isUpiId('9876543210@ybl')).toBe(true)
    expect(isUpiId('sharma.kirana-1@oksbi')).toBe(true)
    expect(isUpiId('sharma')).toBe(false)
    expect(isUpiId('@okaxis')).toBe(false)
    expect(isUpiId('a b@okaxis')).toBe(false)
    expect(isUpiId(undefined)).toBe(false)
  })
  it('builds the standard upi://pay link', () => {
    const u = new URL(upiUri({ pa: 'sharma@okaxis', pn: 'Sharma Kirana', am: 500, tn: 'Khata: Ramesh' }).replace('upi://', 'http://x/'))
    expect(u.searchParams.get('pa')).toBe('sharma@okaxis')
    expect(u.searchParams.get('pn')).toBe('Sharma Kirana')
    expect(u.searchParams.get('am')).toBe('500.00')
    expect(u.searchParams.get('cu')).toBe('INR')
    expect(u.searchParams.get('tn')).toBe('Khata: Ramesh')
    expect(upiUri({ pa: 'a@b', pn: '', am: 0, tn: '' })).not.toContain('am=')
  })
  it('reads the pay page query, rejecting a bad UPI ID or amount', () => {
    expect(readPayRequest('?pa=sharma%40okaxis&pn=Sharma&am=340.5&tn=x')).toEqual({ pa: 'sharma@okaxis', pn: 'Sharma', am: 340.5, tn: 'x' })
    expect(readPayRequest('?pa=evil&am=10')).toBeNull()
    expect(readPayRequest('?pa=ab@okaxis&am=-5')?.am).toBe(0)
  })
})
