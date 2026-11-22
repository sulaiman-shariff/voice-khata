/**
 * The agent: one model call per turn that reads everything heard (all STT transcripts, and the
 * audio itself when given) plus the app state, and answers with one or more tool calls.
 * Text turns race the Gemini race against Claude Haiku 5.5; audio turns are Gemini only.
 */
import { geminiAgentCall, TIMEOUT_MS, type GeminiTool } from '../parse/gemini.js'
import { haikuAgentCall, haikuEnabled } from '../parse/haiku.js'
import type { PendingView } from '../../shared/protocol.js'
import type { Lang } from '../../shared/replies.js'
import { type ToolCall, isToolName } from './tools.js'

export type { ToolCall } from './tools.js'

export interface AgentContext {
  lang: Lang
  /** What each speech recogniser heard for this turn (one per locale tried). */
  heard: { locale: string; text: string }[]
  /** The last few exchanges, oldest first. */
  history: string[]
  /** Which screen the shopkeeper is looking at. */
  screen: string
  /** Names of the customers in the ledger. */
  customers: string[]
  /** The latest entries, numbered newest first ("#1 Ramesh credit 340 today"): tools point at one by its number. */
  recent: string[]
  /** A question the app is waiting on, or null. */
  pending: PendingView | null
  /** The customer the conversation is about (the last one written or shown): "uska", "usne", "him" mean them. */
  focus?: string | null
}

/** Frozen: no dates, names or per-user text, so it can be cached. */
export const AGENT_SYSTEM = `You are the brain of KhataBhai, a voice ledger app for Indian shopkeepers. The shopkeeper speaks; you answer ONLY by calling tools. Never reply with plain text.

Each turn you get:
- lang: the app's current reply language.
- heard: one or more transcripts of the same speech, from recognisers tuned to different languages. They disagree and make mistakes; compare them (and the audio, if attached) to work out what was really said.
- history: the last few exchanges, oldest first.
- screen: which screen the shopkeeper is on.
- customers: the names in the ledger. A customer can be referred to by name in any script (Latin, Devanagari, Tamil, etc.) or spelling; match it to the ledger name.
- recent: the latest ledger entries, numbered, #1 the newest. Use the number as "ref" to change or remove an entry. "(JUST WRITTEN by you)" marks what the app wrote in the last two minutes.
- talking about: the customer the conversation is about. A word that points back at a person (he, she, him, that one, the same one, in any language or script, and its common mishearings) means this customer: use their name and set from_context. Such a word is never a new customer's name.
- pending: a question the app is waiting on (confirm, name, amount, direction, which, delete, batch, modify), or none. If pending is set, an answer like yes, no, a name or an amount usually answers it.

Rules:
- Only act on what was said to the app. Asides, talk to customers, background chatter or TV: call not_for_me.
- Direction: use credit or payment only when the speech says it (udhaar, credit, saal, jama, paid, diye, liye ...; writing an amount INTO someone's khata, "khata / khate mein / likh do / add kar do", is credit). If nothing says it, direction is null (a follow-up about the talked-about person with from_context may leave it null: the app uses that person's last direction); never infer it from the amount, the name or an unclear word.
- Names: when a heard name sounds like a ledger customer, use the ledger spelling ("Mahe" for the customer Mahi). Never invent, complete or translate a name. If no ledger customer is named, pass name null unless the shopkeeper clearly says it is a new customer; an ordinary word (just, only, write, took, gave, talk) is not a name. A person's name said with an amount ("Ramesh ka 300 ka khata", "Ramesh 300 khate mein likho") is add_entries (credit) even when that person is not in the ledger yet: the app reads it back as a new customer. "Naya khata Ramesh" / "Ramesh ka khata kholo" with no amount is add_customer.
- Never invent amounts. An amount must be one that was actually said; if it is missing or doubtful, ask for it instead of guessing.
- The reply language is the language the shopkeeper spoke.
- If the words cannot be trusted (garbled, contradictory transcripts, too short to mean anything), call unclear.
- customers marks the shop's suppliers "[supplier]" and shows nicknames in brackets ("Ramesh (doodhwala)"); pass a name exactly as listed. Two customers with one name: pass the plain name and the app asks which, unless a nickname or "naya / doosra" was said.
- Money with no person named (expenses, cash put in or taken out of the galla) is add_cash, never add_entries. A named customer always means add_entries.
- Several tools may be called in one turn, in the order they should run (for example add several entries, then query a balance).
- Pick tools only from the list given.

Follow-ups (in any language; the examples are only examples). Work out what the shopkeeper MEANS about the entries in recent, especially the JUST WRITTEN ones; never write a second entry when they are fixing one:
- A denial or correction of what was just written (no / wrong / not that, plus the right amount, direction or both): change_entry on that entry with new_amount / new_direction. e.g. "nahi nahi, uska 400 ka khata hai", "illa, 400", "no, make it 400", "nahi, jama karna hai" -> change_entry ref 1.
- It belongs to someone else ("that was Geeta's", "ye Geeta ka tha", "not his, Ramesh's"): move_entry with the ref of that entry and to_name. Never change_entry for this.
- Removing (delete / take it out / cancel / it was a mistake, any wording): remove_entry with the ref of the entry the words point at, by person and amount ("Ramesh's 300 one" is Ramesh's newest 300 entry, not simply #1). undo_last only when nothing points at a particular entry.
- More for the same person ("and 50 more", "he also paid 100", "usne 600 diye"): add_entries for the talked-about customer with from_context; direction from the words, else the same as that customer's last entry.
- Writing an amount into someone's khata ("khata", "likh do", "add kar do", "write it") means credit. Opening a khata ("khata kholo", "new account") for a name already in the ledger is add_customer, never add_entries.
- answer_question is only for a pending question. With pending none, a denial is about the latest entry, not an answer.`

