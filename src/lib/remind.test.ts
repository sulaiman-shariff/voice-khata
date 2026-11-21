import { afterEach, describe, expect, it, vi } from 'vitest'
import { type LedgerEvent, reduce } from '../../shared/ledger.js'
import { LANGS, pressingWord, reminderWords } from '../../shared/replies.js'
import { reminderMessage } from './remind'
import { defaultSettings } from './store'

const state = reduce(([
  { type: 'customer_added', cid: 'r', name: 'Ramesh', aliases: [] },
  { type: 'entry', eid: 'e1', cid: 'r', paise: 50000, direction: 'credit', day: '2026-11-20' },
] as LedgerEvent[]).map((ev, i) => ({ ev, ts: i })))

const emojis = (s: string) => s.match(/\p{Extended_Pictographic}/gu) ?? []

describe('WhatsApp reminder message', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('businesslike: shop header, bold balance, settle or pay online, thanks, signature, opt-out', () => {
    vi.stubGlobal('location', { origin: 'https://khatabhai.example' })
    const msg = reminderMessage(state, {
      ...defaultSettings(), lang: 'en', shopName: 'Sharma Kirana', ownerName: 'Rakesh', shopAddress: 'Jayanagar', shopPhone: '9876543210', shopUpi: 'sharma@okaxis',
    }, 'r')
    expect(msg.split('\n')).toEqual([
      '*Sharma Kirana* — Payment reminder',
      '',
      'Hi Ramesh, your khata balance with us is *₹500*.',
      'Please settle it on your next visit, or pay online here:',
      'https://khatabhai.example/pay?pa=sharma%40okaxis&pn=Sharma+Kirana&tn=Khata%3A+Ramesh&am=500',
      'UPI: *sharma@okaxis*',
      '',
      'Thank you 🙏',
      'Rakesh · Jayanagar · 9876543210',
      '',
      '_KhataBhai · Reply STOP to stop these reminders._',
    ])
  })

  it('without a UPI ID: settle on the next visit, no pay line', () => {
    const msg = reminderMessage(state, { ...defaultSettings(), lang: 'hi', shopName: 'Sharma Kirana' }, 'r')
    expect(msg).not.toContain('UPI')
    expect(msg).toContain('*₹500*')
    expect(msg).toContain('अगली बार आने पर चुका दें।')
    expect(msg).toContain('"बंद"')
  })

  it('every language: no pleading or pressing words, at most one emoji', () => {
    for (const l of LANGS) {
      const w = reminderWords(l)
      const lines = [w.header('Sharma Kirana'), w.balance('Ramesh', '₹500'), w.settleOnline, w.settle, w.thanks, w.optOut]
      for (const line of lines) expect(pressingWord(line), `${l}: ${line}`).toBe(false)
      expect(emojis(lines.join('\n')).length, l).toBeLessThanOrEqual(1)
    }
  })
})

describe('Twilio status check', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('a failed check is asked again (server restarting), and a yes is remembered', async () => {
    const { twilioReady } = await import('./remind')
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error('server restarting'))
      .mockResolvedValueOnce({ json: async () => ({ configured: true }) })
    vi.stubGlobal('fetch', fetch)
    expect(await twilioReady(true)).toBe(false)
    expect(await twilioReady(true)).toBe(true)
    expect(await twilioReady()).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
