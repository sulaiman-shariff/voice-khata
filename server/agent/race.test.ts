/**
 * decide() races the Gemini race against Claude Haiku 5.5 on text turns. Transports are mocked at
 * fetch (both the Vertex calls and the Anthropic SDK go through the global fetch); timers are fake.
 * (That a thrown decide() ends in didNotCatch is session.test.ts "agent failure".)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { decide, AGENT_SYSTEM, type AgentContext } from './agent.js'
import { resetAccessTokenForTests } from '../parse/gemini.js'

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })

const tools = [
  { name: 'add_entries', description: 'add', input_schema: { type: 'object', properties: { name: { type: ['string', 'null'] } } } },
  { name: 'query_balance', description: 'q', input_schema: { type: 'object', properties: {} } },
]
const ctx: AgentContext = {
  lang: 'hi', heard: [{ locale: 'hi-IN', text: 'Suresh pe kitna baaki hai' }],
  history: [], screen: 'home', customers: ['Ramesh', 'Suresh'], recent: [], pending: null,
}

type Leg = { ms: number; status?: number; body?: unknown }
let gemini: Leg
let haiku: Leg
let sent: { kind: 'gemini' | 'haiku'; body: any; aborted: boolean }[]

const GEMINI_OK = { candidates: [{ content: { parts: [{ functionCall: { name: 'query_balance', args: { name: 'Suresh', from: 'gemini' } } }] } }] }
const haikuMsg = (content: unknown[], stop_reason = 'tool_use') => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content, stop_reason, stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 1234, cache_creation_input_tokens: 0 },
})
const HAIKU_OK = haikuMsg([
  { type: 'tool_use', id: 'tu_1', name: 'query_balance', input: { name: 'Suresh', from: 'haiku' } },
  { type: 'tool_use', id: 'tu_2', name: 'add_entries', input: { name: null } },
])

function reply(leg: Leg, signal: AbortSignal | null | undefined, rec: { aborted: boolean }): Promise<Response> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(new Response(JSON.stringify(leg.body), { status: leg.status ?? 200, headers: { 'content-type': 'application/json' } })), leg.ms)
    const abort = () => {
      clearTimeout(t)
      rec.aborted = true
      reject(signal?.reason ?? new DOMException('aborted', 'AbortError'))
    }
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  resetAccessTokenForTests()
  sent = []
  gemini = { ms: 300, body: GEMINI_OK }
  haiku = { ms: 900, body: HAIKU_OK }
  process.env.GOOGLE_VERTEX_KEY = JSON.stringify({ client_email: 'a@b.c', private_key: privateKey, project_id: 'p' })
  process.env.ANTHROPIC_API_KEY = 'test-key'
  delete process.env.AGENT_HAIKU
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 })
    const kind = url.includes('anthropic.com') ? 'haiku' : 'gemini'
    const rec = { kind, body: JSON.parse(String(init?.body)), aborted: false } as (typeof sent)[number]
    sent.push(rec)
    return reply(kind === 'haiku' ? haiku : gemini, init?.signal, rec)
  }))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.AGENT_HAIKU
})

/** run decide() to completion on the fake clock */
async function run(audio?: Buffer, untilMs = 5000) {
  const p = decide(ctx, tools, audio)
  const settled = p.then((r) => ({ r, e: null }), (e: unknown) => ({ r: null, e }))
  await vi.advanceTimersByTimeAsync(untilMs)
  return settled
}
const legs = (k: 'gemini' | 'haiku') => sent.filter((s) => s.kind === k)

