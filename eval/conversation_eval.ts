/**
 * Multi-turn conversations through the real Session (fast path + the real agent), scored by what ends
 * up in the khata: the live entries after all turns (amends, voids and moves applied). Cases come
 * from a real production session (22 Nov) plus the follow-ups around it.
 *   npx tsx --env-file=.env eval/conversation_eval.ts [--fake] [--only <substring>]
 * --fake: the test harness's stand-in agent (no model), to see what the code alone does.
 * Needs ANTHROPIC_API_KEY (the agent runs on Claude Haiku alone here; production races Gemini with it).
 */
import { AGENT_SYSTEM, userTurn, type AgentContext } from '../server/agent/agent.js'
import { GEMINI_TOOLS, isToolName } from '../server/agent/tools.js'
import { haikuAgentCall } from '../server/parse/haiku.js'
import { type AgentResult, cust, fakeAgent, harness } from '../server/test-harness.js'
import type { LedgerOp } from '../shared/protocol.js'

type Live = [string, number, 'credit' | 'payment']
type Case = { name: string; turns: string[]; want: Live[]; accounts?: string[]; lang?: 'hi' | 'en' | 'kn' | 'ta' | 'te' }

const C = (name: string, turns: string[], want: Live[], accounts?: string[]): Case => ({ name, turns, want, accounts })
const L = (lang: Case['lang'], name: string, turns: string[], want: Live[]): Case => ({ name: `[${lang}] ${name}`, turns, want, lang })
const CASES: Case[] = [
  // the production session, turn for turn
  C('correct amount right after: "nahi nahi, uska 400 ka khata hai"', ['Ramesh ka 300 ka khata', 'nahi nahi, uska 400 ka khata hai'], [['Ramesh', 400, 'credit']]),
  C('remove by amount: "uska 300 ka khata nikal do"', ['Ramesh ka 300 udhaar', 'uska 300 ka khata nikal do'], []),
  C('direction fix: "nahi, jama karna hai"', ['Ramesh ka 300 add kar do', 'nahi, jama karna hai'], [['Ramesh', 300, 'payment']]),
  C('pronoun payment: "usne 600 rupaye de diye"', ['Ramesh ka 300 udhaar', 'usne 600 rupaye de diye'], [['Ramesh', 300, 'credit'], ['Ramesh', 600, 'payment']]),
  C('misheard pronoun: "usme 600 rupaye de diye hain"', ['Ramesh ka 300 udhaar', 'usme 600 rupaye de diye hain'], [['Ramesh', 300, 'credit'], ['Ramesh', 600, 'payment']]),
  C('move: "उसका नहीं, Ramesh का"', ['Umesh ka 200 udhaar', 'उसका नहीं, Ramesh का', 'haan'], [['Ramesh', 200, 'credit']]),
  // the follow-ups around it
  C('"aur 50"', ['Ramesh ka 300 udhaar', 'aur 50'], [['Ramesh', 300, 'credit'], ['Ramesh', 50, 'credit']]),
  C('"uska bhi 100 jama"', ['Ramesh ka 300 udhaar', 'uska 100 jama bhi karo'], [['Ramesh', 300, 'credit'], ['Ramesh', 100, 'payment']]),
  C('"galti se likha, hata do"', ['Ramesh ka 300 udhaar', 'galti se likha, hata do'], []),
  C('"nahi 30 tha"', ['Ramesh ka 300 udhaar', 'nahi 30 tha'], [['Ramesh', 30, 'credit']]),
  C('"500 nahi 50"', ['Ramesh ka 500 udhaar', 'nahi nahi, 500 nahi 50'], [['Ramesh', 50, 'credit']]),
  C('"nahi, udhaar tha"', ['Ramesh ne 200 diye', 'nahi, udhaar tha'], [['Ramesh', 200, 'credit']]),
  C('"ye Geeta ka tha"', ['Ramesh ka 300 udhaar', 'ye Geeta ka tha', 'haan'], [['Geeta', 300, 'credit']]),
  C('another person: "aur Geeta ka 100"', ['Ramesh ka 300 udhaar', 'aur Geeta ka 100 udhaar'], [['Ramesh', 300, 'credit'], ['Geeta', 100, 'credit']]),
  C('a question writes nothing', ['Ramesh ka 300 udhaar', 'Ramesh ka total kitna hua?'], [['Ramesh', 300, 'credit']]),
  C('new khata: "Mahesh ka 300 ka khata" + haan', ['Mahesh ka 300 ka khata', 'haan'], [['Mahesh', 300, 'credit']], ['Mahesh']),
  C('sound-alike + a bare "haan" never picks Ramesh', ['Rakesh ka 200 udhaar', 'haan'], []),
  C('existing name + "khata kholo" is not written blindly', ['Ramesh 300 ka khata kholo'], []),
  C('"pichla wala hata do" after two entries', ['Ramesh ka 300 udhaar', 'Geeta ka 100 udhaar', 'Ramesh wala hata do'], [['Geeta', 100, 'credit']]),
  // other languages: the same follow-ups, no word lists behind them
  L('en', 'no, make it 400', ['Ramesh 300 credit', 'no no, make it 400'], [['Ramesh', 400, 'credit']]),
  L('en', 'he paid 200', ['Ramesh 300 credit', 'he paid 200'], [['Ramesh', 300, 'credit'], ['Ramesh', 200, 'payment']]),
  L('en', 'remove that one', ['Ramesh 300 credit', 'remove that, it was a mistake'], []),
  L('en', "that was Geeta's", ['Ramesh 300 credit', "that one was Geeta's", 'yes'], [['Geeta', 300, 'credit']]),
  L('kn', 'ಇಲ್ಲ, 400 (no, 400)', ['ರಮೇಶ್ 300 ಸಾಲ', 'ಇಲ್ಲ ಇಲ್ಲ, 400'], [['Ramesh', 400, 'credit']]),
  L('kn', 'ಅವನು 200 ಕೊಟ್ಟ (he gave 200)', ['ರಮೇಶ್ 300 ಸಾಲ', 'ಅವನು 200 ಕೊಟ್ಟ'], [['Ramesh', 300, 'credit'], ['Ramesh', 200, 'payment']]),
  L('kn', 'ಅದನ್ನು ತೆಗೆದುಹಾಕಿ (remove it)', ['ರಮೇಶ್ 300 ಸಾಲ', 'ಅದನ್ನು ತೆಗೆದುಹಾಕಿ'], []),
  L('ta', 'அவர் 200 கொடுத்தார் (he gave 200)', ['ரமேஷ் 300 கடன்', 'அவர் 200 கொடுத்தார்'], [['Ramesh', 300, 'credit'], ['Ramesh', 200, 'payment']]),
  L('ta', 'இல்லை, 400 (no, 400)', ['ரமேஷ் 300 கடன்', 'இல்லை இல்லை, 400'], [['Ramesh', 400, 'credit']]),
  L('te', 'అతను 200 ఇచ్చాడు (he gave 200)', ['రమేష్ 300 అప్పు', 'అతను 200 ఇచ్చాడు'], [['Ramesh', 300, 'credit'], ['Ramesh', 200, 'payment']]),
  // odd contexts
  C('an aside in between, then "uska 50 aur"', ['Ramesh ka 300 udhaar', 'bhaiya do minute ruko, cheeni la raha hoon', 'haan to uska 50 aur likh do'], [['Ramesh', 300, 'credit'], ['Ramesh', 50, 'credit']]),
  C('two people: fix the first one by name', ['Ramesh ka 300 udhaar', 'Geeta ka 100 udhaar', 'Ramesh wala galat tha, 250 tha'], [['Ramesh', 250, 'credit'], ['Geeta', 100, 'credit']]),
  C('a plain new entry right after is not a correction', ['Ramesh ka 300 udhaar', 'Geeta ka 400 udhaar'], [['Ramesh', 300, 'credit'], ['Geeta', 400, 'credit']]),
  C('"nahi" to a question, not to the entry', ['Ramesh ka 300 udhaar', 'Ramesh ka total kitna hai?', 'nahi rehne do'], [['Ramesh', 300, 'credit']]),
]

