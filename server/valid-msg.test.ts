import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ClientMsg } from '../shared/protocol.js'
import { validMsg } from './valid-msg.js'

const snapshot = {
  shopName: 'Shop', customers: [], last: null, entries: [],
  today: { creditPaise: 0, paymentPaise: 0, entries: 0 }, month: { creditPaise: 0, paymentPaise: 0, entries: 0 },
}

/** One minimal valid message per ClientMsg type. */
const EXAMPLES: { [K in ClientMsg['type']]: Extract<ClientMsg, { type: K }> } = {
  hello: { type: 'hello', lang: 'hi', snapshot, firstRun: false, ptt: false },
  speed: { type: 'speed', speed: 1 },
  snapshot: { type: 'snapshot', snapshot },
  ptt_start: { type: 'ptt_start' },
  ptt_end: { type: 'ptt_end' },
  wake: { type: 'wake', source: 'phone' },
  hold_end: { type: 'hold_end' },
  sleep: { type: 'sleep' },
  tap: { type: 'tap', action: 'yes' },
  answer: { type: 'answer', text: 'haan' },
  text: { type: 'text', text: 'Ramesh 300 udhaar' },
  barge: { type: 'barge' },
  playback_done: { type: 'playback_done' },
  ack: { type: 'ack', seq: 1 },
  ping: { type: 'ping', t: 1 },
  replay_start: { type: 'replay_start' },
  replay_end: { type: 'replay_end' },
  force: { type: 'force', text: 'Talk 300 diye' },
}

/** the `type: '...'` literals of the ClientMsg union, read from the source (so a new type fails here) */
function protocolTypes(): string[] {
  const src = fs.readFileSync(new URL('../shared/protocol.ts', import.meta.url), 'utf8')
  const block = src.slice(src.indexOf('export type ClientMsg'), src.indexOf('/** A question the agent is waiting on'))
  return [...new Set([...block.matchAll(/type: '([a-z_]+)'/g)].map((m) => m[1]))]
}

describe('validMsg accepts every client message the protocol defines', () => {
  it('has an example for every ClientMsg type, and nothing else', () => {
    expect(Object.keys(EXAMPLES).sort()).toEqual(protocolTypes().sort())
  })
  it.each(Object.values(EXAMPLES).map((m) => [m.type, m] as const))('%s', (_t, m) => {
    expect(validMsg(m)).toBe(true)
  })
  it('the ClientMsg union lists each type once', () => {
    const src = fs.readFileSync(new URL('../shared/protocol.ts', import.meta.url), 'utf8')
    const block = src.slice(src.indexOf('export type ClientMsg'), src.indexOf('/** A question the agent is waiting on'))
    const all = [...block.matchAll(/\|\s*(?:\/\*\*[^]*?\*\/\s*)?\{\s*type: '([a-z_]+)'/g)].map((m) => m[1])
    expect(all.length).toBeGreaterThan(10)
    expect(all.filter((t, i) => all.indexOf(t) !== i)).toEqual([])
  })
  it('rejects bad shapes', () => {
    expect(validMsg(null)).toBe(false)
    expect(validMsg({ type: 'nope' })).toBe(false)
    expect(validMsg({ type: 'force' })).toBe(false)
    expect(validMsg({ type: 'force', text: 'x'.repeat(2001) })).toBe(false)
    expect(validMsg({ type: 'tap', action: 'maybe' })).toBe(false)
  })
})
