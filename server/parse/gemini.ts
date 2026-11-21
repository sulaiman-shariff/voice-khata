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
async function accessToken(): Promise<string> {
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
      tools: [{ functionDeclarations: [{ name: tool.name, description: tool.description, parametersJsonSchema: tool.input_schema }] }],
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

/** Measured: the first call or two after a cold start take 2-6 s, then ~0.55 s. */
export const WARM_TIMEOUT_MS = 15000
