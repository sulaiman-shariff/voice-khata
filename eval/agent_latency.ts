/**
 * Agent-call latency bench: the real request (AGENT_SYSTEM + GEMINI_TOOLS + a recorded context),
 * sent sequentially, interleaved across variants (round i runs every variant once on context i), so
 * a slow spell on Vertex's side hits all variants alike. Prints p50/p90/max/errors and prompt tokens.
 *
 *   GOOGLE_VERTEX_KEY=... VERTEX_PROJECT=... LLM_TIMEOUT_MS=10000 npx tsx --env-file=.env  *     eval/agent_latency.ts [ctxs.json] base decide decide@off decide@1200@asia-south1 [--n 30] [--gap ms] [-v]
 *
 * ctxs.json (default eval/corpus/agent_contexts.json): AgentContexts the 28 production conversations
 * of eval/replay.ts send. Variants: see VARIANTS below; `base` is the request as sent before
 * task 16 (parametersJsonSchema, Mumbai only), `decide` the real code path.
 */
import fs from 'node:fs'
import { AGENT_SYSTEM, type AgentContext, decide, userTurn } from '../server/agent/agent.js'
import { GEMINI_TOOLS } from '../server/agent/tools.js'
import { accessToken } from '../server/parse/gemini.js'

const args = process.argv.slice(2)
const n = args.includes('--n') ? Number(args[args.indexOf('--n') + 1]) : 30
/** idle time before each call, like the gap between two voice turns (the pooled connection may close) */
const gap = args.includes('--gap') ? Number(args[args.indexOf('--gap') + 1]) : 0
const file = args.find((a) => a.endsWith('.json')) ?? 'eval/corpus/agent_contexts.json'
const ctxs: AgentContext[] = JSON.parse(fs.readFileSync(file, 'utf8'))
const project = process.env.VERTEX_PROJECT!

interface Opts { loc: string; model: string; stream?: boolean; tools?: 'full' | 'none'; cached?: string; timeout?: number; mode?: 'ANY' | 'AUTO' | 'ANYALL' | 'VALIDATED'; hedgeMs?: number; hedgeLoc?: string; simple?: boolean; few?: boolean }

/** nullable unions flattened to the plain type (OpenAPI-style `nullable`) */
const simplify = (x: unknown): unknown => {
  if (Array.isArray(x)) return x.map(simplify)
  if (!x || typeof x !== 'object') return x
  const o = { ...(x as Record<string, unknown>) }
  if (Array.isArray(o.type)) { o.type = (o.type as string[]).find((t) => t !== 'null'); o.nullable = true }
  if (Array.isArray(o.anyOf)) { const nn = (o.anyOf as Record<string, unknown>[]).filter((a) => a.type !== 'null'); if (nn.length === 1) { delete o.anyOf; Object.assign(o, nn[0], { nullable: true }) } }
  for (const k of Object.keys(o)) o[k] = simplify(o[k])
  return o
}
const toolsOf = (o: Opts) => (o.few ? GEMINI_TOOLS.filter((t) => ['add_entries', 'query_balance', 'not_for_me', 'unclear', 'answer_question'].includes(t.name)) : GEMINI_TOOLS)

const body = (o: Opts, ctx: AgentContext) => JSON.stringify({
  ...(o.cached ? { cachedContent: o.cached } : {
    systemInstruction: { parts: [{ text: AGENT_SYSTEM }] },
    ...(o.tools === 'none' ? {} : { tools: [{ functionDeclarations: toolsOf(o).map((t) => (o.simple ? { name: t.name, description: t.description, parameters: simplify(t.input_schema) } : { name: t.name, description: t.description, parametersJsonSchema: t.input_schema })) }] }),
  }),
  contents: [{ role: 'user', parts: [{ text: userTurn(ctx) }] }],
  ...(o.tools === 'none' ? {} : { toolConfig: { functionCallingConfig: o.mode === 'AUTO' || o.mode === 'VALIDATED' ? { mode: o.mode } : o.mode === 'ANYALL' ? { mode: 'ANY' } : { mode: 'ANY', allowedFunctionNames: toolsOf(o).map((t) => t.name) } } }),
  generationConfig: { temperature: 0, maxOutputTokens: 800, thinkingConfig: { thinkingBudget: 0 } },
})

