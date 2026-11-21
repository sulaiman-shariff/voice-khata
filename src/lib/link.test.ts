/**
 * Bad-network logic: a turn lost to a drop is redone exactly when its result never arrived.
 */
import { describe, expect, it } from 'vitest'
import { DEAD_AFTER_MS, NetMonitor, REPLAY_MAX_MS, SpeechBuffer, TurnTracker } from './link.js'

describe('TurnTracker: re-send a turn only if its ledger ops never arrived', () => {
  it('ops never arrived: the transcript is handed back once', () => {
    const t = new TurnTracker()
    t.onFinal('Suleman gave me 300. Mahi gave me 400.', 1000)
    expect(t.onDrop()).toBe('Suleman gave me 300. Mahi gave me 400.')
    expect(t.onDrop()).toBeNull()
  })

  it('ops arrived, or the turn finished: nothing is re-sent (no double entry)', () => {
    const a = new TurnTracker()
    a.onFinal('Ramesh 340 udhaar', 1000)
    a.onOps()
    expect(a.onDrop()).toBeNull()
    const b = new TurnTracker()
    b.onFinal('Ramesh ka total?', 1000)
    b.onTurnDone(1500)
    expect(b.onDrop()).toBeNull()
  })

  it('a re-sent turn stays in flight until its ops arrive, through a second drop', () => {
    const t = new TurnTracker()
    t.onFinal('Ramesh 340 udhaar', 1000)
    const again = t.onDrop()!
    t.onFinal(again, 2000)
    expect(t.onDrop()).toBe('Ramesh 340 udhaar')
    t.onFinal(again, 3000)
    t.onOps()
    expect(t.onDrop()).toBeNull()
  })
})

describe('SpeechBuffer: speech during a drop is replayed', () => {
  const buf = () => new ArrayBuffer(1024)
  it('replays only frames after the last transcript, only if they hold speech, and at most REPLAY_MAX_MS', () => {
    const b = new SpeechBuffer()
    for (let i = 0; i < 100; i++) b.push(buf(), i >= 60 && i < 80 ? 0.2 : 0.001, i * 32)
    expect(b.replayWindow(50 * 32, 100 * 32, 0.02).length).toBe(49)
    expect(b.replayWindow(85 * 32, 100 * 32, 0.02)).toEqual([]) // only silence since
    const long = new SpeechBuffer()
    for (let i = 0; i < 1000; i++) long.push(buf(), 0.2, i * 32)
    expect(long.replayWindow(0, 1000 * 32, 0.02).length * 32).toBeLessThanOrEqual(REPLAY_MAX_MS + 32)
  })
})

it('NetMonitor declares the link dead when the server goes quiet, not before, and not once closed', () => {
  const m = new NetMonitor()
  m.onOpen(0)
  expect(m.isDead(DEAD_AFTER_MS - 1)).toBe(false)
  expect(m.isDead(DEAD_AFTER_MS + 1)).toBe(true)
  m.onMessage(DEAD_AFTER_MS + 1)
  expect(m.isDead(DEAD_AFTER_MS + 2)).toBe(false)
  m.onClose()
  expect(m.evaluate(10, 0)).toBe('offline')
})
