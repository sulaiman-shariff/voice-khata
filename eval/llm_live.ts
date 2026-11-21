/**
 * Live check of the Haiku slow path: accuracy on hard utterances, latency, cache hits.
 * Usage: npx tsx --env-file=.env eval/llm_live.ts
 */
import { readWithLlm } from '../server/parse/llm.js'
import { CASES, CTX, pct, score } from './llm_cases.js'

let ok = 0
const lat: number[] = []
for (const [text, exp] of CASES) {
  const { reading, ms } = await readWithLlm(text, CTX)
  lat.push(ms)
  const pass = score(text, reading, exp)
  if (pass) ok++
  console.log(`${pass ? 'OK ' : 'BAD'} ${ms.toFixed(0).padStart(5)}ms | ${text}\n      ${JSON.stringify(reading)}`)
}
console.log(`\n${ok}/${CASES.length} correct; p50 ${pct(lat, 0.5).toFixed(0)}ms p90 ${pct(lat, 0.9).toFixed(0)}ms`)