const host = (loc: string) => (loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`)

async function single(o: Opts, ctx: AgentContext, outer?: AbortSignal): Promise<{ ms: number; tokens?: number; cachedTok?: number; err?: string }> {
  const url = `https://${host(o.loc)}/v1/projects/${project}/locations/${o.loc}/publishers/google/models/${o.model}:${o.stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`
  const auth = await accessToken()
  const t0 = performance.now()
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' },
      body: body(o, ctx),
      signal: outer ? AbortSignal.any([outer, AbortSignal.timeout(o.timeout ?? Number(process.env.LLM_TIMEOUT_MS ?? 10000))]) : AbortSignal.timeout(o.timeout ?? Number(process.env.LLM_TIMEOUT_MS ?? 10000)),
    })
    if (o.stream) {
      // time to the first functionCall chunk
      const reader = res.body!.getReader()
      let text = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        text += new TextDecoder().decode(value)
        if (text.includes('functionCall')) break
      }
      const ms = performance.now() - t0
      void reader.cancel().catch(() => {})
      if (!res.ok) return { ms, err: `${res.status}` }
      return { ms }
    }
    const j = (await res.json()) as { error?: { message?: string }; usageMetadata?: { promptTokenCount?: number; cachedContentTokenCount?: number }; candidates?: { content?: { parts?: { functionCall?: unknown; text?: string }[] } }[] }
    const ms = performance.now() - t0
    if (!res.ok) return { ms, err: `${res.status} ${j.error?.message?.slice(0, 80)}` }
    if (!j.candidates?.[0]?.content?.parts?.some((p) => p.functionCall)) return { ms, err: `no call: ${JSON.stringify(j.candidates?.[0]?.content?.parts ?? []).slice(0, 80)}` }
    return { ms, tokens: j.usageMetadata?.promptTokenCount, cachedTok: j.usageMetadata?.cachedContentTokenCount }
  } catch (e) {
    return { ms: performance.now() - t0, err: String(e).slice(0, 60) }
  }
}

/** hedged: a second request after hedgeMs (to hedgeLoc or the same place); the first good answer wins. */
async function once(o: Opts, ctx: AgentContext): Promise<{ ms: number; tokens?: number; cachedTok?: number; err?: string }> {
  if (!o.hedgeMs) return single(o, ctx)
  const t0 = performance.now()
  const ac = new AbortController()
  const first = single({ ...o, hedgeMs: undefined }, ctx, ac.signal)
  const second = new Promise<Awaited<ReturnType<typeof single>>>((ok) => {
    const timer = setTimeout(() => single({ ...o, loc: o.hedgeLoc ?? o.loc, hedgeMs: undefined }, ctx, ac.signal).then(ok), o.hedgeMs)
    void first.then((r) => { if (!r.err) clearTimeout(timer) })
  })
  const good = (p: Promise<Awaited<ReturnType<typeof single>>>) => p.then((r) => (r.err ? new Promise<never>(() => {}) : r))
  const r = await Promise.race([good(first), good(second), Promise.allSettled([first, second]).then(() => first)])
  ac.abort()
  return { ...r, ms: performance.now() - t0 }
}

const stats = (label: string, r: { ms: number; tokens?: number; cachedTok?: number; err?: string }[]) => {
  const ok = r.filter((x) => !x.err).map((x) => x.ms).sort((a, b) => a - b)
  const q = (f: number) => (ok.length ? ok[Math.min(ok.length - 1, Math.floor(ok.length * f))].toFixed(0) : '-')
  const errs = r.filter((x) => x.err)
  const tok = r.find((x) => x.tokens)
  const cached = r.filter((x) => x.cachedTok).length
  const over3 = r.filter((x) => x.err || x.ms > 3000).length
  console.log(`${label.padEnd(34)} n ${r.length} p50 ${q(0.5)} p90 ${q(0.9)} max ${ok.at(-1)?.toFixed(0) ?? '-'} >3s/err ${over3} errors ${errs.length}${errs.length ? ` (${[...new Set(errs.map((e) => e.err))].join('; ')})` : ''} tok ${tok?.tokens ?? '-'} cachedHits ${cached}`)
}

async function createCache(loc: string, model: string): Promise<string> {
  const auth = await accessToken()
  const res = await fetch(`https://${host(loc)}/v1/projects/${project}/locations/${loc}/cachedContents`, {
    method: 'POST',
    headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: `projects/${project}/locations/${loc}/publishers/google/models/${model}`,
      systemInstruction: { parts: [{ text: AGENT_SYSTEM }] },
      tools: [{ functionDeclarations: GEMINI_TOOLS.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.input_schema })) }],
      ttl: '1800s',
    }),
  })
  const j = (await res.json()) as { name?: string; error?: { message?: string } }
  if (!j.name) throw new Error(`cache: ${res.status} ${j.error?.message}`)
  return j.name
}

