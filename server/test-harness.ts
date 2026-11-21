/**
 * A Session with fake STT/TTS/LLM, for dialogue tests. Everything the shopkeeper would notice is
 * exposed as outcomes: the ledger ops written, the open question, and what was spoken.
 */
import type { LedgerOp, ServerMsg, SnapCustomer, SnapEntry, Snapshot } from '../shared/protocol.js'
import type { Lang } from '../shared/replies.js'
import type { LlmContext, LlmReading } from './parse/llm.js'
import { type SttCallbacks, Session } from './session.js'

export const cust = (cid: string, name: string, balanceRs = 0, extra: Partial<SnapCustomer> = {}): SnapCustomer => ({
  cid, name, aliases: [], householdId: null, remindersOptIn: false, adult: false, balancePaise: balanceRs * 100, typicalPaise: null, ...extra,
})

export const ent = (eid: string, cid: string, rs: number, direction: 'credit' | 'payment', day = '2026-11-13'): SnapEntry =>
  ({ eid, cid, paise: rs * 100, direction, day })

export function snap(customers: SnapCustomer[] = [], entries: SnapEntry[] = []): Snapshot {
  return {
    shopName: 'Sharma Kirana', customers, last: entries[0] ?? null, entries,
    today: { creditPaise: 0, paymentPaise: 0, entries: 0 }, month: { creditPaise: 0, paymentPaise: 0, entries: 0 },
  }
}

/** A model reading of one entry (what the LLM fake returns). */
export const llmEntry = (name: string, amount: number, direction: 'credit' | 'payment' | null, sure = true): Partial<LlmReading> => ({
  intent: 'entries', sure, unsure_reason: sure ? null : 'unsure',
  entries: [{ name, amount, direction, day_offset: 0, promise: false }],
})

export interface HarnessOpts {
  lang?: Lang
  entries?: SnapEntry[]
  llm?: (text: string, ctx: LlmContext) => Partial<LlmReading>
  speakMs?: number
  resume?: string
  resend?: string
}

export type Harness = ReturnType<typeof harness>

export function harness(customers: SnapCustomer[] = [], opts: HarnessOpts = {}) {
  const out: ServerMsg[] = []
  const said: string[] = []
  const aborted: boolean[] = []
  const llmCalls: { text: string; ctx: LlmContext }[] = []
  let commits = 0
  let cb: SttCallbacks = {}
  let clock = 0
  let ids = 0
  const s = new Session({
    openStt: (_l, _k, c) => {
      cb = c
      return { send: () => {}, commit: () => commits++, setKeyterms: () => {}, close: () => {} }
    },
    speak: async (text, _l, onAudio, signal) => {
      said.push(text)
      onAudio(Buffer.alloc(3200))
      if (opts.speakMs) await new Promise((r) => setTimeout(r, opts.speakMs))
      aborted.push(signal.aborted)
      return { firstAudioMs: 1, bytes: 3200 }
    },
    llm: async (text, ctx) => {
      llmCalls.push({ text, ctx })
      if (!opts.llm) throw new Error('no model in this test')
      return opts.llm(text, ctx)
    },
    send: (m) => out.push(m),
    sendAudio: () => {},
    now: () => clock,
    newId: () => `id${++ids}`,
  })
  s.onClient({ type: 'hello', lang: opts.lang ?? 'hi', snapshot: snap(customers, opts.entries), firstRun: false, ptt: false, resume: opts.resume, resend: opts.resend })

  const settle = async () => {
    await s.idle()
  }
  /** A spoken turn (noisy: the room was loud). */
  const turn = async (text: string, noisy = false) => {
    said.length = 0
    await s.handleText(text, { speechEnd: clock, commitAt: null, finalAt: clock, early: false, snrDb: noisy ? 3 : 25, noisy, pcm: Buffer.alloc(32000) }, 'voice')
    await settle()
  }
  /** A tap on the question card: the yes/no buttons, or an option (udhaar/jama, a name). */
  const tap = async (action: 'yes' | 'no' | 'undo') => {
    said.length = 0
    s.onClient({ type: 'tap', action })
    await settle()
  }
  const answer = async (text: string) => {
    said.length = 0
    s.onClient({ type: 'answer', text })
    await settle()
  }
  const typed = async (text: string) => {
    said.length = 0
    s.onClient({ type: 'text', text })
    await settle()
  }
  const ops = () => out.filter((m): m is Extract<ServerMsg, { type: 'ops' }> => m.type === 'ops').flatMap((m) => m.ops)
  const entries = () => ops().filter((o): o is Extract<LedgerOp, { op: 'entry' }> => o.op === 'entry')
  /** [customer id, rupees, direction] for each entry written, in order */
  const written = () => entries().map((e) => [e.cid, e.paise / 100, e.direction])
  const accounts = () => ops().filter((o): o is Extract<LedgerOp, { op: 'add_customer' }> => o.op === 'add_customer').map((o) => o.name)
  const lastResume = () => (out.filter((m) => m.type === 'turn_done').at(-1) as { resume?: string } | undefined)?.resume
  return {
    s, out, said, ops, entries, written, accounts, turn, tap, answer, typed, llmCalls, aborted, lastResume,
    /** kind of the open question, or null */
    get asks() { return s.pending?.kind ?? null },
    get heard() { return said.join(' ') },
    get commits() { return commits },
    get cb() { return cb },
    tick: (ms: number) => (clock += ms),
  }
}
