import { describe, expect, it } from 'vitest'
import { DEAD_AFTER_MS, NetMonitor, REPLAY_MAX_MS, SLOW_FOR_MS, SpeechBuffer, TurnTracker, backoffMs } from './link.js'

describe('TurnTracker', () => {
  it('a transcript whose ops never arrived is handed back after a drop', () => {
    const t = new TurnTracker()
    t.onFinal('Suleman gave me 300. Mahi gave me 400.', 1000)
    expect(t.onDrop()).toBe('Suleman gave me 300. Mahi gave me 400.')
    expect(t.onDrop()).toBeNull() // only once
  })
  it('a turn whose ops arrived is saved: nothing to redo', () => {
    const t = new TurnTracker()
    t.onFinal('Ramesh 340 udhaar', 1000)
    t.onOps()
    expect(t.onDrop()).toBeNull()
  })
  it('a finished turn is not redone', () => {
    const t = new TurnTracker()
    t.onFinal('Ramesh ka total?', 1000)
    t.onTurnDone(1500)
    expect(t.onDrop()).toBeNull()
    expect(t.lastTurnDoneAt).toBe(1500)
  })
})

describe('SpeechBuffer', () => {
  const buf = (n: number) => new ArrayBuffer(n)
  it('replays only frames after the last transcript, and only if there was speech', () => {
    const b = new SpeechBuffer()
    for (let i = 0; i < 100; i++) b.push(buf(1024), i >= 60 && i < 80 ? 0.2 : 0.001, i * 32)
    const since = 50 * 32
    const w = b.replayWindow(since, 100 * 32, 0.02)
    expect(w.length).toBe(49) // frames 51..99
    expect(b.replayWindow(85 * 32, 100 * 32, 0.02)).toEqual([]) // only silence after the last final
  })
  it('never replays more than REPLAY_MAX_MS and keeps a bounded history', () => {
    const b = new SpeechBuffer()
    for (let i = 0; i < 1000; i++) b.push(buf(1024), 0.2, i * 32) // 32 s of speech
    const w = b.replayWindow(0, 1000 * 32, 0.02)
    expect(w.length * 32).toBeLessThanOrEqual(REPLAY_MAX_MS + 32)
  })
})

describe('NetMonitor', () => {
  it('declares a link dead when the server goes quiet, not before', () => {
    const m = new NetMonitor()
    m.onOpen(0)
    expect(m.isDead(DEAD_AFTER_MS - 1)).toBe(false)
    expect(m.isDead(DEAD_AFTER_MS + 1)).toBe(true)
    m.onMessage(DEAD_AFTER_MS + 1)
    expect(m.isDead(DEAD_AFTER_MS + 2)).toBe(false)
  })
  it('is slow only after a sustained high RTT or socket backlog', () => {
    const m = new NetMonitor()
    m.onOpen(0)
    m.onPong(0, 1500) // rtt 1500
    expect(m.evaluate(1500, 0)).toBe('good')
    m.onMessage(1500 + SLOW_FOR_MS)
    expect(m.evaluate(1500 + SLOW_FOR_MS, 0)).toBe('slow')
    m.onPong(5000, 5100)
    expect(m.evaluate(5100, 0)).toBe('good')
    expect(m.evaluate(5200, 200_000)).toBe('good')
    expect(m.evaluate(5200 + SLOW_FOR_MS, 200_000)).toBe('slow')
  })
  it('is offline when closed', () => {
    const m = new NetMonitor()
    m.onOpen(0)
    m.onClose()
    expect(m.evaluate(10, 0)).toBe('offline')
    expect(m.isDead(1e9)).toBe(false)
  })
  it('backs off quickly first, then holds at 5 s', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(backoffMs)).toEqual([250, 500, 1000, 2000, 4000, 5000, 5000])
  })
})

describe('a re-sent turn', () => {
  it('stays in flight until its result arrives, so a second drop re-sends it again', () => {
    const t = new TurnTracker()
    t.onFinal('Ramesh 340 udhaar', 1000)
    const again = t.onDrop()!
    t.onFinal(again, 2000) // what voice.ts does after putting it in the next hello
    expect(t.onDrop()).toBe('Ramesh 340 udhaar') // the new link died too
    t.onFinal(again, 3000)
    t.onOps()
    expect(t.onDrop()).toBeNull() // saved this time
  })
})
