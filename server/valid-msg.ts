/**
 * Shape check for every message the phone sends, before anything reaches the session: one bad
 * frame must not take down the instance. Every ClientMsg type in shared/protocol.ts needs a case
 * here (server/valid-msg.test.ts fails when the protocol gains a type this does not accept).
 */
import type { ClientMsg } from '../shared/protocol.js'

const LANGS = new Set(['hi', 'en', 'kn', 'ta', 'te', 'ml', 'mr', 'bn', 'gu', 'pa'])
/** typed or forced text, the same cap the session applies */
const TEXT_MAX = 2000

export function validMsg(m: unknown): m is ClientMsg {
  if (!m || typeof m !== 'object') return false
  const x = m as Record<string, unknown>
  switch (x.type) {
    case 'hello': {
      const s = x.snapshot as Record<string, unknown> | undefined
      return typeof x.lang === 'string' && LANGS.has(x.lang) && !!s && Array.isArray(s.customers) && s.customers.length <= 5000 &&
        typeof s.today === 'object' && typeof s.month === 'object' &&
        (x.resume === undefined || typeof x.resume === 'string') && (x.resend === undefined || typeof x.resend === 'string')
    }
    case 'snapshot': {
      const s = x.snapshot as Record<string, unknown> | undefined
      return !!s && Array.isArray(s.customers) && s.customers.length <= 5000 && typeof s.today === 'object' && typeof s.month === 'object'
    }
    case 'answer':
    case 'text':
    case 'force':
      return typeof x.text === 'string' && x.text.length <= TEXT_MAX
    case 'tap':
      return x.action === 'yes' || x.action === 'no' || x.action === 'undo'
    case 'speed':
      return x.speed === 0.8 || x.speed === 1 || x.speed === 1.2
    case 'ack':
      return Number.isInteger(x.seq)
    case 'ping':
      return x.t === undefined || typeof x.t === 'number'
    case 'wake':
      return x.source === 'tap' || x.source === 'hold' || x.source === 'phone'
    case 'announce':
      return x.kind === 'payment' && typeof x.cid === 'string' && x.cid.length > 0 && x.cid.length <= 64 &&
        Number.isInteger(x.paise) && (x.paise as number) > 0 && (x.paise as number) < 1e11 &&
        (x.balancePaise === undefined || (Number.isInteger(x.balancePaise) && Math.abs(x.balancePaise as number) < 1e11)) &&
        (x.partial === undefined || typeof x.partial === 'boolean')
    case 'hold_end':
    case 'sleep':
    case 'ptt_start':
    case 'ptt_end':
    case 'playback_done':
    case 'barge':
    case 'replay_start':
    case 'replay_end':
      return true
    default:
      return false
  }
}
