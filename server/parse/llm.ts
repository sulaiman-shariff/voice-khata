/**
 * Slow path: Gnani Evon (Claude Haiku 5.5 as fallback) reads turns the fast path could not settle.
 *
 * The model never invents money. It picks from the amounts our own parser heard
 * (`candidates`); anything else is rejected by `validate()` and the agent asks instead.
 * The system prompt is frozen (no dates, no names) so it stays prompt-cached; volatile
 * context (customer names, last entry, language) goes in the user message.
 */
import Anthropic from '@anthropic-ai/sdk'
import type { EntryIntent, Intent } from '../../shared/intent.js'
import { type AmountSpan, parseAmounts } from '../../shared/numbers.js'

export const LLM_MODEL = 'claude-haiku-5-5'

export const SYSTEM = `You are the understanding module of Voice Khata, a voice credit ledger used by small Indian shopkeepers (kirana stores).
A shopkeeper speaks mid-sale, in any Indian language mixed with English. Speech-to-text has already turned their speech into text, which may contain recognition errors.
Your only job is to call the "khata" tool with a structured reading of the utterance. You never chat.

LEDGER VOCABULARY
- credit = the customer takes goods now and owes the shop (udhaar, baaki, khate mein likho, saala, kadan, appu, "le gaya", "X ko diya").
- payment = the customer pays money back to the shop (jama, chuka diya, wapas diya, kattidru, "X ne diya", "de gaya", koduthaar, ichchadu).
- Hindi case markers: "Ramesh ne 200 diye" = Ramesh paid (payment). "Ramesh ko 200 diye" = shop gave Ramesh 200 on credit (credit). "Ramesh ka 200" with udhaar/baaki = credit.
- Dravidian languages: dative suffix on the name (-ge, -kku, -ki) means the shop gave to them (credit). A third-person "gave" verb (kottaru, koduthaar, ichchadu) means the customer paid (payment). First-person "I gave" (kotte, koduthen, ichchanu) means credit.
- A bare "diya/diye" about a customer with no case marker usually means the customer paid.
- "kal" means yesterday with past tense (diya tha, liya) and tomorrow with future tense (dega, de jayega). "parso" works the same for two days. Use day_offset: 0 today, -1 yesterday, 1 tomorrow.
- A future payment ("kal de dega", "next week dunga") is a promise: set promise true. A promise is never posted as a payment.

AMOUNTS - THE MOST IMPORTANT RULE
- You are given "Amount candidates": every number our deterministic parser heard, with alternatives for easily confused numbers.
- Every amount you output MUST be one of the candidate values or one of their listed alternatives, or, only when the shopkeeper points back ("same", "bhi", "utna hi", "wahi"), one of the listed recent-entry amounts. Never compute, round, add up, or invent an amount.
- If no candidate fits, use intent "unclear" and say why in unsure_reason.
- Amounts are rupees. "dedh sau" = 150, "dhai hazaar" = 2500, "saadhe teen sau" = 350, "paune do sau" = 175 (already resolved for you in candidates).

NAMES
- "name" is the customer as spoken (copy the words from the utterance, without case markers like ne/ko/ka or suffixes like -ge/-kku).
- Known customers are listed. If the utterance clearly refers to one of them (also by nickname or across scripts, e.g. रमेश = Ramesh), return that known name exactly. Otherwise return the spoken name.
- If an entry has no name but continues the previous clause, reuse the previous clause's name.
- If you cannot tell who the entry is for, set name null.

CONVERSATION CONTEXT
- You get the last few turns of the conversation and a numbered list of recent entries (#1 is the newest).
- Use them to resolve references: "uska / his / him / usko" = the customer just talked about; "aur 100 / another 100 / 100 more" = one more entry for that customer, same direction unless stated; "Suresh ka bhi / same for Suresh / Suresh too" = the same amount and direction for Suresh.
- When you copy an amount from a recent entry or the conversation, that amount is allowed even though it was not spoken in this utterance.
- Lists ("Ramesh 200, Suresh 300, Geeta 150 udhaar") are several entries; a direction said once for the list applies to all of them.

INTENTS
- "entries": one or more ledger lines (several customers or several amounts can appear in one utterance).
- "correct": fixing the most recent entry (#1) ("nahi, 430", "galat, jama tha", "Ramesh nahi Suresh"). Fill only the corrected fields.
- "modify": changing or removing an OLDER entry, or any entry identified by customer/amount/day ("Ramesh ka kal wala 340 asal mein 430 tha", "change Suresh's 200 to 250", "Geeta wali entry hata do", "Ramesh ka 300 Suresh ke naam karo"). Set modify.ref to the entry number from the recent-entries list, and only the changed fields (amount, direction, name) or remove true. If you cannot tell which entry is meant, use intent "unclear".
- "undo": remove the last entry ("hata do", "cancel", "galti se").
- "query": asking a balance ("Ramesh ka total?", "kitna baaki hai Ramesh pe").
- "summary": today's or this month's totals ("aaj ka hisaab").
- "remind": wants to send a polite reminder to a customer.
- "privacy": asks where their data goes, whether this is an AI, or how it works.
- "chitchat": not about the ledger (greetings, talking to a customer, background speech).
- "unclear": about the ledger but you cannot read it safely.

CONFIDENCE
- Set sure false (and give a short unsure_reason) when direction, name or amount is a guess, when the speech looks garbled by noise, or when two readings are plausible. The app will ask the shopkeeper instead of saving. Being unsure is cheap; a wrong saved amount is expensive.

Never judge, score or comment on a customer. Record only what was said.`

