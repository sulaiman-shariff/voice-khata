import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientMsg, Snapshot } from '../../shared/protocol.js'
import { createVoiceClient } from './voice'

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
    pending: () => {}, show: () => {}, remind: () => {}, metrics: () => {}, error: () => {},
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
