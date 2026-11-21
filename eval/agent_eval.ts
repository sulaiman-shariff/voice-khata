/**
 * The agent on hard sentences plus control sentences (show / settings / customers), through the app's own
 * call (decide) with the real tool list. Scores: correct tool, and SILENT WRONG = the calls, run through the app's own
 * tools (runTool on a fresh ledger), wrote or changed an entry at once with no question, and that was not what the case wanted.
 *   npx tsx --env-file=.env eval/agent_eval.ts [passes]
 * Needs GOOGLE_VERTEX_KEY + VERTEX_PROJECT.
 */
import { decide, type AgentContext, type ToolCall } from '../server/agent/agent.js'
import { GEMINI_TOOLS, runTool } from '../server/agent/tools.js'
import { LedgerCore } from '../server/ledger/core.js'
import { nullLogger } from '../server/log.js'
import type { SnapCustomer } from '../shared/protocol.js'
import { CASES } from './llm_cases.js'
import { pct } from './llm_cases.js'

type Exp = { tools: string[]; amounts?: number[]; dirs?: (string | null)[]; low?: boolean }
const E = (tools: string[], o: Partial<Exp> = {}): Exp => ({ tools, ...o })

const CTX: AgentContext = {
  lang: 'hi', heard: [], history: [], screen: 'home',
  customers: ['Ramesh', 'Suresh', 'Geeta', 'Sharma ji', 'Sunita', 'Mohan', 'Deepak'],
  recent: ['#1 Ramesh credit 340 today'], pending: null,
}

/** the hard cases of llm_cases.ts, as agent expectations */
const HARD: [string, Exp][] = CASES.map(([text, x]): [string, Exp] => {
  if (x.type === 'entries') return [text, E(['add_entries', ...(x.low ? ['unclear', 'answer_question'] : [])], { amounts: x.amounts, dirs: x.dirs, low: x.low })]
  if (x.type === 'correct') return [text, E(['change_entry', 'move_entry'])]
  if (x.type === 'query') return [text, E(['query_balance', 'show_customer'])]
  if (x.type === 'undo') return [text, E(['undo_last', 'remove_entry'])]
  return [text, E(['not_for_me', 'unclear'])]
})

const CONTROL: [string, Exp][] = [
  ['Ramesh ka khata dikhao', E(['show_customer'])],
  ['Suresh ka hisaab kholo', E(['show_customer'])],
  ['show me Geeta', E(['show_customer'])],
  ['सुनीता का पेज खोलो', E(['show_customer'])],
  ['kis kis ka baaki hai', E(['show_dues', 'query_balance'])],
  ['show everyone who owes me', E(['show_dues', 'query_balance'])],
  ['aaj ka hisaab batao', E(['show_today'])],
  ["today's totals", E(['show_today'])],
  ['Mohan ki history dikhao', E(['show_history'])],
  ['kal ki entries dikhao', E(['show_history'])],
  ['sabse zyada udhaar kiska hai', E(['top_debtors', 'show_dues'])],
  ['top three debtors', E(['top_debtors'])],
  ['search 500', E(['search'])],
  ['ye band karo', E(['close_view'])],
  ['close this', E(['close_view'])],
  ['Ramesh pe kitna baaki hai', E(['query_balance', 'show_customer'])],
  ['how much does Deepak owe', E(['query_balance', 'show_customer'])],
  ['language Hindi karo', E(['set_language'])],
  ['speak in Kannada', E(['set_language'])],
  ['dheere bolo', E(['set_speed'])],
  ['speak faster', E(['set_speed'])],
  ['entry padh kar mat sunao', E(['set_read_back'])],
  ['dukaan ka naam Sharma Kirana rakho', E(['set_shop_name'])],
  ['privacy dikhao, ye AI hai kya', E(['open_privacy'])],
  ['backup banao', E(['backup'])],
  ['naya customer Anil jodo', E(['add_customer'])],
  ['Ramesh ka naam badal kar Ramesh Kumar karo', E(['rename_customer'])],
  ['Suresh ka hisaab clear ho gaya', E(['settle'])],
  ['sab kuch delete kar do', E(['erase_all'])],
  ['Geeta ko reminder bhejo', E(['send_reminder'])],
]

