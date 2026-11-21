/**
 * Where a turn's time goes, from a voice server log: the structured `"ev":"turn"` lines of
 * server/log.ts (local: the server's stdout; Vercel: `vercel logs <url> --json`).
 *   node --env-file=.env --import tsx eval/local_server.ts > server.log
 *   npx tsx eval/e2e_suite.ts ws://localhost:8787 ...
 *   npx tsx eval/latency_breakdown.ts server.log [other.log ...]
 * All times are ms after the end of speech (server-side energy detector).
 */
import { readFileSync } from 'node:fs'
import type { TurnMetrics } from '../shared/protocol.js'

type Row = TurnMetrics & { text: string }

const pct = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(xs.length * p))]
function line(label: string, vals: (number | null | undefined)[]) {
  const xs = vals.filter((x): x is number => typeof x === 'number').sort((a, b) => a - b)
  if (!xs.length) return console.log(`  ${label.padEnd(30)} -`)
  console.log(`  ${label.padEnd(30)} p50 ${String(Math.round(pct(xs, 0.5))).padStart(5)}   p90 ${String(Math.round(pct(xs, 0.9))).padStart(5)}   n=${xs.length}`)
}

for (const file of process.argv.slice(2)) {
  const rows: Row[] = []
  for (const l of readFileSync(file, 'utf8').split('\n')) {
    const i = l.indexOf('{')
    if (i < 0) continue
    try {
      let o = JSON.parse(l.slice(i))
      // `vercel logs --json` wraps each line: the logger's JSON is in `message`
      if (typeof o.message === 'string' && o.message.startsWith('{')) o = JSON.parse(o.message)
      if (o.ev === 'turn' && typeof o.finalAt === 'number') rows.push(o)
    } catch { /* not a log line */ }
  }
  console.log(`\n${file}: ${rows.length} turns`)
  if (!rows.length) continue
  line('"heard" cue', rows.map((r) => r.heardAt))
  line('final transcript', rows.map((r) => r.finalAt))
  line('first reply audio sent', rows.map((r) => r.firstAudioAt))
  line('final -> first audio', rows.map((r) => (r.firstAudioAt == null ? null : r.firstAudioAt - r.finalAt)))
  line('reply audio length', rows.map((r) => (r.replyAudioMs ? r.replyAudioMs : null)))
  line('done talking (first + length)', rows.map((r) => (r.firstAudioAt == null || !r.replyAudioMs ? null : r.firstAudioAt + r.replyAudioMs)))
  line('LLM (when used)', rows.map((r) => (r.path === 'llm' ? r.llmMs : null)))
  const n = (f: (r: Row) => boolean) => rows.filter(f).length
  console.log(`  heard cue on ${n((r) => r.heardAt != null)}/${rows.length} turns, cached reply ${n((r) => !!r.cached)}, early commit ${n((r) => r.earlyCommit)}, LLM ${n((r) => r.path === 'llm')}`)
}
