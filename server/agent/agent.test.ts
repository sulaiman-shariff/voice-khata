import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { decide, AGENT_SYSTEM, type AgentContext } from './agent.js'
import { geminiAgentCall } from '../parse/gemini.js'

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

  it('throws when the model returns no tool call', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).includes('oauth2')
      ? new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 })
      : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] }), { status: 200 })))
    await expect(geminiAgentCall('s', 'u', tools)).rejects.toThrow(/no tool call/)
  })
})