const NULLABLE_STR = { type: ['string', 'null'] }
const DIR = { anyOf: [{ type: 'string', enum: ['credit', 'payment'] }, { type: 'null' }] }

export const TOOL: Anthropic.Tool = {
  name: 'khata',
  description: 'Record the structured reading of one shopkeeper utterance. Omit fields that do not apply.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['intent', 'sure'],
    properties: {
      intent: { type: 'string', enum: ['entries', 'correct', 'modify', 'undo', 'query', 'summary', 'remind', 'privacy', 'chitchat', 'unclear'] },
      entries: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'amount', 'direction'],
          properties: {
            name: NULLABLE_STR,
            amount: { type: 'number' },
            direction: DIR,
            day_offset: { type: 'integer', description: 'omit for today' },
            promise: { type: 'boolean', description: 'omit unless a future payment' },
          },
        },
      },
      correction: {
        type: ['object', 'null'],
        additionalProperties: false,
        required: [],
        properties: {
          amount: { type: ['number', 'null'] },
          direction: DIR,
          name: NULLABLE_STR,
        },
      },
      modify: {
        type: ['object', 'null'],
        additionalProperties: false,
        required: ['ref'],
        properties: {
          ref: { type: 'integer', description: 'entry number from the recent-entries list' },
          amount: { type: ['number', 'null'] },
          direction: DIR,
          name: NULLABLE_STR,
          remove: { type: 'boolean' },
        },
      },
      query_name: NULLABLE_STR,
      period: { anyOf: [{ type: 'string', enum: ['today', 'month'] }, { type: 'null' }] },
      sure: { type: 'boolean' },
      unsure_reason: { type: ['string', 'null'], description: 'only when sure is false; at most 8 words' },
    },
  },
}

export interface LlmReading {
  intent: 'entries' | 'correct' | 'modify' | 'undo' | 'query' | 'summary' | 'remind' | 'privacy' | 'chitchat' | 'unclear'
  entries: { name: string | null; amount: number; direction: 'credit' | 'payment' | null; day_offset: number; promise: boolean }[]
  correction: { amount: number | null; direction: 'credit' | 'payment' | null; name: string | null } | null
  modify: { ref: number; amount: number | null; direction: 'credit' | 'payment' | null; name: string | null; remove: boolean } | null
  query_name: string | null
  period: 'today' | 'month' | null
  sure: boolean
  unsure_reason: string | null
}

export interface LlmContext {
  lang: string
  customers: string[] // display names + aliases (capped by caller)
  lastEntry?: string // e.g. "Ramesh credit 340 today"
  /** "#1 Ramesh credit 340 today 10:31" ... newest first */
  recent?: string[]
  /** last few turns: "Shopkeeper: ..." / "Agent: ..." */
  history?: string[]
  /** amounts (rupees) of recent entries: may be copied by reference */
  contextAmounts?: number[]
}

function describeCandidates(spans: AmountSpan[]): string {
  if (!spans.length) return 'none'
  return spans
    .map((s: AmountSpan) => {
      const alt = s.alternatives.length ? ` (could also be ${s.alternatives.join(' or ')})` : ''
      return `${s.value} from "${s.text}"${alt}`
    })
    .join('; ')
}

let client: Anthropic | null = null
const getClient = () => (client ??= new Anthropic({ maxRetries: 1, timeout: 6000 }))

function userMessage(transcript: string, ctx: LlmContext): string {
  const spans = parseAmounts(transcript)
  return [
    `Language: ${ctx.lang}`,
    `Known customers: ${ctx.customers.length ? ctx.customers.slice(0, 80).join(', ') : 'none yet'}`,
    `Recent conversation:\n${ctx.history?.length ? ctx.history.join('\n') : '(start of session)'}`,
    `Recent entries (newest first):\n${ctx.recent?.length ? ctx.recent.join('\n') : 'none'}`,
    `Amount candidates: ${describeCandidates(spans)}`,
    `Recent-entry amounts (only for "same"/"bhi"/"wahi"): ${ctx.contextAmounts?.length ? [...new Set(ctx.contextAmounts)].join(', ') : 'none'}`,
    `Utterance: ${transcript}`,
  ].join('\n')
}

