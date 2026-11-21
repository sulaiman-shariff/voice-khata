/**
 * Gemini vs Claude Haiku on the slow path: same prompt, same tool schema, same validation, same
 * hard utterances (eval/llm_cases.ts), run back to back from the same machine.
 * Usage: npx tsx --env-file=.env eval/llm_gemini.ts [model]   (default gemini-3.5-flash-lite)
 * Uses the Gemini Developer API (global endpoint); GEMINI_API_KEY from .env.
 */
import { CLAUDE_MODEL as LLM_MODEL, type LlmReading, SYSTEM, TOOL, readWithLlm, userMessage } from '../server/parse/llm.js'
import { CASES, CTX, pct, score } from './llm_cases.js'

const MODEL = process.argv[2] ?? 'gemini-3.5-flash-lite'
// Vertex AI in a region (VERTEX_PROJECT, VERTEX_LOCATION, VERTEX_TOKEN from `gcloud auth
// print-access-token <account>`), else the Gemini Developer API's global endpoint with GEMINI_API_KEY
const VX = process.env.VERTEX_PROJECT
const LOC = process.env.VERTEX_LOCATION ?? 'asia-south1'
const URL_ = VX
  ? `https://${LOC === 'global' ? '' : `${LOC}-`}aiplatform.googleapis.com/v1/projects/${VX}/locations/${LOC}/publishers/google/models/${MODEL}:generateContent`
  : `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`
const AUTH: Record<string, string> = VX ? { authorization: `Bearer ${process.env.VERTEX_TOKEN ?? ''}` } : { 'x-goog-api-key': process.env.GEMINI_API_KEY ?? '' }
const WHERE = VX ? `Vertex AI ${LOC} (${VX})` : 'Gemini API (global)'

type Thinking = Record<string, unknown> | undefined
let thinking: Thinking = { thinkingBudget: 0 }

async function readWithGemini(text: string): Promise<{ reading: Partial<LlmReading>; ms: number; usage?: unknown }> {
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: userMessage(text, CTX) }] }],
    tools: [{ functionDeclarations: [{ name: TOOL.name, description: TOOL.description, parametersJsonSchema: TOOL.input_schema }] }],
    toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [TOOL.name] } },
    generationConfig: { temperature: 0, maxOutputTokens: 600, ...(thinking ? { thinkingConfig: thinking } : {}) },
  }
  const t0 = performance.now()
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { ...AUTH, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const ms = performance.now() - t0
  const j = (await res.json()) as {
    error?: { message?: string }
    candidates?: { content?: { parts?: { functionCall?: { name?: string; args?: Partial<LlmReading> } }[] } }[]
    usageMetadata?: unknown
  }
  if (!res.ok) throw new Error(`gemini ${res.status}: ${j.error?.message?.slice(0, 200)}`)
  const call = j.candidates?.[0]?.content?.parts?.find((p) => p.functionCall?.name === TOOL.name)?.functionCall
  if (!call?.args) throw new Error('gemini: no tool call')
  return { reading: call.args, ms, usage: j.usageMetadata }
}

// warm both connections (TLS, caches) so the measured pass is steady-state, like a warm instance
try {
  await readWithGemini('haan')
} catch (e) {
  // Gemini 3 models may want thinkingLevel instead of a budget: try that, then no thinking config
  console.log(`warm-up with thinkingBudget 0 failed (${String(e).slice(0, 120)}), retrying`)
  thinking = { thinkingLevel: 'minimal' }
  try {
    await readWithGemini('haan')
  } catch {
    thinking = undefined
    await readWithGemini('haan')
  }
}
await readWithLlm('haan', CTX)
console.log(`Gemini ${MODEL} on ${WHERE} (thinking ${JSON.stringify(thinking ?? 'default')}) vs ${LLM_MODEL}, one pass each\n`)

const rows: { text: string; g: { ok: boolean; ms: number; err?: string }; h: { ok: boolean; ms: number } }[] = []
for (const [text, exp] of CASES) {
  let g: { ok: boolean; ms: number; err?: string }
  try {
    const r = await readWithGemini(text)
    g = { ok: score(text, r.reading, exp), ms: r.ms }
    if (!g.ok) g.err = JSON.stringify(r.reading).slice(0, 160)
  } catch (e) {
    g = { ok: false, ms: NaN, err: String(e).slice(0, 160) }
  }
  const hr = await readWithLlm(text, CTX)
  const h = { ok: score(text, hr.reading, exp), ms: hr.ms }
  rows.push({ text, g, h })
  console.log(`${g.ok ? 'OK ' : 'BAD'} gemini ${String(Math.round(g.ms)).padStart(5)}ms | ${h.ok ? 'OK ' : 'BAD'} haiku ${String(Math.round(h.ms)).padStart(5)}ms | ${text}${g.err ? `\n      gemini: ${g.err}` : ''}`)
}
const sum = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length
const gl = rows.map((r) => r.g.ms).filter((x) => !Number.isNaN(x))
const hl = rows.map((r) => r.h.ms)
console.log(`\nGemini ${MODEL} on ${WHERE}: ${sum((r) => r.g.ok)}/${rows.length} correct, p50 ${Math.round(pct(gl, 0.5))} ms, p90 ${Math.round(pct(gl, 0.9))} ms`)
console.log(`Haiku  ${LLM_MODEL}: ${sum((r) => r.h.ok)}/${rows.length} correct, p50 ${Math.round(pct(hl, 0.5))} ms, p90 ${Math.round(pct(hl, 0.9))} ms`)
