import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientMsg, Snapshot } from '../../shared/protocol.js'
import { createVoiceClient } from './voice'
import type { WakeDetector } from './wake'

class FakeWebSocket {
  static OPEN = 1
  static instances: FakeWebSocket[] = []
  readyState = 1
  binaryType = ''
  sent: string[] = []
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
    queueMicrotask(() => this.onopen?.())
  }
  send(d: string) { this.sent.push(d) }
  close() {}
  msgs(): ClientMsg[] { return this.sent.map((s) => JSON.parse(s) as ClientMsg) }
}

const snapshot = (): Snapshot => ({ shopName: 's', customers: [], last: null, today: { creditPaise: 0, paymentPaise: 0, entries: 0 }, month: { creditPaise: 0, paymentPaise: 0, entries: 0 } })

async function started() {
  const attention: string[] = []
  const v = createVoiceClient('ws://x', {
    status: () => {}, level: () => {}, partial: () => {}, final: () => {}, say: () => {}, ops: () => {},
    pending: () => {}, show: () => {}, metrics: () => {}, error: () => {},
    attention: (s) => attention.push(s),
  })
  await v.start({ lang: 'hi', snapshot, firstRun: false, handsFree: true, mic: false })
  return { v, ws: FakeWebSocket.instances[0], attention }
}