export async function readWithLlm(
  transcript: string, ctx: LlmContext, signal?: AbortSignal,
): Promise<{ reading: Partial<LlmReading>; ms: number; cachedTokens: number }> {
  const t0 = performance.now()
  const res = await getClient().messages.create(
    {
      model: LLM_MODEL,
      max_tokens: 600,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'khata' },
      messages: [{ role: 'user', content: userMessage(transcript, ctx) }],
    },
    { signal },
  )
  const ms = performance.now() - t0
  const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  if (!block) throw new Error(`no tool call (stop_reason ${res.stop_reason})`)
  return { reading: block.input as Partial<LlmReading>, ms, cachedTokens: res.usage.cache_read_input_tokens ?? 0 }
}

export const EVON_MODEL = 'evon-v3.5'
const EVON_URL = 'https://api.vachana.ai/v1/chat/completions'
/** Evon gets this long before the turn falls back to Haiku. */
export const EVON_TIMEOUT_MS = 2500

/** Gnani Evon (OpenAI-compatible chat completions) with the same prompt and tool as Haiku. */
export async function readWithEvon(
  transcript: string, ctx: LlmContext, signal?: AbortSignal,
): Promise<{ reading: Partial<LlmReading>; ms: number }> {
  const t0 = performance.now()
  const res = await fetch(EVON_URL, {
    method: 'POST',
    headers: { 'X-API-Key-ID': process.env.GNANI_API_KEY ?? '', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: EVON_MODEL,
      reasoning_effort: 'none',
      max_tokens: 600,
      temperature: 0,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userMessage(transcript, ctx) }],
      tools: [{ type: 'function', function: { name: TOOL.name, description: TOOL.description, parameters: TOOL.input_schema } }],
      tool_choice: { type: 'function', function: { name: TOOL.name } },
    }),
    signal,
  })
  if (!res.ok) {
    // no LLM scope / no credit on this key: stop trying for the life of the process
    if (res.status === 401 || res.status === 402 || res.status === 403) evonOff = true
    throw new Error(`evon ${res.status}: ${(await res.text()).slice(0, 160)}`)
  }
  const body = (await res.json()) as { choices?: { message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[] }
  const call = body.choices?.[0]?.message?.tool_calls?.find((c) => c.function?.name === TOOL.name)
  if (!call?.function?.arguments) throw new Error('evon: no tool call')
  const reading = JSON.parse(call.function.arguments) as Partial<LlmReading>
  if (typeof reading.intent !== 'string') throw new Error('evon: no intent')
  return { reading, ms: performance.now() - t0 }
}

let evonOff = false
export const evonAvailable = () => !evonOff

export type LlmProvider = 'evon' | 'haiku'
const PROVIDER: LlmProvider = process.env.LLM_PROVIDER === 'haiku' ? 'haiku' : 'evon'

/**
 * Hard turns: Gnani Evon first, Claude Haiku when Evon errors, times out or returns no usable
 * tool call. Either way the reading still goes through validate() in the session.
 */
export async function readHard(
  transcript: string, ctx: LlmContext, provider: LlmProvider = PROVIDER,
): Promise<{ reading: Partial<LlmReading>; ms: number; model: string; fallback?: string }> {
  let fallback: string | undefined
  if (provider === 'evon' && !evonOff) {
    try {
      const r = await readWithEvon(transcript, ctx, AbortSignal.timeout(EVON_TIMEOUT_MS))
      return { ...r, model: EVON_MODEL }
    } catch (e) {
      fallback = String(e).slice(0, 120)
    }
  }
  const r = await readWithLlm(transcript, ctx)
  return { reading: r.reading, ms: r.ms, model: LLM_MODEL, fallback }
}

/** Fire one tiny request at boot so the prompt cache and TLS connection are warm. */
export async function warmUp(): Promise<void> {
  try {
    await readWithLlm('haan', { lang: 'hi-IN', customers: [] })
  } catch {
    /* warm-up is best effort */
  }
}

/**
 * Turn the model's reading into the same Intent shape the fast path produces, enforcing
 * that every amount was actually heard. Amounts outside the candidates are dropped and the
 * turn becomes low-confidence, so the agent asks instead of saving.
 */