describe('decide() races Gemini and Haiku', () => {
  it('Gemini 300 ms vs Haiku 900 ms: Gemini wins and the Haiku request is aborted', async () => {
    const { r } = await run()
    expect(r!.model).toBe('gemini')
    expect(r!.calls).toEqual([{ name: 'query_balance', args: { name: 'Suresh', from: 'gemini' } }])
    expect(legs('haiku')).toHaveLength(1)
    expect(legs('haiku')[0].aborted).toBe(true)
    expect(legs('gemini')).toHaveLength(3) // the Gemini race itself is unchanged
  })

  it('Gemini 1.5 s vs Haiku 900 ms: Haiku wins (all its calls, in order) and every Gemini leg is aborted', async () => {
    gemini.ms = 1500
    const { r } = await run()
    expect(r!.model).toBe('haiku')
    expect(r!.calls).toEqual([
      { name: 'query_balance', args: { name: 'Suresh', from: 'haiku' } },
      { name: 'add_entries', args: { name: null } },
    ])
    expect(r!.cacheRead).toBe(1234)
    expect(r!.ms).toBeGreaterThanOrEqual(900)
    expect(legs('gemini').every((g) => g.aborted)).toBe(true)
  })

  it('Gemini fails at once (429) while Haiku is fine: Haiku answers', async () => {
    gemini = { ms: 0, status: 429, body: { error: { message: 'quota' } } }
    const { r } = await run()
    expect(r!.model).toBe('haiku')
  })

  it('Haiku refuses at once while Gemini is fine: Gemini answers', async () => {
    haiku = { ms: 0, body: haikuMsg([], 'refusal') }
    gemini.ms = 1500
    const { r } = await run()
    expect(r!.model).toBe('gemini')
  })

  it('Haiku answers with no tool_use (or only tools we do not have): Gemini answers', async () => {
    haiku = { ms: 0, body: haikuMsg([{ type: 'text', text: 'hello' }], 'end_turn') }
    expect((await run()).r!.model).toBe('gemini')
    haiku = { ms: 0, body: haikuMsg([{ type: 'tool_use', id: 'x', name: 'drop_tables', input: {} }]) }
    expect((await run()).r!.model).toBe('gemini')
  })

  it('Haiku 429 / 500 at once: Gemini answers', async () => {
    haiku = { ms: 0, status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } } }
    expect((await run()).r!.model).toBe('gemini')
    haiku = { ms: 0, status: 500, body: { type: 'error', error: { type: 'api_error', message: 'oops' } } }
    expect((await run()).r!.model).toBe('gemini')
  })

  it('both fail: decide() throws', async () => {
    gemini = { ms: 0, status: 429, body: { error: { message: 'quota' } } }
    haiku = { ms: 0, body: haikuMsg([], 'refusal') }
    const { e } = await run()
    expect(String(e)).toMatch(/both models failed/)
  })

  it('both past the 3 s deadline: decide() throws at 3 s and both legs are aborted', async () => {
    gemini.ms = 10_000
    haiku.ms = 10_000
    const p = decide(ctx, tools)
    const settled = p.then(() => 'ok', () => 'threw')
    await vi.advanceTimersByTimeAsync(2999)
    expect(sent.some((s) => s.aborted)).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    expect(await settled).toBe('threw')
    expect(sent.every((s) => s.aborted)).toBe(true)
  })

  it('the Haiku request: model, thinking off at effort low, no sampling params, forced tool, cached system, plain JSON schema', async () => {
    await run()
    const b = legs('haiku')[0].body
    expect(b.model).toBe('claude-haiku-5-5')
    expect(b.thinking).toEqual({ type: 'disabled' })
    expect(b.output_config).toEqual({ effort: 'low' })
    for (const k of ['temperature', 'top_p', 'top_k']) expect(b).not.toHaveProperty(k)
    expect(b.tool_choice).toEqual({ type: 'any' })
    expect(b.system).toEqual([{ type: 'text', text: AGENT_SYSTEM, cache_control: { type: 'ephemeral' } }])
    expect(b.tools.map((t: { name: string }) => t.name)).toEqual(['add_entries', 'query_balance'])
    expect(b.tools[0].input_schema.properties.name).toEqual({ type: ['string', 'null'] })
    expect(b.messages[0].content).toContain('Suresh pe kitna baaki hai')
  })
})

describe('Haiku is never called', () => {
  it('on an audio turn', async () => {
    gemini.ms = 1500
    const { r } = await run(Buffer.alloc(3200, 1))
    expect(r!.model).toBe('gemini')
    expect(legs('haiku')).toHaveLength(0)
  })

  it('with AGENT_HAIKU=off', async () => {
    process.env.AGENT_HAIKU = 'off'
    gemini.ms = 1500
    expect((await run()).r!.model).toBe('gemini')
    expect(legs('haiku')).toHaveLength(0)
  })

  it('with no ANTHROPIC_API_KEY', async () => {
    delete process.env.ANTHROPIC_API_KEY
    gemini.ms = 1500
    expect((await run()).r!.model).toBe('gemini')
    expect(legs('haiku')).toHaveLength(0)
  })
})
