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
})