export function validate(transcript: string, raw: Partial<LlmReading>, contextAmounts: number[] = [], recentCount = 0): Intent {
  // the tool schema is not strict (strict decoding doubled latency), so normalise defensively
  const r: LlmReading = {
    intent: raw.intent ?? 'unclear',
    entries: (Array.isArray(raw.entries) ? raw.entries : [])
      .filter((e) => e && typeof e.amount === 'number')
      .map((e) => ({
        name: typeof e.name === 'string' && e.name.trim() ? e.name.trim() : null,
        amount: e.amount,
        direction: e.direction === 'credit' || e.direction === 'payment' ? e.direction : null,
        day_offset: Number.isInteger(e.day_offset) ? Math.max(-30, Math.min(30, e.day_offset)) : 0,
        // only a payment can be promised, and only for a later day
        promise: e.promise === true && e.direction === 'payment' && Number.isInteger(e.day_offset) && e.day_offset >= 1,
      })),
    correction: raw.correction
      ? {
        amount: typeof raw.correction.amount === 'number' ? raw.correction.amount : null,
        direction: raw.correction.direction === 'credit' || raw.correction.direction === 'payment' ? raw.correction.direction : null,
        name: raw.correction.name || null,
      }
      : null,
    modify: raw.modify && Number.isInteger(raw.modify.ref)
      ? {
        ref: raw.modify.ref,
        amount: typeof raw.modify.amount === 'number' ? raw.modify.amount : null,
        direction: raw.modify.direction === 'credit' || raw.modify.direction === 'payment' ? raw.modify.direction : null,
        name: raw.modify.name || null,
        remove: raw.modify.remove === true,
      }
      : null,
    query_name: raw.query_name || null,
    period: raw.period === 'month' ? 'month' : raw.period === 'today' ? 'today' : null,
    sure: raw.sure !== false,
    unsure_reason: raw.unsure_reason || null,
  }
  const spans = parseAmounts(transcript)
  const spoken = (v: number) => spans.find((s) => s.value === v || s.alternatives.includes(v))
  // an amount copied from a recent entry ("Suresh ka bhi same") is allowed, flagged as such
  const heard = (v: number): AmountSpan | undefined =>
    spoken(v) ?? (contextAmounts.includes(v) ? { value: v, start: -1, end: -1, text: String(v), hasCurrency: false, flags: ['from-context'], alternatives: [] } as AmountSpan : undefined)
  switch (r.intent) {
    case 'modify': {
      const m = r.modify
      if (!m || m.ref < 1 || m.ref > recentCount) return { type: 'unknown' }
      const span = m.amount != null ? heard(m.amount) : undefined
      if (m.amount != null && !span) return { type: 'unknown' }
      if (!m.remove && m.amount == null && !m.direction && !m.name) return { type: 'unknown' }
      return {
        type: 'modify', ref: m.ref, remove: m.remove || undefined,
        amount: span && m.amount != null ? { ...span, value: m.amount } : undefined,
        direction: m.direction ?? undefined, name: m.name ?? undefined,
      }
    }
    case 'undo':
      return { type: 'undo' }
    case 'privacy':
      return { type: 'privacy' }
    case 'chitchat':
    case 'unclear':
      return { type: 'unknown' }
    case 'query':
      return r.query_name ? { type: 'query', name: r.query_name, scope: 'customer' } : { type: 'query', name: null, scope: 'dues' }
    case 'summary':
      return { type: 'summary', period: r.period ?? 'today' }
    case 'remind':
      return { type: 'remind', name: r.query_name }
    case 'correct': {
      const c = r.correction
      if (!c) return { type: 'no' }
      const span = c.amount != null ? heard(c.amount) : undefined
      if (c.amount != null && !span) return { type: 'no' }
      const amount = span && c.amount != null ? { ...span, value: c.amount } : undefined
      return { type: 'correct', amount, direction: c.direction ?? undefined, name: c.name ?? undefined }
    }
    case 'entries': {
      const entries: EntryIntent[] = []
      for (const e of r.entries) {
        const span = heard(e.amount)
        if (!span) continue // invented amount: never saved
        const reasons: string[] = ['llm']
        if (!r.sure) reasons.push(r.unsure_reason ?? 'llm-unsure')
        if (!e.name) reasons.push('no-name')
        if (!e.direction) reasons.push('no-direction-cue')
        if (e.amount !== span.value) reasons.push('confusable')
        for (const f of span.flags) if (f !== 'fractional_rupee' && f !== 'from-context' && !reasons.includes(f)) reasons.push(f)
        if (span.flags.includes('from-context')) reasons.push('from-context')
        entries.push({
          name: e.name,
          amount: { ...span, value: e.amount },
          direction: e.direction,
          dayOffset: e.day_offset,
          promise: e.promise,
          confidence: reasons.filter((x) => x !== 'from-context').length > 1 ? 'low' : 'high',
          reasons,
        })
      }
      if (!entries.length) return { type: 'unknown' }
      return { type: 'entries', entries }
    }
  }
}