const h = (text: string): AgentContext => ({ ...CTX, heard: [{ locale: 'hi-IN', text }] })
const sameArr = (a: unknown[], b: unknown[]) => JSON.stringify(a) === JSON.stringify(b)
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)

/** Run the calls through the app's own tools on a fresh ledger: how many entries get written with no question asked. */
function runCalls(calls: ToolCall[], text: string): number {
  let n = 0
  const customers: SnapCustomer[] = CTX.customers.map((name, i) => ({
    cid: `c${i}`, name, aliases: [], householdId: null, remindersOptIn: false, adult: false, balancePaise: name === 'Ramesh' ? 34000 : 0, typicalPaise: null,
  }))
  const core = new LedgerCore({ lang: () => 'hi', now: () => Date.now(), newId: () => `id${++n}`, log: nullLogger })
  core.snap.customers = customers
  core.snap.entries = [{ eid: 'e0', cid: 'c0', paise: 34000, direction: 'credit', day: today }]
  core.snap.last = core.snap.entries[0]
  let written = 0
  for (const c of calls) {
    const r = runTool(core, c, { snrDb: null, noisy: false, path: 'llm', transcript: text })
    written += r.ops.filter((o) => o.op === 'entry' || o.op === 'void' || o.op === 'amend').length
  }
  return written
}

function score(calls: ToolCall[], exp: Exp, text: string): { ok: boolean; silent: boolean } {
  const first = calls[0]
  const lines = calls.filter((c) => c.name === 'add_entries').flatMap((c) => (Array.isArray(c.args.entries) ? (c.args.entries as Record<string, unknown>[]) : []))
  const written = runCalls(calls, text)
  let ok = !!first && exp.tools.includes(first.name)
  if (ok && first.name === 'add_entries') {
    if (exp.low) ok = written === 0 // a doubtful sentence must not be written without a question
    else {
      if (exp.amounts) ok = sameArr(lines.map((l) => Number(l.amount)), exp.amounts)
      if (ok && exp.dirs) ok = sameArr(lines.map((l) => l.direction ?? null), exp.dirs)
    }
  }
  // silent wrong: something was written at once and it is not what the case wanted
  const silent = !ok && written > 0
  return { ok, silent }
}

const passes = Number(process.argv[2] ?? 2)
const ms: number[] = []
let correct = 0, silentWrong = 0, failed = 0, total = 0
const wrong: string[] = []
for (let p = 0; p < passes; p++)
  for (const [text, exp] of [...HARD, ...CONTROL]) {
    total++
    try {
      const r = await decide(h(text), GEMINI_TOOLS, undefined, { timeoutMs: 15000 })
      ms.push(r.ms)
      const s = score(r.calls, exp, text)
      if (s.ok) correct++
      else {
        const line = `"${text}" expected ${exp.tools.join('|')} got ${JSON.stringify(r.calls).slice(0, 200)}`
        wrong.push(line)
        if (s.silent) { silentWrong++; console.log(`  SILENT WRONG: ${line}`) }
        else console.log(`  wrong: ${line}`)
      }
    } catch (e) {
      failed++
      console.log(`  failed: "${text}" ${String(e).slice(0, 100)}`)
    }
  }
console.log(`agent (${HARD.length} hard + ${CONTROL.length} control, ${passes} passes): ${correct}/${total} correct, silent wrong ${silentWrong}, failed ${failed}, p50 ${Math.round(pct(ms, 0.5))} ms, p90 ${Math.round(pct(ms, 0.9))} ms`)
process.exit(silentWrong ? 1 : 0)
