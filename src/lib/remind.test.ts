import { afterEach, describe, expect, it, vi } from 'vitest'
import { type LedgerEvent, reduce } from '../../shared/ledger.js'
import { LANGS, pressingWord, reminderWords } from '../../shared/replies.js'
import { reminderMessage } from './remind'
import { defaultSettings } from './store'

const state = reduce(([
  { type: 'customer_added', cid: 'r', name: 'Ramesh', aliases: [] },
  { type: 'entry', eid: 'e1', cid: 'r', paise: 50000, direction: 'credit', day: '2026-11-20' },
] as LedgerEvent[]).map((ev, i) => ({ ev, ts: i })))

describe('WhatsApp reminder message', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads as a friendly note: greeting, balance, pay link, thanks, signature, how to stop', () => {
    vi.stubGlobal('location', { origin: 'https://khatabhai.example' })
    const msg = reminderMessage(state, {
      ...defaultSettings(), lang: 'en', shopName: 'Sharma Kirana', ownerName: 'Rakesh', shopAddress: 'Jayanagar', shopPhone: '9876543210', shopUpi: 'sharma@okaxis',
    }, 'r')
    const lines = msg.split('\n')
    expect(lines[0]).toBe('👋 Hi Ramesh! A friendly reminder from Sharma Kirana.')
    expect(msg).toContain('Your khata balance is *₹500*.')
    expect(msg).toMatch(/Pay whenever it suits you 👉 https:\/\/khatabhai\.example\/pay\?pa=sharma%40okaxis&pn=Sharma\+Kirana&tn=Khata%3A\+Ramesh&am=500/)
    expect(msg).toContain('UPI: sharma@okaxis')
    expect(msg).toContain('— Rakesh · Jayanagar · 📞 9876543210')
    expect(lines.at(-1)).toBe('Sent via KhataBhai · reply STOP to stop these messages')
  })

  it('without a UPI ID there is no pay line', () => {
    const msg = reminderMessage(state, { ...defaultSettings(), lang: 'hi', shopName: 'Sharma Kirana' }, 'r')
    expect(msg).not.toContain('UPI')
    expect(msg).toContain('*₹500*')
    expect(msg).toContain('"बंद"')
  })

  it('no language pleads or presses', () => {
    for (const l of LANGS) {
      const w = reminderWords(l)
      for (const line of [w.greet('Ramesh', 'Sharma Kirana'), w.balance('₹500'), w.pay, w.thanks, w.optOut]) expect(pressingWord(line), `${l}: ${line}`).toBe(false)
    }
  })
})