describe('voice client attention', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('document', { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' })
    vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} })
    // a mic that opens fine: just enough audio API for the graph to build
    vi.stubGlobal('navigator', { onLine: true, mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } })
    vi.stubGlobal('AudioContext', class {
      state = 'running'
      destination = {}
      audioWorklet = { addModule: async () => {} }
      createMediaStreamSource() { return { connect() {} } }
      close() { return Promise.resolve() }
    })
    vi.stubGlobal('AudioWorkletNode', class { port = {}; connect() {} })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('tap while asleep sends wake{source:tap}', async () => {
    const { v, ws, attention } = await started()
    v.wake('tap')
    expect(ws.msgs()).toContainEqual({ type: 'wake', source: 'tap' })
    expect(attention).toEqual(['awake']) // optimistic, until the server answers
    v.stop()
  })

  it('tap while awake sends sleep and shows asleep', async () => {
    const { v, ws, attention } = await started()
    v.wake('tap')
    v.sleep()
    expect(ws.msgs().at(-1)).toEqual({ type: 'sleep' })
    expect(attention).toEqual(['awake', 'asleep'])
    v.stop()
  })

  it('a hold released before it started sends no hold_end, and a hold wakes once', async () => {
    const { v, ws } = await started()
    v.holdEnd() // released before any hold wake went out
    v.wake('hold')
    v.wake('hold') // a second wake for the same press
    v.holdEnd()
    v.holdEnd()
    const types = ws.msgs().filter((m) => m.type === 'wake' || m.type === 'hold_end')
    expect(types).toEqual([{ type: 'wake', source: 'hold' }, { type: 'hold_end' }])
    v.stop()
  })

  it('a reconnect resets to asleep without a chime event', async () => {
    vi.useFakeTimers()
    try {
      const { v, ws, attention } = await started()
      ws.onmessage?.({ data: JSON.stringify({ type: 'attention', state: 'awake' }) })
      expect(attention).toEqual(['awake'])
      ;(ws.onclose as unknown as (e: { code: number; reason: string }) => void)({ code: 1006, reason: '' })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(FakeWebSocket.instances.length).toBeGreaterThan(1)
      expect(attention).toEqual(['awake']) // no 'asleep' event: silent reset
      v.wake('tap') // awake again only because the user said so (proves the reset to asleep happened)
      expect(attention).toEqual(['awake', 'awake'])
      v.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('hold sends wake{hold} then hold_end', async () => {
    const { v, ws } = await started()
    v.wake('hold')
    v.holdEnd()
    const types = ws.msgs().filter((m) => m.type === 'wake' || m.type === 'hold_end')
    expect(types).toEqual([{ type: 'wake', source: 'hold' }, { type: 'hold_end' }])
    v.stop()
  })
})

class FakeDetector implements WakeDetector {
  fed = 0
  paused = false
  disposed = false
  wakeCb: (() => void) | null = null
  failCb: (() => void) | null = null
  feed() { if (!this.paused) this.fed++ }
  pause() { this.paused = true }
  resume() { this.paused = false }
  onWake(cb: () => void) { this.wakeCb = cb }
  onFail(cb: () => void) { this.failCb = cb }
  dispose() { this.disposed = true }
}

describe('voice client on-phone wake gate', () => {
  let mics: { port: { onmessage: ((e: { data: unknown }) => void) | null } }[] = []
  beforeEach(() => {
    FakeWebSocket.instances = []
    mics = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('document', { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' })
    vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} })
    vi.stubGlobal('navigator', { onLine: true, mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } })
    vi.stubGlobal('AudioContext', class {
      state = 'running'
      destination = {}
      audioWorklet = { addModule: async () => {} }
      createMediaStreamSource() { return { connect() {} } }
      close() { return Promise.resolve() }
    })
    vi.stubGlobal('AudioWorkletNode', class {
      port: { onmessage: ((e: { data: unknown }) => void) | null; postMessage: () => void } = { onmessage: null, postMessage() {} }
      constructor() { mics.push(this) }
      connect() {}
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  async function gated(det: FakeDetector | null) {
    const frames: ArrayBuffer[] = []
    const v = createVoiceClient('ws://x', {
      status: () => {}, level: () => {}, partial: () => {}, final: () => {}, say: () => {}, ops: () => {},
      pending: () => {}, show: () => {}, metrics: () => {}, error: () => {},
    }, { createDetector: async () => det })
    await v.start({ lang: 'hi', snapshot, firstRun: false, handsFree: true })
    for (let i = 0; i < 20; i++) await Promise.resolve() // the detector loads after start (works under fake timers)
    const ws = FakeWebSocket.instances[0]
    ws.send = (d: string | ArrayBuffer) => { if (typeof d === 'string') ws.sent.push(d); else frames.push(d) }
    const mic = () => mics[0].port.onmessage!
    const frame = (n = 1) => ({ data: { buf: new Int16Array(512).fill(n).buffer, level: 0.1 } })
    return { v, ws, frames, mic, frame }
  }

  it('frames are not sent while asleep with a detector', async () => {
    const det = new FakeDetector()
    const { v, frames, mic, frame } = await gated(det)
    for (let i = 0; i < 5; i++) mic()(frame())
    expect(frames).toHaveLength(0)
    expect(det.fed).toBe(5)
    v.stop()
  })

  it('a wake sends wake{phone} and the 2 s pre-roll first', async () => {
    const det = new FakeDetector()
    const { v, ws, frames, mic, frame } = await gated(det)
    const order: string[] = []
    const sendSock = ws.send.bind(ws)
    ws.send = (d: string | ArrayBuffer) => { order.push(typeof d === 'string' ? (JSON.parse(d) as ClientMsg).type : 'frame'); sendSock(d as string) }
    for (let i = 0; i < 100; i++) mic()(frame(i + 1)) // all within 2 s of real time
    expect(frames).toHaveLength(0)
    det.wakeCb!()
    expect(order[0]).toBe('wake')
    expect(ws.msgs()).toContainEqual({ type: 'wake', source: 'phone' })
    expect(frames.length).toBe(100) // the whole pre-roll, oldest first
    expect(new Int16Array(frames[0])[0]).toBe(1)
    expect(order.slice(1).every((o) => o === 'frame')).toBe(true)
    mic()(frame(7)) // now live
    expect(frames).toHaveLength(101)
    v.stop()
  })

  it('pre-roll is capped at 2 s', async () => {
    vi.useFakeTimers({ toFake: ['performance'] })
    try {
      const det = new FakeDetector()
      const { v, frames, mic, frame } = await gated(det)
      for (let i = 0; i < 200; i++) { vi.advanceTimersByTime(32); mic()(frame(i + 1)) } // 6.4 s
      det.wakeCb!()
      expect(frames.length).toBeLessThanOrEqual(63)
      expect(frames.length).toBeGreaterThan(55)
      v.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('no detector streams as today', async () => {
    const { v, frames, mic, frame } = await gated(null)
    mic()(frame())
    expect(frames).toHaveLength(1)
    v.stop()
  })

  it('detector onFail falls back to streaming', async () => {
    const det = new FakeDetector()
    const { v, frames, mic, frame } = await gated(det)
    mic()(frame())
    expect(frames).toHaveLength(0)
    det.failCb!()
    mic()(frame())
    expect(frames).toHaveLength(1)
    v.stop()
  })

  it('streams while the server says awake, detector paused', async () => {
    const det = new FakeDetector()
    const { v, ws, frames, mic, frame } = await gated(det)
    ws.onmessage?.({ data: JSON.stringify({ type: 'attention', state: 'awake' }) })
    mic()(frame())
    expect(frames).toHaveLength(1)
    expect(det.paused).toBe(true)
    ws.onmessage?.({ data: JSON.stringify({ type: 'attention', state: 'asleep' }) })
    expect(det.paused).toBe(false)
    mic()(frame())
    expect(frames).toHaveLength(1)
    v.stop()
  })

  it('detector is paused while speaking', async () => {
    const det = new FakeDetector()
    const { v, ws, mic, frame } = await gated(det)
    ws.onmessage?.({ data: JSON.stringify({ type: 'say', text: 'ok' }) })
    expect(det.paused).toBe(true)
    mic()(frame())
    expect(det.fed).toBe(0)
    ws.onmessage?.({ data: JSON.stringify({ type: 'stop_audio' }) })
    expect(det.paused).toBe(false)
    v.stop()
  })

  it('a drop and reconnect while gated replays no asleep audio', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    try {
      const det = new FakeDetector()
      const { v, ws, mic, frame } = await gated(det)
      for (let i = 0; i < 20; i++) { vi.advanceTimersByTime(32); mic()(frame()) }
      ;(ws.onclose as unknown as (e: { code: number; reason: string }) => void)({ code: 1006, reason: '' })
      await vi.advanceTimersByTimeAsync(10_000)
      const ws2 = FakeWebSocket.instances[1]
      expect(ws2).toBeDefined()
      expect(ws2.msgs().some((m) => m.type === 'replay_start')).toBe(false)
      v.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a stuck speaking state clears so the detector resumes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    try {
      const det = new FakeDetector()
      const { v, ws } = await gated(det)
      ws.onmessage?.({ data: JSON.stringify({ type: 'say', text: 'ok' }) })
      expect(det.paused).toBe(true)
      vi.advanceTimersByTime(31_000)
      expect(det.paused).toBe(false)
      v.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a wake while the socket is closed is not claimed', async () => {
    const det = new FakeDetector()
    const { v, ws, frames, mic, frame } = await gated(det)
    mic()(frame())
    ws.readyState = 3
    det.wakeCb!()
    expect(ws.msgs().some((m) => m.type === 'wake')).toBe(false)
    expect(frames).toHaveLength(0)
    v.stop()
  })
})
