import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWakeDetector, type WakeWorkerLike } from './index'

class FakeWorker implements WakeWorkerLike {
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  sent: { type: string }[] = []
  terminated = false
  private readonly reply: 'ready' | 'error' | 'silent'
  constructor(reply: 'ready' | 'error' | 'silent') {
    this.reply = reply
  }
  postMessage(msg: { type: string }) {
    this.sent.push(msg)
    if (msg.type === 'init' && this.reply !== 'silent') {
      queueMicrotask(() => this.emit(this.reply === 'ready' ? { type: 'ready' } : { type: 'error', message: 'no model' }))
    }
  }
  emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent)
  }
  terminate() {
    this.terminated = true
  }
  frames() {
    return this.sent.filter((m) => m.type === 'frame')
  }
}

const frame = () => new Int16Array(512).buffer

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createWakeDetector', () => {
  it('returns null when the model cannot load', async () => {
    const w = new FakeWorker('error')
    const d = await createWakeDetector({ threshold: 0.5, createWorker: () => w })
    expect(d).toBeNull()
    expect(w.terminated).toBe(true)
  })

  it('returns null when the worker never answers', async () => {
    const w = new FakeWorker('silent')
    const p = createWakeDetector({ threshold: 0.5, createWorker: () => w, readyTimeoutMs: 1000 })
    await vi.advanceTimersByTimeAsync(1001)
    expect(await p).toBeNull()
  })

  it('frames fed while paused are dropped', async () => {
    const w = new FakeWorker('ready')
    const d = (await createWakeDetector({ threshold: 0.5, createWorker: () => w }))!
    d.feed(frame())
    expect(w.frames()).toHaveLength(1)
    d.pause()
    d.feed(frame())
    d.feed(frame())
    expect(w.frames()).toHaveLength(1)
    d.resume()
    d.feed(frame())
    expect(w.frames()).toHaveLength(2)
  })

  it('a worker wake message calls onWake once and respects a refractory period of 2 s', async () => {
    const w = new FakeWorker('ready')
    const d = (await createWakeDetector({ threshold: 0.5, createWorker: () => w }))!
    const cb = vi.fn()
    d.onWake(cb)
    w.emit({ type: 'wake', score: 0.9 })
    w.emit({ type: 'wake', score: 0.95 })
    expect(cb).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1999)
    w.emit({ type: 'wake', score: 0.9 })
    expect(cb).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(2)
    w.emit({ type: 'wake', score: 0.9 })
    expect(cb).toHaveBeenCalledTimes(2)
  })

  it('a wake that arrives while paused is ignored', async () => {
    const w = new FakeWorker('ready')
    const d = (await createWakeDetector({ threshold: 0.5, createWorker: () => w }))!
    const cb = vi.fn()
    d.onWake(cb)
    d.pause()
    w.emit({ type: 'wake', score: 0.9 })
    expect(cb).not.toHaveBeenCalled()
  })

  it('a worker error after ready disposes the detector and calls onFail', async () => {
    const w = new FakeWorker('ready')
    const d = (await createWakeDetector({ threshold: 0.5, createWorker: () => w }))!
    const fail = vi.fn()
    d.onFail(fail)
    w.emit({ type: 'error', message: 'bad shape' })
    expect(fail).toHaveBeenCalledTimes(1)
    expect(w.terminated).toBe(true)
    d.feed(frame())
    expect(w.frames()).toHaveLength(0)
    w.onerror?.({} as ErrorEvent)
    expect(fail).toHaveBeenCalledTimes(1)
  })

  it('dispose terminates the worker and stops feeding', async () => {
    const w = new FakeWorker('ready')
    const d = (await createWakeDetector({ threshold: 0.5, createWorker: () => w }))!
    d.dispose()
    d.feed(frame())
    expect(w.terminated).toBe(true)
    expect(w.frames()).toHaveLength(0)
  })
})
