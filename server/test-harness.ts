/**
 * A Session with fake STT/TTS/LLM, for dialogue tests. Everything the shopkeeper would notice is
 * exposed as outcomes: the ledger ops written, the open question, and what was spoken.
 */
import type { LedgerOp, ServerMsg, SnapCustomer, SnapEntry, Snapshot } from '../shared/protocol.js'
import type { Lang } from '../shared/replies.js'
import type { ToolName } from './agent/tools.js'
import { type Intent, directionAnswer, mentionsSettle, nameAnswer, parseFast } from '../shared/intent.js'
import type { AgentContext, ToolCall } from './agent/agent.js'
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

export type AgentResult = { calls: ToolCall[]; ms: number }
/** An agent answer that adds one entry. */
export const addEntry = (name: string, amount: number, direction: 'credit' | 'payment' | null, sure = true): AgentResult => ({
  ms: 1, calls: [{ name: 'add_entries', args: { entries: [{ name, amount, direction, day_offset: 0, promise: false }], sure } }],
})
export const callsOf = (...calls: ToolCall[]): AgentResult => ({ ms: 1, calls })

/**
 * The default stand-in for the model: it reads the first transcript with the fast parser and
 * answers with the matching tool, the way a careful model would. Tests that care about what the
 * model says pass their own `agent`.
 */
export function fakeAgent(ctx: AgentContext): AgentResult {
  const text = ctx.heard[0].text
  const i: Intent = parseFast(text)
  const one = (name: ToolName, args: ToolCall['args'] = {}): AgentResult => ({ ms: 1, calls: [{ name, args }] })
  const p = ctx.pending
  if (p) {
    if (i.type === 'yes' || i.type === 'no') return one('answer_question', { kind: i.type })
    if (i.type === 'entries' && i.entries.every((e) => e.name && e.direction)) return entriesCall(i)
    const kind = p.kind === 'name' ? 'name' : p.kind === 'amount' ? 'amount' : p.kind === 'direction' ? 'direction' : 'option'
    return one('answer_question', { kind, value: kind === 'name' ? nameAnswer(text) ?? text : kind === 'direction' ? directionAnswer(text) ?? undefined : text })
  }
  switch (i.type) {
    case 'entries': return entriesCall(i)
    case 'correct':
      if (i.name) return one('move_entry', { ref: 1, to_name: i.name })
      return one('change_entry', { ref: 1, new_amount: i.amount?.value, new_direction: i.direction })
    case 'modify':
      if (i.remove) return one('remove_entry', { ref: i.ref })
      if (i.name) return one('move_entry', { ref: i.ref, to_name: i.name })
      return one('change_entry', { ref: i.ref, new_amount: i.amount?.value, new_direction: i.direction })
    case 'undo': return one('undo_last')
    case 'query': return one('query_balance', i.name ? { name: i.name } : {})
    case 'summary': return one('show_today')
    case 'remind': return one('send_reminder', { name: i.name ?? '' })
    case 'privacy': return one('open_privacy')
    case 'delete_all': return one('erase_all')
    default:
      if (mentionsSettle(text)) return one('settle', { name: nameAnswer(text) ?? undefined })
      return one('not_for_me')
  }
}
function entriesCall(i: Extract<Intent, { type: 'entries' }>): AgentResult {
  return {
    ms: 1,
    calls: [{ name: 'add_entries', args: { entries: i.entries.map((e) => ({ name: e.name, amount: e.amount.value, direction: e.direction, day_offset: e.dayOffset || undefined, promise: e.promise })) } }],
  }
}

export interface HarnessOpts {
  lang?: Lang
  entries?: SnapEntry[]
  /** the model stand-in; defaults to fakeAgent. Throw to simulate a failure. */
  agent?: (ctx: AgentContext, audio?: Buffer) => AgentResult | Promise<AgentResult>
  speakMs?: number
  resume?: string
  resend?: string
}

export type Harness = ReturnType<typeof harness>

export function harness(customers: SnapCustomer[] = [], opts: HarnessOpts = {}) {
  const out: ServerMsg[] = []
  const said: string[] = []
  const aborted: boolean[] = []
  const agentCalls: { ctx: AgentContext; audio?: Buffer }[] = []
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
    agent: async (ctx, audio) => {
      agentCalls.push({ ctx, audio })
      return (opts.agent ?? fakeAgent)(ctx, audio)
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
  const turn = async (text: string, noisy = false, heard?: { text: string; locale: string }[]) => {
    said.length = 0
    await s.handleText(text, { speechEnd: clock, commitAt: null, finalAt: clock, early: false, snrDb: noisy ? 3 : 25, noisy, pcm: Buffer.alloc(32000), heard }, 'voice')
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
    s, out, said, ops, entries, written, accounts, turn, tap, answer, typed, agentCalls, aborted, lastResume,
    /** kind of the open question, or null */
    get asks() { return s.pending?.kind ?? null },
    get heard() { return said.join(' ') },
    get commits() { return commits },
    get cb() { return cb },
    tick: (ms: number) => (clock += ms),
  }
}
