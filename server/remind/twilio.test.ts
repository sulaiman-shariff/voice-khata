import { describe, expect, it } from 'vitest'
import { toE164, twilioConfigured } from './twilio.js'

describe('twilio reminders', () => {
  it('normalises Indian mobile numbers to E.164', () => {
    expect(toE164('98765 43210')).toBe('+919876543210')
    expect(toE164('098765-43210')).toBe('+919876543210')
    expect(toE164('919876543210')).toBe('+919876543210')
    expect(toE164('+91 98765 43210')).toBe('+919876543210')
    expect(toE164('+14155238886')).toBe('+14155238886')
  })

  it('rejects numbers that are not phones', () => {
    expect(toE164('12345')).toBeNull()
    expect(toE164('5876543210')).toBeNull() // Indian mobiles start 6-9
    expect(toE164('abc')).toBeNull()
  })

  it('is configured only with both SID and token', () => {
    expect(twilioConfigured({ TWILIO_ACCOUNT_SID: 'AC1' })).toBe(false)
    expect(twilioConfigured({ TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't' })).toBe(true)
  })
})
