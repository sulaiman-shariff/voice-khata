/**
 * The AI model on the hard cases (eval/llm_cases.ts), through the app's own call and validation:
 * correct, latency, and SILENT WRONG (a wrong reading that would be written without a read-back).
 *   npx tsx --env-file=.env eval/llm_compare.ts [passes]      (LLM_PROVIDER=gemini|claude)
 */
import { llmModel, readWithLlm, validate, warmUp } from '../server/parse/llm.js'
import { CASES, CTX, pct, score } from './llm_cases.js'

const passes = Number(process.argv[2] ?? 3)
await warmUp()
const ms: number[] = []
let correct = 0, silentWrong = 0, failed = 0, total = 0
for (let p = 0; p < passes; p++)
  for (const [text, exp] of CASES) {
    total++
    try {
      const r = await readWithLlm(text, CTX)
      ms.push(r.ms)
      if (score(text, r.reading, exp)) correct++
      else {
        const i = validate(text, r.reading)
        // written at once = an entry reading with every line high-confidence
        if (i.type === 'entries' && i.entries.every((e) => e.confidence === 'high')) {
          silentWrong++
          console.log(`  SILENT WRONG: "${text}" -> ${JSON.stringify(r.reading).slice(0, 160)}`)
        }
      }
    } catch (e) {
      failed++
      console.log(`  failed: "${text}" ${String(e).slice(0, 100)}`)
    }
  }
console.log(`${llmModel()}: ${correct}/${total} correct, silent wrong ${silentWrong}, failed ${failed}, p50 ${Math.round(pct(ms, 0.5))} ms, p95 ${Math.round(pct(ms, 0.95))} ms`)
