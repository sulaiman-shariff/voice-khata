import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { decide, AGENT_SYSTEM, type AgentContext } from './agent.js'
import { geminiAgentCall, toVertexSchema } from '../parse/gemini.js'
import { GEMINI_TOOLS } from './tools.js'

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })

const tools = [
  { name: 'add_entries', description: 'add', input_schema: { type: 'object', properties: {} } },
  { name: 'query_balance', description: 'q', input_schema: { type: 'object', properties: {} } },
]

const ctx: AgentContext = {
  lang: 'hi',
  heard: [{ locale: 'hi-IN', text: 'Ramesh ko do sau' }, { locale: 'en-IN', text: 'and what does Suresh owe' }],
  history: [], screen: 'home', customers: ['Ramesh', 'Suresh'], recent: [], pending: null,
}

let bodies: any[]
beforeEach(() => {
  bodies = []
  process.env.GOOGLE_VERTEX_KEY = JSON.stringify({ client_email: 'a@b.c', private_key: privateKey, project_id: 'p' })
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
    if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 })
    bodies.push({ url: String(url), body: JSON.parse(init.body) })
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [
        { functionCall: { name: 'add_entries', args: { entries: [{ name: 'Ramesh', paise: 20000 }] } } },
        { functionCall: { name: 'query_balance', args: { name: 'Suresh' } } },
      ] } }],
    }), { status: 200 })
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('agent', () => {
  it('decide() passes all heard transcripts and returns the tool calls in order', async () => {
    const r = await decide(ctx, tools)
    expect(r.calls).toEqual([
      { name: 'add_entries', args: { entries: [{ name: 'Ramesh', paise: 20000 }] } },
      { name: 'query_balance', args: { name: 'Suresh' } },
    ])
    const sent = JSON.stringify(bodies[0].body)
    for (const h of ctx.heard) expect(sent).toContain(h.text)
    expect(sent).toContain('add_entries')
    expect(sent).toContain('query_balance')
    expect(bodies[0].body.toolConfig.functionCallingConfig.allowedFunctionNames).toEqual(['add_entries', 'query_balance'])
    expect(bodies[0].body.systemInstruction.parts[0].text).toBe(AGENT_SYSTEM)
    // raced: the same request to Mumbai and twice to the global endpoint
    expect(bodies.map((b) => b.url.match(/locations\/([^/]+)/)![1])).toEqual(['asia-south1', 'global', 'global'])
    expect(bodies[1].url.startsWith('https://aiplatform.googleapis.com/')).toBe(true)
    expect(bodies[1].body).toEqual(bodies[0].body)
    expect(bodies[2].body).toEqual(bodies[0].body)
  })

  it('AGENT_HEDGE_MS=off sends one request', async () => {
    process.env.AGENT_HEDGE_MS = 'off'
    try {
      await decide(ctx, tools)
    } finally {
      delete process.env.AGENT_HEDGE_MS
    }
    expect(bodies).toHaveLength(1)
  })

  it('sends audio as a WAV inlineData part before the text', async () => {
    const pcm = Buffer.alloc(3200, 1)
    await geminiAgentCall('sys', 'user', tools, pcm)
    const parts = bodies[0].body.contents[0].parts
    expect(parts[0].inlineData.mimeType).toBe('audio/wav')
    const wav = Buffer.from(parts[0].inlineData.data, 'base64')
    expect(wav.subarray(0, 4).toString()).toBe('RIFF')
    expect(wav.readUInt32LE(24)).toBe(16000)
    expect(wav.length).toBe(44 + 3200)
    expect(parts[1].text).toBe('user')
  })

  it('opts.model overrides the model in the URL', async () => {
    await geminiAgentCall('s', 'u', tools, undefined, { model: 'gemini-x' })
    expect(bodies[0].url).toContain('/models/gemini-x:generateContent')
  })

  it('declares tools as OpenAPI-style schemas: nullable unions become nullable (much faster on Vertex)', async () => {
    await geminiAgentCall('s', 'u', GEMINI_TOOLS)
    const decls = bodies[0].body.tools[0].functionDeclarations
    expect(decls.every((d: any) => d.parameters && !d.parametersJsonSchema)).toBe(true)
    const sent = JSON.stringify(decls)
    expect(sent).not.toContain('anyOf')
    expect(sent).not.toContain('"null"')
    const entry = decls[0].parameters.properties.entries.items.properties
    expect(entry.name).toEqual({ type: 'string', nullable: true })
    expect(entry.direction).toEqual({ type: 'string', enum: ['credit', 'payment'], nullable: true })
    expect(decls[0].parameters.properties.entries.items.required).toEqual(['name', 'amount', 'direction'])
  })

  it('toVertexSchema keeps plain schemas as they are and refuses what it cannot express', () => {
    const plain = { type: 'object', properties: { a: { type: 'string', enum: ['x', 'null'] } }, required: ['a'] }
    expect(toVertexSchema(plain)).toEqual(plain)
    expect(() => toVertexSchema({ type: ['string', 'number'] })).toThrow()
    expect(() => toVertexSchema({ anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }] })).toThrow()
  })

  it('throws when the model returns no tool call', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).includes('oauth2')
      ? new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 })
      : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] }), { status: 200 })))
    await expect(geminiAgentCall('s', 'u', tools)).rejects.toThrow(/no tool call/)
  })

  describe('hedged requests', () => {
    const ok = (name: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name, args: {} } }] } }] }), { status: 200 })
    /** fetch that answers the n-th model request after delays[n] ms (or with a 429 when the delay is negative) */
    const stub = (delays: number[]) => {
      let n = 0
      const seen: number[] = []
      vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
        if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 })
        const i = n++
        seen.push(i)
        const d = delays[i] ?? 0
        if (d < 0) return new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 })
        return new Promise<Response>((res, rej) => {
          const t = setTimeout(() => res(ok(`r${i}`)), d)
          init.signal?.addEventListener('abort', () => { clearTimeout(t); rej(init.signal.reason) })
        })
      }))
      return seen
    }

    it('a fast answer sends one request', async () => {
      const seen = stub([10])
      const r = await geminiAgentCall('s', 'u', tools, undefined, { hedgeMs: 100 })
      await new Promise((ok) => setTimeout(ok, 150))
      expect(r.calls[0].name).toBe('r0')
      expect(seen).toEqual([0])
    })

    it('a slow first request is overtaken by the hedge', async () => {
      const seen = stub([2000, 20, 2000])
      const t0 = Date.now()
      const r = await geminiAgentCall('s', 'u', tools, undefined, { hedgeMs: 50, timeoutMs: 3000 })
      expect(r.calls[0].name).toBe('r1')
      expect(Date.now() - t0).toBeLessThan(1000)
      expect(seen).toEqual([0, 1, 2])
    })

    it('a fast failure (429) starts the second request at once', async () => {
      const seen = stub([-1, 10, 2000])
      const t0 = Date.now()
      const r = await geminiAgentCall('s', 'u', tools, undefined, { hedgeMs: 1000 })
      expect(r.calls[0].name).toBe('r1')
      expect(Date.now() - t0).toBeLessThan(500)
      expect(seen).toEqual([0, 1, 2])
    })

    it('all failing fails the call; never more requests than legs', async () => {
      const seen = stub([-1, -1, -1, 10])
      await expect(geminiAgentCall('s', 'u', tools, undefined, { hedgeMs: 10 })).rejects.toThrow(/429/)
      expect(seen).toEqual([0, 1, 2])
    })

    it('AGENT_HEDGE_LOCATION lists the extra requests', async () => {
      process.env.AGENT_HEDGE_LOCATION = 'global,global'
      try {
        const seen = stub([2000, 2000, 10])
        const r = await geminiAgentCall('s', 'u', tools, undefined, { hedgeMs: 0, timeoutMs: 3000 })
        expect(r.calls[0].name).toBe('r2')
        expect(seen).toEqual([0, 1, 2])
      } finally {
        delete process.env.AGENT_HEDGE_LOCATION
      }
    })

    it('the deadline still holds', async () => {
      stub([2000, 2000, 2000])
      await expect(geminiAgentCall('s', 'u', tools, undefined, { hedgeMs: 20, timeoutMs: 100 })).rejects.toThrow()
    })
  })
})