const people = () => [cust('r', 'Ramesh', 400), cust('u', 'Umesh'), cust('g', 'Geeta', 100)]

function live(ops: LedgerOp[], names: Map<string, string>): Live[] {
  const m = new Map<string, { cid: string; paise: number; dir: 'credit' | 'payment'; void?: boolean; promise?: boolean }>()
  for (const o of ops) {
    if (o.op === 'add_customer') names.set(o.cid, o.name)
    else if (o.op === 'entry') m.set(o.eid, { cid: o.cid, paise: o.paise, dir: o.direction, promise: o.promise })
    else if (o.op === 'amend') {
      const e = m.get(o.eid)
      if (e) { if (o.paise !== undefined) e.paise = o.paise; if (o.direction) e.dir = o.direction; if (o.cid) e.cid = o.cid }
    } else if (o.op === 'void') { const e = m.get(o.eid); if (e) e.void = true }
  }
  return [...m.values()].filter((e) => !e.void && !e.promise).map((e): Live => [names.get(e.cid) ?? e.cid, e.paise / 100, e.dir])
}

const key = (l: Live[]) => JSON.stringify([...l].sort((a, b) => (a.join() < b.join() ? -1 : 1)))

async function main() {
  const fake = process.argv.includes('--fake')
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null
  const lastCalls: string[] = []
  const agent = fake ? undefined : async (ctx: AgentContext): Promise<AgentResult> => {
    const r = await haikuAgentCall(AGENT_SYSTEM, userTurn(ctx), GEMINI_TOOLS, { timeoutMs: 8000 })
    const calls = r.calls.filter((c) => isToolName(c.name)) as AgentResult["calls"]
    lastCalls.push(calls.map((c) => `${c.name}${JSON.stringify(c.args)}`).join(' + '))
    return { calls, ms: r.ms }
  }
  let pass = 0
  let silentWrong = 0
  const cases = CASES.filter((c) => !only || c.name.includes(only))
  for (const c of cases) {
    const h = harness(people(), { lang: c.lang ?? 'hi', ...(agent ? { agent } : { agent: fakeAgent }) })
    const trace: string[] = []
    let before: Live[] = []
    for (const t of c.turns) {
      before = live(h.ops(), new Map([['r', 'Ramesh'], ['u', 'Umesh'], ['g', 'Geeta']]))
      const n = h.agentCalls.length
      lastCalls.length = 0
      await h.turn(t)
      const calls = h.agentCalls.slice(n).length ? ` [agent: ${lastCalls.join(' ; ')}]` : ''
      trace.push(`    > ${t}${calls}\n      ${h.said.join(' | ') || '(silent)'}${h.asks ? `  ?${h.asks}` : ''}`)
    }
    const names = new Map([['r', 'Ramesh'], ['u', 'Umesh'], ['g', 'Geeta']])
    const got = live(h.ops(), names)
    const ok = key(got) === key(c.want) && (!c.accounts || JSON.stringify(h.accounts()) === JSON.stringify(c.accounts))
    // a silent wrong write: an entry for someone or something not wanted, with no question left open
    // (an entry that was already there before the last turn and is just left alone is a miss, not a wrong write)
    const wrong = !ok && !h.asks && got.some((g) => !c.want.some((w) => key([w]) === key([g])) && !before.some((p) => key([p]) === key([g])))
    if (ok) pass++
    if (wrong) silentWrong++
    console.log(`${ok ? 'PASS' : wrong ? 'WRONG' : 'FAIL'}  ${c.name}`)
    if (!ok) console.log(`${trace.join('\n')}\n      got ${key(got)} want ${key(c.want)}`)
  }
  console.log(`\n${pass}/${cases.length} pass, ${silentWrong} silent wrong writes (${fake ? 'stand-in agent' : 'Claude Haiku'})`)
}
void main()
