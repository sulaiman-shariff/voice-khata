/**
 * Slow path: Claude Haiku 5.5 reads turns the fast path could not settle.
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
- Every amount you output MUST be one of the candidate values or one of their listed alternatives. Never compute, round, add up, or invent an amount.
- If no candidate fits, use intent "unclear" and say why in unsure_reason.
- Amounts are rupees. "dedh sau" = 150, "dhai hazaar" = 2500, "saadhe teen sau" = 350, "paune do sau" = 175 (already resolved for you in candidates).

NAMES
- "name" is the customer as spoken (copy the words from the utterance, without case markers like ne/ko/ka or suffixes like -ge/-kku).
- Known customers are listed. If the utterance clearly refers to one of them (also by nickname or across scripts, e.g. रमेश = Ramesh), return that known name exactly. Otherwise return the spoken name.
- If an entry has no name but continues the previous clause, reuse the previous clause's name.
- If you cannot tell who the entry is for, set name null.

INTENTS
- "entries": one or more ledger lines (several customers or several amounts can appear in one utterance).
- "correct": fixing the last entry ("nahi, 430", "galat, jama tha", "Ramesh nahi Suresh"). Fill only the corrected fields.
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
      intent: { type: 'string', enum: ['entries', 'correct', 'undo', 'query', 'summary', 'remind', 'privacy', 'chitchat', 'unclear'] },
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
      query_name: NULLABLE_STR,
      period: { anyOf: [{ type: 'string', enum: ['today', 'month'] }, { type: 'null' }] },
      sure: { type: 'boolean' },
      unsure_reason: { type: ['string', 'null'], description: 'only when sure is false; at most 8 words' },
    },
  },
}

export interface LlmReading {
  intent: 'entries' | 'correct' | 'undo' | 'query' | 'summary' | 'remind' | 'privacy' | 'chitchat' | 'unclear'
  entries: { name: string | null; amount: number; direction: 'credit' | 'payment' | null; day_offset: number; promise: boolean }[]
  correction: { amount: number | null; direction: 'credit' | 'payment' | null; name: string | null } | null
  query_name: string | null
  period: 'today' | 'month' | null
  sure: boolean
  unsure_reason: string | null
}

export interface LlmContext {
  lang: string
  customers: string[] // display names + aliases (capped by caller)
  lastEntry?: string // e.g. "Ramesh credit 340 today"
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

export async function readWithLlm(
  transcript: string, ctx: LlmContext, signal?: AbortSignal,
): Promise<{ reading: Partial<LlmReading>; ms: number; cachedTokens: number }> {
  const spans = parseAmounts(transcript)
  const user = [
    `Language: ${ctx.lang}`,
    `Known customers: ${ctx.customers.length ? ctx.customers.slice(0, 80).join(', ') : 'none yet'}`,
    `Last entry: ${ctx.lastEntry ?? 'none'}`,
    `Amount candidates: ${describeCandidates(spans)}`,
    `Utterance: ${transcript}`,
  ].join('\n')
  const t0 = performance.now()
  const res = await getClient().messages.create(
    {
      model: LLM_MODEL,
      max_tokens: 600,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'khata' },
      messages: [{ role: 'user', content: user }],
    },
    { signal },
  )
  const ms = performance.now() - t0
  const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  if (!block) throw new Error(`no tool call (stop_reason ${res.stop_reason})`)
  return { reading: block.input as Partial<LlmReading>, ms, cachedTokens: res.usage.cache_read_input_tokens ?? 0 }
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
export function validate(transcript: string, raw: Partial<LlmReading>): Intent {
  // the tool schema is not strict (strict decoding doubled latency), so normalise defensively
  const r: LlmReading = {
    intent: raw.intent ?? 'unclear',
    entries: (Array.isArray(raw.entries) ? raw.entries : [])
      .filter((e) => e && typeof e.amount === 'number')
      .map((e) => ({
        name: typeof e.name === 'string' && e.name.trim() ? e.name.trim() : null,
        amount: e.amount,
        direction: e.direction === 'credit' || e.direction === 'payment' ? e.direction : null,
        day_offset: Number.isInteger(e.day_offset) ? e.day_offset : 0,
        promise: e.promise === true,
      })),
    correction: raw.correction
      ? {
        amount: typeof raw.correction.amount === 'number' ? raw.correction.amount : null,
        direction: raw.correction.direction === 'credit' || raw.correction.direction === 'payment' ? raw.correction.direction : null,
        name: raw.correction.name || null,
      }
      : null,
    query_name: raw.query_name || null,
    period: raw.period === 'month' ? 'month' : raw.period === 'today' ? 'today' : null,
    sure: raw.sure !== false,
    unsure_reason: raw.unsure_reason || null,
  }
  const spans = parseAmounts(transcript)
  const heard = (v: number) => spans.find((s) => s.value === v || s.alternatives.includes(v))
  switch (r.intent) {
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
        for (const f of span.flags) if (f !== 'fractional_rupee' && !reasons.includes(f)) reasons.push(f)
        entries.push({
          name: e.name,
          amount: { ...span, value: e.amount },
          direction: e.direction,
          dayOffset: e.day_offset,
          promise: e.promise,
          confidence: reasons.length > 1 ? 'low' : 'high',
          reasons,
        })
      }
      if (!entries.length) return { type: 'unknown' }
      return { type: 'entries', entries }
    }
  }
}
