/**
 * Gemini on Vertex AI (Mumbai, asia-south1) for the turns the fast parser cannot read.
 * Same prompt, tool schema and validation as before (llm.ts); only the model call differs.
 *
 * Auth: a service account with only `roles/aiplatform.user` (project in VERTEX_PROJECT). Its JSON
 * key arrives base64-encoded in GOOGLE_VERTEX_KEY; we sign a JWT with it and exchange it for an
 * access token, cached until shortly before it expires. No Google SDK needed.
 */
import crypto from 'node:crypto'

export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite'
const LOCATION = process.env.VERTEX_LOCATION ?? 'asia-south1'
/** A voice turn cannot wait: ~0.6 s is normal; give up at 3 s and ask the shopkeeper instead. */
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 3000)

interface ServiceKey {
  client_email: string
  private_key: string
  project_id: string
}

let key: ServiceKey | null = null
function serviceKey(): ServiceKey {
  if (key) return key
  const raw = process.env.GOOGLE_VERTEX_KEY
  if (!raw) throw new Error('GOOGLE_VERTEX_KEY is not set')
  key = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')) as ServiceKey
  return key
}

export function geminiConfigured(): boolean {
  return !!process.env.GOOGLE_VERTEX_KEY
}

let token: { value: string; until: number } | null = null
let pendingToken: Promise<string> | null = null

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url')

/** OAuth access token for the service account (JWT bearer grant), cached ~55 min. */
export async function accessToken(): Promise<string> {
  if (token && Date.now() < token.until) return token.value
  pendingToken ??= (async () => {
    const k = serviceKey()
    const now = Math.floor(Date.now() / 1000)
    const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const claims = b64url(JSON.stringify({
      iss: k.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
    }))
    const sig = crypto.createSign('RSA-SHA256').update(`${head}.${claims}`).sign(k.private_key)
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${b64url(sig)}` }),
      signal: AbortSignal.timeout(5000),
    })
    const j = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string }
    if (!res.ok || !j.access_token) throw new Error(`google token ${res.status}: ${j.error_description ?? ''}`)
    token = { value: j.access_token, until: Date.now() + Math.max(60, (j.expires_in ?? 3600) - 300) * 1000 }
    return token.value
  })().finally(() => {
    pendingToken = null
  })
  return pendingToken
}

export interface GeminiTool {
  name: string
  description?: string
  input_schema: unknown
}

/**
 * A JSON Schema with nullable unions (`type: ['string', 'null']`, `anyOf: [X, {type: 'null'}]`) as
 * the OpenAPI-style schema Vertex takes in `parameters` (`nullable: true`). Same meaning. In one
 * quiet spell (eval/agent_latency.ts, Mumbai, 30 calls each, back to back) the JSON-schema form
 * had p50 0.74 s / p90 4.1 s and this form p50 0.44 s / p90 0.54 s; interleaved runs later were
 * dominated by Mumbai congestion and did not separate the two clearly, so the race below is what
 * holds the budget. Kept: it is the form Vertex documents for function declarations.
 */
export function toVertexSchema(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(toVertexSchema)
  if (!x || typeof x !== 'object') return x
  const o: Record<string, unknown> = { ...(x as Record<string, unknown>) }
  if (Array.isArray(o.type)) {
    const types = (o.type as string[]).filter((t) => t !== 'null')
    if (types.length !== 1) throw new Error(`schema: cannot express type ${JSON.stringify(o.type)}`)
    if (types.length < (o.type as string[]).length) o.nullable = true
    o.type = types[0]
  }
  if (Array.isArray(o.anyOf)) {
    const alts = (o.anyOf as Record<string, unknown>[]).filter((a) => a.type !== 'null')
    if (alts.length < (o.anyOf as unknown[]).length) {
      if (alts.length !== 1) throw new Error('schema: cannot express a nullable union of several types')
      delete o.anyOf
      Object.assign(o, alts[0], { nullable: true })
    }
  }
  for (const k of Object.keys(o)) if (k !== 'enum' && k !== 'required') o[k] = toVertexSchema(o[k])
  return o
}

export const vertexDeclaration = (t: GeminiTool) => ({ name: t.name, description: t.description, parameters: toVertexSchema(t.input_schema) })

/** One forced tool call: returns the tool's arguments. */
export async function geminiToolCall<T>(system: string, user: string, tool: GeminiTool, signal?: AbortSignal, timeoutMs = TIMEOUT_MS): Promise<{ args: T; ms: number }> {
  const project = process.env.VERTEX_PROJECT ?? serviceKey().project_id
  const host = LOCATION === 'global' ? 'aiplatform.googleapis.com' : `${LOCATION}-aiplatform.googleapis.com`
  const url = `https://${host}/v1/projects/${project}/locations/${LOCATION}/publishers/google/models/${GEMINI_MODEL}:generateContent`
  const auth = await accessToken()
  const t0 = performance.now()
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      tools: [{ functionDeclarations: [vertexDeclaration(tool)] }],
      toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [tool.name] } },
      generationConfig: { temperature: 0, maxOutputTokens: 600, thinkingConfig: { thinkingBudget: 0 } },
    }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
  })
  const ms = performance.now() - t0
  const j = (await res.json()) as {
    error?: { message?: string }
    candidates?: { content?: { parts?: { functionCall?: { name?: string; args?: T } }[] } }[]
  }
  if (!res.ok) throw new Error(`gemini ${res.status}: ${j.error?.message?.slice(0, 200) ?? ''}`)
  const call = j.candidates?.[0]?.content?.parts?.find((p) => p.functionCall?.name === tool.name)?.functionCall
  if (!call?.args) throw new Error('gemini: no tool call')
  return { args: call.args, ms }
}