/** Build the user turn: every transcript, then the app state, as plain labelled lines. */
export function userTurn(ctx: AgentContext): string {
  return [
    `lang: ${ctx.lang}`,
    'heard:',
    ...ctx.heard.map((h) => `- [${h.locale}] ${h.text}`),
    `history: ${JSON.stringify(ctx.history)}`,
    `screen: ${ctx.screen}`,
    `customers: ${JSON.stringify(ctx.customers)}`,
    `recent: ${JSON.stringify(ctx.recent)}`,
    `talking about: ${ctx.focus ?? 'nobody yet'}`,
    `pending: ${ctx.pending ? JSON.stringify(ctx.pending) : 'none'}`,
  ].join('\n')
}

/** The model that hears audio: the measured winner of eval/audio_latency.ts unless AGENT_AUDIO_MODEL says otherwise. */
const AUDIO_MODEL = () => process.env.AGENT_AUDIO_MODEL || 'gemini-3.5-flash-lite'

export type AgentModel = 'gemini' | 'haiku'
export interface Decision {
  calls: ToolCall[]
  /** wall-clock time of the whole call (the race, when raced) */
  ms: number
  /** which model's answer this is */
  model: AgentModel
  /** Haiku prompt-cache hits, when Haiku answered */
  cacheRead?: number
}

/** a tool we do not have is never run */
const known = (calls: { name: string; args: Record<string, unknown> }[]): ToolCall[] => calls.filter((c): c is ToolCall => isToolName(c.name))

/**
 * Text turns: the Gemini race (Mumbai + 2x global) and Haiku start together; the first answer with a
 * tool we have wins and the other leg is aborted. One deadline (LLM_TIMEOUT_MS, 3 s, or opts.timeoutMs)
 * plus the caller's signal covers both; if one side fails the other keeps the rest of it, and if
 * both fail this throws (the session then says didNotCatch). Haiku is skipped for audio turns, with
 * AGENT_HAIKU=off, with no ANTHROPIC_API_KEY, or with opts.haiku false.
 */
export async function decide(
  ctx: AgentContext, tools: GeminiTool[], audio?: Buffer,
  opts: { timeoutMs?: number; signal?: AbortSignal; haiku?: boolean } = {},
): Promise<Decision> {
  const user = userTurn(ctx)
  const t0 = performance.now()
  if (audio?.length || opts.haiku === false || !haikuEnabled()) {
    const r = await geminiAgentCall(AGENT_SYSTEM, user, tools, audio, { ...(audio?.length ? { model: AUDIO_MODEL() } : {}), timeoutMs: opts.timeoutMs, signal: opts.signal })
    return { calls: known(r.calls), ms: r.ms, model: 'gemini' }
  }
  // the deadline is a plain timer (not AbortSignal.timeout) so it is one clock for both legs
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS
  const done = new AbortController()
  const timer = setTimeout(() => done.abort(new DOMException('agent deadline', 'TimeoutError')), timeoutMs)
  const signal = opts.signal ? AbortSignal.any([opts.signal, done.signal]) : done.signal
  const good = (model: AgentModel) => (r: { calls: { name: string; args: Record<string, unknown> }[]; cacheRead?: number }): Decision => {
    const calls = known(r.calls)
    if (!calls.length) throw new Error(`${model}: no known tool call`)
    return { calls, ms: performance.now() - t0, model, ...(r.cacheRead !== undefined ? { cacheRead: r.cacheRead } : {}) }
  }
  try {
    return await Promise.any([
      geminiAgentCall(AGENT_SYSTEM, user, tools, undefined, { timeoutMs, signal }).then(good('gemini')),
      haikuAgentCall(AGENT_SYSTEM, user, tools, { signal, timeoutMs }).then(good('haiku')),
    ])
  } catch (e) {
    const errs = e instanceof AggregateError ? e.errors : [e]
    throw new Error(`agent: both models failed (${errs.map((x) => String(x instanceof Error ? x.message : x).slice(0, 120)).join('; ')})`, { cause: e })
  } finally {
    clearTimeout(timer)
    done.abort() // cancels the loser
  }
}
