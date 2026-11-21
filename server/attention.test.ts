import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Attention } from './attention.js'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Attention', () => {
  it('starts asleep and sleeps 15 s after touch()', () => {
    const a = new Attention()
    const seen: string[] = []
    a.onChange((s) => seen.push(s))
    expect(a.state).toBe('asleep')
    a.wake('word')
    vi.advanceTimersByTime(10_000)
    a.touch()
    vi.advanceTimersByTime(14_999)
    expect(a.state).toBe('awake')
    vi.advanceTimersByTime(1)
    expect(a.state).toBe('asleep')
    expect(seen).toEqual(['awake', 'asleep'])
  })

  it('stays awake past 15 s while a question is open, and sleeps at 45 s', () => {
    const t0 = Date.now()
    const a = new Attention({ hasPending: () => true, pendingAgeMs: () => Date.now() - t0 })
    a.wake('tap')
    vi.advanceTimersByTime(30_000)
    expect(a.state).toBe('awake')
    vi.advanceTimersByTime(14_999)
    expect(a.state).toBe('awake')
    vi.advanceTimersByTime(1)
    expect(a.state).toBe('asleep')
  })

  it('hold keeps it awake until hold_end, then 15 s', () => {
    const a = new Attention()
    a.holdStart()
    vi.advanceTimersByTime(60_000)
    expect(a.state).toBe('awake')
    a.holdEnd()
    vi.advanceTimersByTime(14_999)
    expect(a.state).toBe('awake')
    vi.advanceTimersByTime(1)
    expect(a.state).toBe('asleep')
  })

  it('sleep() is immediate', () => {
    const a = new Attention()
    a.wake('word')
    a.sleep()
    expect(a.state).toBe('asleep')
  })

  it('speech postpones expiry only until that utterance ends; it never restarts the window', () => {
    const a = new Attention()
    a.wake('tap')
    vi.advanceTimersByTime(14_000)
    a.heard() // speech starts at 14 s
    vi.advanceTimersByTime(3_000)
    a.heard() // partial at 17 s
    expect(a.state).toBe('awake')
    a.turnStart() // its final, at 17 s
    vi.advanceTimersByTime(1_000)
    expect(a.state).toBe('awake') // the turn is still being handled
    a.turnEnd(false) // talk to someone else: nothing said
    expect(a.state).toBe('asleep')
  })

  it('a turn that replied restarts the window from its end', () => {
    const a = new Attention()
    a.wake('tap')
    vi.advanceTimersByTime(10_000)
    a.heard()
    a.turnStart()
    vi.advanceTimersByTime(1_000)
    a.turnEnd(true)
    vi.advanceTimersByTime(14_999)
    expect(a.state).toBe('awake')
    vi.advanceTimersByTime(1)
    expect(a.state).toBe('asleep')
  })

  it('a silent turn before expiry does not extend the window', () => {
    const a = new Attention()
    a.wake('tap')
    vi.advanceTimersByTime(5_000)
    a.heard()
    a.turnStart()
    a.turnEnd(false)
    vi.advanceTimersByTime(10_000)
    expect(a.state).toBe('asleep')
  })

  it('speech that never ends (no final) does not keep it awake forever', () => {
    const a = new Attention()
    a.wake('tap')
    vi.advanceTimersByTime(14_000)
    a.heard()
    vi.advanceTimersByTime(30_000)
    expect(a.state).toBe('asleep')
  })
})
