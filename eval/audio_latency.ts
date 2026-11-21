/**
 * Latency of the agent hearing audio (Task 11): 20 addressed lines cut from eval/data/synth, run
 * through decide() with audio on each candidate model. Prints cold (first call) and warm p50/p95
 * and picks the model with warm p95 <= 2500 ms (the fastest p95 wins). Set AGENT_AUDIO_MODEL to it.
 *
 * GOOGLE_VERTEX_KEY="$(base64 -w0 ~/.khatabhai/vertex-sa.json)" VERTEX_PROJECT=<project> LLM_TIMEOUT_MS=15000 \
 *   npx tsx --env-file=.env eval/audio_latency.ts
 */
import { readdirSync, readFileSync } from 'node:fs'
import { decide, type AgentContext } from '../server/agent/agent.js'
import { GEMINI_TOOLS } from '../server/agent/tools.js'

const DIR = 'eval/data/synth'
const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.5-flash']
const BUDGET_MS = 2500
const N = 20
/** what an errored or timed-out call counts as in the stats */
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 15000)

interface Clip { id: string; text: string; lang: string; pcm: Buffer }
const clips: Clip[] = []
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.json')).sort()) {
  const meta = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8')) as { id: string; lines: { text: string; lang: string; addressed: boolean; startMs: number; endMs: number }[] }
  const pcm = readFileSync(`${DIR}/${f.replace(/\.json$/, '.pcm')}`)
  const line = meta.lines.find((l) => l.addressed)
  if (!line) continue
  // 16 kHz mono s16le: 32 bytes per ms
  clips.push({ id: meta.id, text: line.text, lang: line.lang, pcm: pcm.subarray(line.startMs * 32, line.endMs * 32) })
  if (clips.length === N) break
}

const ctxOf = (c: Clip): AgentContext => ({
  lang: 'hi', heard: [{ locale: c.lang, text: c.text }], history: [], screen: 'home',
  customers: ['Ramesh', 'Suresh', 'Meena', 'Mahi'], recent: [], pending: null,
})
const q = (a: number[], p: number) => a[Math.min(a.length - 1, Math.floor(p * a.length))]

const rows: { model: string; cold: number; p50: number; p95: number; errors: number }[] = []
for (const model of MODELS) {
  process.env.AGENT_AUDIO_MODEL = model
  let cold = TIMEOUT_MS
  try { cold = (await decide(ctxOf(clips[0]), GEMINI_TOOLS, clips[0].pcm)).ms } catch (e) { console.log(`${model} warm-up failed: ${String(e).slice(0, 120)}`) }
  const ms: number[] = []
  let errors = 0
  for (const c of clips) {
    try {
      const r = await decide(ctxOf(c), GEMINI_TOOLS, c.pcm)
      ms.push(r.ms)
    } catch (e) {
      errors++
      ms.push(TIMEOUT_MS)
      console.log(`${model} ${c.id}: ${String(e).slice(0, 100)}`)
    }
  }
  ms.sort((a, b) => a - b)
  rows.push({ model, cold, p50: q(ms, 0.5), p95: q(ms, 0.95), errors })
}

console.log(`\n${clips.length} clips, audio ${Math.round(clips.reduce((s, c) => s + c.pcm.length, 0) / clips.length / 32)} ms avg`)
console.log('model'.padEnd(24), 'cold ms', 'warm p50', 'warm p95', 'error rate')
for (const r of rows) console.log(r.model.padEnd(24), String(Math.round(r.cold)).padStart(7), String(Math.round(r.p50)).padStart(8), String(Math.round(r.p95)).padStart(8), `${r.errors}/${clips.length}`.padStart(10))
const ok = rows.filter((r) => r.p95 <= BUDGET_MS && !r.errors).sort((a, b) => a.p95 - b.p95)
console.log(ok.length ? `winner (p95 <= ${BUDGET_MS} ms): ${ok[0].model}` : `no model met p95 <= ${BUDGET_MS} ms; default stays the best p50: ${[...rows].sort((a, b) => a.p50 - b.p50)[0].model}`)
