import { createHash, createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { LANGS } from '../../shared/replies.js'
import { buildReminder } from '../../shared/reminder.js'
import { parseInbound, verifyVonageJwt } from '../remind/vonage.js'
import { waIntent, waPromise } from './intent.js'
import { dueForReminder, istDay, isDaytime } from './policy.js'
import { withMenu } from './reminders.js'
import { promiseNoted, waTexts } from './texts.js'
import { VOICE_NOTE_MAX_S, voiceNoteText, type VoiceNoteDeps } from './voicenote.js'

describe('customer replies', () => {
  it('numbers and button payloads', () => {
    expect(waIntent('1')).toBe('pay')
    expect(waIntent(' 2 ')).toBe('balance')
    expect(waIntent('3.')).toBe('dispute')
    expect(waIntent('', 'PAY')).toBe('pay')
    expect(waIntent('anything', 'STOP')).toBe('stop')
  })
  it('STOP in every language, before anything else', () => {
    for (const w of ['STOP', 'stop please', 'बंद', 'band karo', 'ನಿಲ್ಲಿಸಿ', 'நிறுத்து', 'ఆపండి', 'നിർത്തൂ', 'বন্ধ', 'બંધ', 'ਬੰਦ']) expect(waIntent(w)).toBe('stop')
  })
  it('words', () => {
    expect(waIntent('yeh galat hai')).toBe('dispute')
    expect(waIntent('mera hisab batao')).toBe('balance')
    expect(waIntent('pay now')).toBe('pay')
    expect(waIntent('hello')).toBe('other')
    expect(waIntent('')).toBe('other')
  })
})

describe('automatic reminder rule', () => {
  // 11:00 in India
  const day = new Date('2026-11-22T05:30:00Z')
  it('India day and daytime', () => {
    expect(istDay(new Date('2026-11-22T20:00:00Z'))).toBe('2026-11-23')
    expect(isDaytime(day)).toBe(true)
    expect(isDaytime(new Date('2026-11-22T16:00:00Z'))).toBe(false) // 21:30
    expect(isDaytime(new Date('2026-11-22T03:00:00Z'))).toBe(false) // 08:30
  })
  it('owes, and the last reminder was every-N-days ago', () => {
    expect(dueForReminder({ balancePaise: 100, lastRemindedAt: null, everyDays: 7 }, day)).toBe(true)
    expect(dueForReminder({ balancePaise: 0, lastRemindedAt: null, everyDays: 7 }, day)).toBe(false)
    expect(dueForReminder({ balancePaise: -500, lastRemindedAt: null, everyDays: 7 }, day)).toBe(false)
    expect(dueForReminder({ balancePaise: 100, lastRemindedAt: new Date(day.getTime() - 6 * 86_400_000), everyDays: 7 }, day)).toBe(false)
    expect(dueForReminder({ balancePaise: 100, lastRemindedAt: new Date(day.getTime() - 7 * 86_400_000), everyDays: 7 }, day)).toBe(true)
  })
  it('never at night', () => {
    expect(dueForReminder({ balancePaise: 100, lastRemindedAt: null, everyDays: 1 }, new Date('2026-11-22T18:00:00Z'))).toBe(false)
  })
})

describe('messages', () => {
  it('menu goes just above the opt-out line', () => {
    const msg = withMenu(buildReminder({ lang: 'en', shopName: 'Sharma Kirana', customerName: 'Ramesh', owedPaise: 50000, payUrl: 'https://rzp.io/rzp/abc' }), 'en')
    const lines = msg.split('\n')
    expect(lines.at(-1)).toContain('STOP')
    expect(lines.at(-2)).toBe('Reply: 1 Pay now · 2 See balance · 3 This is wrong')
    expect(msg).toContain('https://rzp.io/rzp/abc')
    expect(msg).toContain('*₹500*')
  })
  it('every language has every reply', () => {
    for (const l of LANGS) {
      const t = waTexts(l)
      expect(t.menu()).toMatch(/1.*2.*3/)
      expect(t.receipt('A', 100, 0, 'S')).toContain('S')
      expect(t.receipt('A', 100, 50, 'S')).toContain('50')
      expect(t.payLine(500, 'https://x')).toContain('https://x')
      for (const f of [t.stopped(), t.unknown(), t.payFailed(), t.dispute('S'), t.balance('A', 0, 'S')]) expect(f.length).toBeGreaterThan(5)
    }
  })
})

describe('Vonage webhooks', () => {
  const secret = 'sig-secret'
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const sign = (claims: object, key = secret) => {
    const h = b64({ alg: 'HS256', typ: 'JWT' })
    const p = b64(claims)
    return `Bearer ${h}.${p}.${createHmac('sha256', key).update(`${h}.${p}`).digest('base64url')}`
  }
  const body = '{"channel":"whatsapp","message_uuid":"m1","from":"919845012345","message_type":"text","text":"1"}'
  const hash = createHash('sha256').update(body).digest('hex')
  const now = Date.parse('2026-11-22T06:00:00Z')
  it('accepts a signed body', () => {
    expect(verifyVonageJwt(sign({ iat: now / 1000, payload_hash: hash }), body, secret, now)).toBe(true)
  })
  it('refuses a wrong key, a swapped body, an old token, no token', () => {
    expect(verifyVonageJwt(sign({ iat: now / 1000, payload_hash: hash }, 'other'), body, secret, now)).toBe(false)
    expect(verifyVonageJwt(sign({ iat: now / 1000, payload_hash: hash }), body.replace('"1"', '"3"'), secret, now)).toBe(false)
    expect(verifyVonageJwt(sign({ iat: now / 1000 - 3 * 86400, payload_hash: hash }), body, secret, now)).toBe(false)
    expect(verifyVonageJwt(null, body, secret, now)).toBe(false)
  })
  it('reads text, quick replies and buttons', () => {
    expect(parseInbound(JSON.parse(body))).toEqual({ messageId: 'm1', from: '919845012345', text: '1' })
    expect(parseInbound({ channel: 'whatsapp', message_uuid: 'm2', from: '+91 98450 12345', message_type: 'reply', reply: { id: 'PAY', title: 'Pay now' } }))
      .toEqual({ messageId: 'm2', from: '919845012345', text: 'Pay now', payload: 'PAY' })
    expect(parseInbound({ channel: 'sms', message_uuid: 'x', from: '1' })).toBeNull()
  })
})

describe('promises in a reply ("kal de dunga")', () => {
  // Sunday = 0
  it('a will-pay word and a day', () => {
    expect(waPromise('kal de dunga', 0)).toEqual({ dayOffset: 1 })
    expect(waPromise('Bhaiya kal 500 bhej dunga', 0)).toEqual({ dayOffset: 1, paise: 50000 })
    expect(waPromise('parso de dungi', 3)).toEqual({ dayOffset: 2 })
    expect(waPromise('will pay tomorrow', 0)).toEqual({ dayOffset: 1 })
    expect(waPromise('कल दूंगा', 0)).toEqual({ dayOffset: 1 })
    expect(waPromise('aaj shaam ko de dunga', 0)).toEqual({ dayOffset: 0 })
  })
  it('a weekday: the next one (a week ahead when it is today)', () => {
    expect(waPromise('somvaar ko de dunga', 0)).toEqual({ dayOffset: 1 })
    expect(waPromise('will pay on monday', 1)).toEqual({ dayOffset: 7 })
    expect(waPromise('friday ko 300 denge', 3)).toEqual({ dayOffset: 2, paise: 30000 })
  })
  it('not a promise: no day, past tense, or other talk', () => {
    expect(waPromise('de dunga', 0)).toBeNull()
    expect(waPromise('kal de diya tha', 0)).toBeNull()
    expect(waPromise('mera hisab batao', 0)).toBeNull()
    expect(waPromise('', 0)).toBeNull()
  })
  it('thanked in every language', () => {
    for (const l of LANGS) expect(promiseNoted(l, 'Sharma Kirana')).toContain('Sharma Kirana')
  })
})

describe('voice notes', () => {
  it('reads an audio message', () => {
    expect(parseInbound({ channel: 'whatsapp', message_uuid: 'm3', from: '919845012345', message_type: 'audio', audio: { url: 'https://api.nexmo.com/v3/media/abc' } }))
      .toEqual({ messageId: 'm3', from: '919845012345', text: '', audioUrl: 'https://api.nexmo.com/v3/media/abc' })
    expect(parseInbound({ channel: 'whatsapp', message_uuid: 'm4', from: '91', message_type: 'audio', audio: { url: 'http://insecure' } })?.audioUrl).toBeUndefined()
  })
  const deps = (seconds: number, said = 'kal de dunga'): VoiceNoteDeps & { heard: string[] } => {
    const heard: string[] = []
    return {
      heard,
      download: async () => Buffer.from('OggS'),
      decode: async () => Buffer.alloc(Math.round(seconds * 32000)),
      transcribe: async (_pcm, locale) => { heard.push(locale); return said },
    }
  }
  it('transcribes a short note in the shop language', async () => {
    const d = deps(4)
    expect(await voiceNoteText('https://x', 'kn', d)).toEqual({ text: 'kal de dunga' })
    expect(d.heard).toEqual(['kn-IN'])
  })
  it(`skips notes over ${VOICE_NOTE_MAX_S} s, empty audio, failures, and no STT key`, async () => {
    expect(await voiceNoteText('https://x', 'hi', deps(VOICE_NOTE_MAX_S + 1))).toEqual({ skipped: 'too_long' })
    expect(await voiceNoteText('https://x', 'hi', deps(0.1))).toEqual({ skipped: 'failed' })
    expect(await voiceNoteText('https://x', 'hi', { ...deps(3), download: async () => { throw new Error('404') } })).toEqual({ skipped: 'failed' })
    expect(await voiceNoteText('https://x', 'hi', { ...deps(3), transcribe: null })).toEqual({ skipped: 'unconfigured' })
    expect(await voiceNoteText('https://x', 'hi', deps(3, '  '))).toEqual({ skipped: 'failed' })
  })
})