/** 16 kHz mono s16le PCM -> a playable WAV (44-byte header). */
function pcmToWav(pcm: Buffer): Buffer {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + pcm.length, 4)
  h.write('WAVEfmt ', 8)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20) // PCM
  h.writeUInt16LE(1, 22) // mono
  h.writeUInt32LE(16000, 24)
  h.writeUInt32LE(32000, 28) // byte rate
  h.writeUInt16LE(2, 32) // block align
  h.writeUInt16LE(16, 34) // bits
  h.write('data', 36)
  h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}

/**
 * The agent call is raced: the same request goes to Mumbai and twice to the `global` endpoint, the
 * first good answer wins and the others are cancelled; a fast failure (a 429) on one leaves the rest.
 * Measured with eval/agent_latency.ts (interleaved rounds, real contexts, 30-40 calls each): Mumbai
 * alone has congested spells (p50 0.5 s when quiet, then runs of 3-10 s calls, timeouts and 429s
 * that arrive after 8 s); `global` is slower but steadier (1-2 s, sometimes 3-8 s); a same-region
 * hedge after 1.2 s did not help (both copies slow). In one run:
 *   Mumbai only:                 p50 2.2 s  p90 5.5 s  13/30 over 3 s
 *   Mumbai + Mumbai after 1.2 s: p50 1.3 s  p90 7.5 s  12/30 over 3 s
 *   Mumbai + global at once:     p50 1.2 s  p90 2.3 s   1/30 over 3 s
 * and in a later one, 2 vs 3 requests: p90 2.5 vs 2.0 s, max 8.3 vs 2.3 s, 2/30 vs 0/30 over 3 s.
 * AGENT_HEDGE_MS delays the extra requests (default 0: all at once; `off`: Mumbai only);
 * AGENT_HEDGE_LOCATION lists where they go (default "global,global").
 */
