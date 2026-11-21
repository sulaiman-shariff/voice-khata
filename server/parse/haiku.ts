/**
 * Claude Haiku 5.5 as the second model on every text agent turn: decide() races it against the
 * Gemini race and keeps the first good answer. Same system prompt and tools; the tools go as plain
 * JSON Schema (not the Vertex `nullable` form).
 *
 * On when ANTHROPIC_API_KEY is set, unless AGENT_HAIKU=off. No retries here: the race owns them.
 */
import Anthropic from '@anthropic-ai/sdk'
import type { GeminiTool } from './gemini.js'

export const HAIKU_MODEL = 'claude-haiku-5-5'

export function haikuEnabled(): boolean {
  return process.env.AGENT_HAIKU !== 'off' && !!process.env.ANTHROPIC_API_KEY
}

let client: Anthropic | null = null
function anthropic(): Anthropic {
  // fetch goes through the current global, so tests can stub it after the client exists
  client ??= new Anthropic({ maxRetries: 0, fetch: (input, init) => globalThis.fetch(input, init) })
  return client
}

export interface HaikuCalls {
  calls: { name: string; args: Record<string, unknown> }[]
  ms: number
  /** prompt-cache hits for this request (0 when the prefix is under the model's minimum) */
  cacheRead: number
}

/** One turn: every tool_use block, in order. No tool call, a refusal or an API error throws (a lost leg). */
export async function haikuAgentCall(
  system: string, user: string, tools: GeminiTool[],
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<HaikuCalls> {
  const t0 = performance.now()
  let msg: Anthropic.Message
  try {
    msg = await anthropic().messages.create({
      model: HAIKU_MODEL,
      max_tokens: 1024,
      thinking: { type: 'disabled' },
      output_config: { effort: 'low' },
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema as Anthropic.Tool.InputSchema })),
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: user }],
    }, { signal: opts.signal, ...(opts.timeoutMs ? { timeout: opts.timeoutMs } : {}) })
  } catch (e) {
    if (e instanceof Anthropic.APIUserAbortError) throw e
    if (e instanceof Anthropic.RateLimitError) throw new Error('haiku 429: rate limited', { cause: e })
    if (e instanceof Anthropic.APIConnectionError) throw new Error('haiku: connection failed', { cause: e })
    if (e instanceof Anthropic.APIError) throw new Error(`haiku ${e.status ?? '?'}: ${e.message.slice(0, 200)}`, { cause: e })
    throw e
  }
  if (msg.stop_reason === 'refusal') throw new Error('haiku: refusal')
  const calls = msg.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    .map((b) => ({ name: b.name, args: (b.input ?? {}) as Record<string, unknown> }))
  if (!calls.length) throw new Error(`haiku: no tool call (stop_reason ${msg.stop_reason})`)
  return { calls, ms: performance.now() - t0, cacheRead: msg.usage.cache_read_input_tokens ?? 0 }
}