const M = process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite'
const VARIANTS: Record<string, () => Promise<Opts | 'decide'>> = {
  base: async () => ({ loc: 'asia-south1', model: M }),
  global: async () => ({ loc: 'global', model: M }),
  stream: async () => ({ loc: 'asia-south1', model: M, stream: true }),
  notools: async () => ({ loc: 'asia-south1', model: M, tools: 'none' }),
  cached: async () => ({ loc: 'asia-south1', model: M, cached: await createCache('asia-south1', M) }),
  decide: async () => 'decide',
  auto: async () => ({ loc: 'asia-south1', model: M, mode: 'AUTO' }),
  simple: async () => ({ loc: 'asia-south1', model: M, simple: true }),
  gsimple: async () => ({ loc: 'global', model: M, simple: true }),
  sstream: async () => ({ loc: 'asia-south1', model: M, simple: true, stream: true }),
  shedge: async () => ({ loc: 'asia-south1', model: M, simple: true, hedgeMs: 1200 }),
  few: async () => ({ loc: 'asia-south1', model: M, few: true }),
  anyall: async () => ({ loc: 'asia-south1', model: M, mode: 'ANYALL' }),
  validated: async () => ({ loc: 'asia-south1', model: M, mode: 'VALIDATED' }),
  gauto: async () => ({ loc: 'global', model: M, mode: 'AUTO' }),
  hedge: async () => ({ loc: 'asia-south1', model: M, hedgeMs: 1200 }),
  hedgeG: async () => ({ loc: 'asia-south1', model: M, hedgeMs: 1200, hedgeLoc: 'global' }),
  ghedge: async () => ({ loc: 'global', model: M, hedgeMs: 1200 }),
  gstream: async () => ({ loc: 'global', model: M, stream: true }),
  gcached: async () => ({ loc: 'global', model: M, cached: await createCache('global', M) }),
}
// loc:<region>: the new request shape at another region
for (const a of args.filter((x) => x.startsWith('loc:'))) VARIANTS[a] = async () => ({ loc: a.slice(4), model: M, simple: true })
// decide@<hedge ms|off>@<hedge location>: the real code path with that hedge
for (const a of args.filter((x) => x.startsWith('decide@'))) VARIANTS[a] = async () => 'decide'
for (const m of (process.env.MODELS ?? '').split(',').filter(Boolean)) {
  VARIANTS[`m:${m}`] = async () => ({ loc: 'asia-south1', model: m, simple: true })
  VARIANTS[`g:${m}`] = async () => ({ loc: 'global', model: m, simple: true })
}

const want = args.filter((a, i) => !a.endsWith('.json') && !a.startsWith('-') && !['--n', '--gap'].includes(args[i - 1]))
const names = want.length ? want : ['base']
const setups: [string, Opts | 'decide'][] = []
for (const v of names) {
  try {
    setups.push([v, await VARIANTS[v.replace(/\+(idle|warm)$/, '')]()])
  } catch (e) {
    console.log(`${v}: setup failed ${String(e).slice(0, 200)}`)
  }
}
// interleaved: every round runs each variant once on the same context (order rotated), so a slow
// spell on Vertex's side hits all variants alike
const results = new Map<string, Awaited<ReturnType<typeof once>>[]>(setups.map(([v]) => [v, []]))
for (let i = 0; i < n; i++) {
  const ctx = ctxs[i % ctxs.length]
  for (let k = 0; k < setups.length; k++) {
    const [v, o] = setups[(i + k) % setups.length]
    let r: Awaited<ReturnType<typeof once>>
    // '<variant>+idle': 4.5 s of silence first, so the pooled keep-alive connection (undici: 4 s) has closed
    if (gap || v.endsWith('+idle')) await new Promise((ok) => setTimeout(ok, gap || 4500))
    // '<variant>+warm': an untimed call to the same host just before, so the connection is open
    if (v.endsWith('+warm') && o !== 'decide') await once({ ...o, hedgeMs: undefined }, ctx)
    if (o === 'decide') {
      const [, ms, loc, primary] = v.split('@')
      process.env.AGENT_HEDGE_MS = ms ?? '0'
      if (primary) process.env.VERTEX_LOCATION = primary
      else delete process.env.VERTEX_LOCATION
      process.env.AGENT_HEDGE_LOCATION = loc ?? ''
      const t0 = performance.now()
      try {
        await decide(ctx, GEMINI_TOOLS)
        r = { ms: performance.now() - t0 }
      } catch (e) {
        r = { ms: performance.now() - t0, err: String(e).slice(0, 60) }
      }
    } else r = await once(o, ctx)
    results.get(v)!.push(r)
    if (args.includes('-v')) console.log(`${new Date().toISOString().slice(11, 19)} ${v} ${r.ms.toFixed(0)}${r.err ? ` ${r.err}` : ''}`)
  }
}
for (const [v, r] of results) stats(v, r)