const HEDGE_MS = () => (process.env.AGENT_HEDGE_MS === 'off' ? -1 : Number(process.env.AGENT_HEDGE_MS || 0))
/** where the extra requests go, comma-separated (one request per entry) */
const HEDGE_LOCATIONS = () => (process.env.AGENT_HEDGE_LOCATION || 'global,global').split(',').map((x) => x.trim()).filter(Boolean)
const modelUrl = (loc: string, project: string, model: string) =>
  `https://${loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`}/v1/projects/${project}/locations/${loc}/publishers/google/models/${model}:generateContent`

type AgentCalls = { calls: { name: string; args: Record<string, unknown> }[]; ms: number }

/** One turn, many tools: returns every functionCall the model made, in order. `audio` is 16 kHz mono s16le PCM. */
export async function geminiAgentCall(
  system: string, user: string, tools: GeminiTool[], audio?: Buffer, opts: { model?: string; timeoutMs?: number; hedgeMs?: number } = {},
): Promise<AgentCalls> {
  const project = process.env.VERTEX_PROJECT ?? serviceKey().project_id
  const model = opts.model ?? GEMINI_MODEL
  const auth = await accessToken()
  const parts: unknown[] = []
  if (audio?.length) parts.push({ inlineData: { mimeType: 'audio/wav', data: pcmToWav(audio).toString('base64') } })
  parts.push({ text: user })
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts }],
    tools: [{ functionDeclarations: tools.map(vertexDeclaration) }],
    toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: tools.map((t) => t.name) } },
    generationConfig: { temperature: 0, maxOutputTokens: 800, thinkingConfig: { thinkingBudget: 0 } },
  })
  const t0 = performance.now()
  const deadline = AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS)
  const done = new AbortController() // cancels the loser
  const signal = AbortSignal.any([deadline, done.signal])

  const attempt = async (loc: string): Promise<AgentCalls> => {
    const res = await fetch(modelUrl(loc, project, model), { method: 'POST', headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' }, body, signal })
    const j = (await res.json()) as {
      error?: { message?: string }
      candidates?: { content?: { parts?: { functionCall?: { name?: string; args?: Record<string, unknown> } }[] } }[]
    }
    if (!res.ok) throw new Error(`gemini ${res.status}: ${j.error?.message?.slice(0, 200) ?? ''}`)
    const calls = (j.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => p.functionCall?.name)
      .map((p) => ({ name: p.functionCall!.name!, args: p.functionCall!.args ?? {} }))
    if (!calls.length) throw new Error('gemini: no tool call')
    return { calls, ms: performance.now() - t0 }
  }

  const hedgeMs = opts.hedgeMs ?? HEDGE_MS()
  const primary = process.env.VERTEX_LOCATION ?? LOCATION
  if (!(hedgeMs >= 0)) return attempt(primary)
  const legs = [primary, ...HEDGE_LOCATIONS()]
  try {
    return await new Promise<AgentCalls>((resolve, reject) => {
      let running = 0
      let started = 0
      let lastError: unknown
      let timer: ReturnType<typeof setTimeout> | undefined
      const start = () => {
        if (started >= legs.length || signal.aborted) return
        const loc = legs[started++]
        running++
        attempt(loc).then((r) => {
          clearTimeout(timer)
          resolve(r)
        }, (e) => {
          lastError = e
          running--
          // a fast failure (429, 5xx) starts the next request at once; the last failure is the answer
          if (started < legs.length && !deadline.aborted) {
            clearTimeout(timer)
            hedge()
          } else if (running === 0) reject(lastError)
        })
      }
      const hedge = () => {
        while (started < legs.length && !signal.aborted) start()
      }
      start()
      if (hedgeMs === 0) hedge()
      else timer = setTimeout(hedge, hedgeMs)
      deadline.addEventListener('abort', () => clearTimeout(timer), { once: true })
    })
  } finally {
    done.abort()
  }
}

/** Measured: the first call or two after a cold start take 2-6 s, then ~0.55 s. */
export const WARM_TIMEOUT_MS = 15000
