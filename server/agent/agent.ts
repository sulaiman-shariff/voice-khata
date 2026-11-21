/**
 * The agent: one Gemini call per turn that reads everything heard (all STT transcripts, and the
 * audio itself when given) plus the app state, and answers with one or more tool calls.
 */
import { geminiAgentCall, type GeminiTool } from '../parse/gemini.js'
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
  /** Customers touched most recently, newest first. */
  recent: string[]
  /** A question the app is waiting on, or null. */
  pending: PendingView | null
}

/** Frozen: no dates, names or per-user text, so it can be cached. */
export const AGENT_SYSTEM = `You are the brain of KhataBhai, a voice ledger app for Indian shopkeepers. The shopkeeper speaks; you answer ONLY by calling tools. Never reply with plain text.

Each turn you get:
- lang: the app's current reply language.
- heard: one or more transcripts of the same speech, from recognisers tuned to different languages. They disagree and make mistakes; compare them (and the audio, if attached) to work out what was really said.
- history: the last few exchanges, oldest first.
- screen: which screen the shopkeeper is on.
- customers: the names in the ledger. A customer can be referred to by name in any script (Latin, Devanagari, Tamil, etc.) or spelling; match it to the ledger name.
- recent: customers touched most recently, newest first, for "him", "her", "that one".
- pending: a question the app is waiting on (confirm, name, amount, direction, which, delete, batch, modify), or none. If pending is set, an answer like yes, no, a name or an amount usually answers it.

Rules:
- Only act on what was said to the app. Asides, talk to customers, background chatter or TV: call not_for_me.
- Never invent amounts. An amount must be one that was actually said; if it is missing or doubtful, ask for it instead of guessing.
- The reply language is the language the shopkeeper spoke.
- If the words cannot be trusted (garbled, contradictory transcripts, too short to mean anything), call unclear.
- Several tools may be called in one turn, in the order they should run (for example add several entries, then query a balance).
- Pick tools only from the list given.`

/** Build the user turn: every transcript, then the app state, as plain labelled lines. */
function userTurn(ctx: AgentContext): string {
  return [
    `lang: ${ctx.lang}`,
    'heard:',
    ...ctx.heard.map((h) => `- [${h.locale}] ${h.text}`),
    `history: ${JSON.stringify(ctx.history)}`,
    `screen: ${ctx.screen}`,
    `customers: ${JSON.stringify(ctx.customers)}`,
    `recent: ${JSON.stringify(ctx.recent)}`,
    `pending: ${ctx.pending ? JSON.stringify(ctx.pending) : 'none'}`,
  ].join('\n')
}

export async function decide(ctx: AgentContext, tools: GeminiTool[], audio?: Buffer): Promise<{ calls: ToolCall[]; ms: number }> {
  const r = await geminiAgentCall(AGENT_SYSTEM, userTurn(ctx), tools, audio)
  // a tool we do not have is never run
  return { calls: r.calls.filter((c): c is ToolCall => isToolName(c.name)), ms: r.ms }
}
