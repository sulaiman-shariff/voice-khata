/**
 * Replay real conversations (from production logs) through the Session and score the outcome.
 * No audio, no network: the model's answers are the ones logged for the same text.
 *
 *   npx tsx eval/replay.ts [eval/corpus/prod.json] [--label name] [-v]
 *
 * Scores, summed over sessions:
 *   wrong     entries written that the shopkeeper did not mean (worst)
 *   junk      accounts opened under a name that is not a real customer (worst)
 *   missed    entries the shopkeeper meant that were not written
 *   silent    turns with a name or an amount in them that got no reply, question or entry
 *   questions questions asked
 * A read-back the logged user never answered (often one the old code never asked, like "new
 * customer X?") is answered from the labels: yes only for an entry they meant. Counted as `oracle`.
 */
import fs from 'node:fs'
import { mentionsMoney } from '../shared/intent.js'
import type { LedgerOp, PendingView, ServerMsg, SnapCustomer, Snapshot } from '../shared/protocol.js'
import type { LlmReading } from '../server/parse/llm.js'
import { Session } from '../server/session.js'

type Step = { say: string } | { tap: 'yes' | 'no' | 'undo' } | { answer: string } | { type: string }
type Line = [string, number, 'credit' | 'payment']
interface Conv {
  sid: string; lang: string; steps: Step[]; llm: Record<string, Partial<LlmReading>>
  customers: string[]; saves: Line[]; allow: Line[]; names: Record<string, string[]>
}

const args = process.argv.slice(2)
const file = args.find((a) => a.endsWith('.json')) ?? 'eval/corpus/prod.json'
const label = args.includes('--label') ? args[args.indexOf('--label') + 1] : null
const verbose = args.includes('-v')
const only = args.includes('--sid') ? args[args.indexOf('--sid') + 1] : null
const convs: Conv[] = JSON.parse(fs.readFileSync(file, 'utf8'))

const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, '').trim()
const cust = (cid: string, name: string): SnapCustomer =>
  ({ cid, name, aliases: [], householdId: null, remindersOptIn: false, adult: false, balancePaise: 0, typicalPaise: null })

interface Score { wrong: number; junk: number; missed: number; silent: number; questions: number; oracle: number; llmMissing: number }
const zero = (): Score => ({ wrong: 0, junk: 0, missed: 0, silent: 0, questions: 0, oracle: 0, llmMissing: 0 })

async function run(c: Conv): Promise<{ score: Score; notes: string[] }> {
  const score = zero()
  const notes: string[] = []
  const out: ServerMsg[] = []
  const customers = c.customers.map((n, i) => cust(`c${i}`, n))
  let clock = 1_000_000
  let ids = 0
  const canon = (name: string): string | null => {
    const n = norm(name)
    for (const [k, vs] of Object.entries(c.names)) if (vs.some((v) => norm(v) === n || n.split(' ').includes(norm(v)))) return k
    return null
  }
  const snapshot = (): Snapshot => ({
    shopName: 'Shop', customers: [...customers], last: null,
    today: { creditPaise: 0, paymentPaise: 0, entries: 0 }, month: { creditPaise: 0, paymentPaise: 0, entries: 0 },
  })
  const s = new Session({
    openStt: () => ({ send: () => {}, commit: () => {}, setKeyterms: () => {}, close: () => {} }),
    speak: async (_t, _l, onAudio) => {
      onAudio(Buffer.alloc(3200))
      return { firstAudioMs: 1, bytes: 3200 }
    },
    llm: async (text) => {
      const r = c.llm[text]
      if (r) return r
      score.llmMissing++
      return { intent: 'unclear', sure: false }
    },
    send: (m) => out.push(m),
    sendAudio: () => {},
    now: () => clock,
    newId: () => `n${++ids}`,
  })
  s.onClient({ type: 'hello', lang: c.lang as never, snapshot: snapshot(), firstRun: false, ptt: false })
  await s.idle()

  const written: { name: string | null; rs: number; dir: string }[] = []
  let pending: PendingView | null = null
  const absorb = (from: number) => {
    let reacted = false
    for (const m of out.slice(from)) {
      if (m.type === 'say') reacted = true
      if (m.type === 'pending') {
        if (m.pending && JSON.stringify(m.pending) !== JSON.stringify(pending)) score.questions++
        if (m.pending) reacted = true
        pending = m.pending
      }
      if (m.type === 'ops') {
        reacted = true
        applyOps(m.ops)
        if (m.seq) s.onClient({ type: 'ack', seq: m.seq })
      }
    }
    return reacted
  }
  const applyOps = (ops: LedgerOp[]) => {
    let changed = false
    for (const o of ops) {
      if (o.op === 'add_customer') {
        customers.push(cust(o.cid, o.name))
        changed = true
        if (!canon(o.name)) {
          score.junk++
          notes.push(`junk account "${o.name}"`)
        }
      }
      if (o.op === 'entry') {
        const name = customers.find((x) => x.cid === o.cid)?.name ?? null
        written.push({ name: name && (canon(name) ?? name), rs: o.paise / 100, dir: o.direction })
      }
    }
    if (changed) s.onClient({ type: 'snapshot', snapshot: snapshot() })
  }
  const send = async (step: Step) => {
    clock += 3000
    const from = out.length
    if ('say' in step) await s.handleText(step.say, { speechEnd: clock, commitAt: null, finalAt: clock, early: false, snrDb: 25, noisy: false, pcm: Buffer.alloc(3200) }, 'voice')
    else if ('tap' in step) s.onClient({ type: 'tap', action: step.tap })
    else if ('answer' in step) s.onClient({ type: 'answer', text: step.answer })
    else s.onClient({ type: 'text', text: step.type })
    await s.idle()
    return absorb(from)
  }

  for (let i = 0; i < c.steps.length; i++) {
    const step = c.steps[i]
    const before = out.length
    const reacted = await send(step)
    if (only) console.log(`  > ${JSON.stringify(step)}
      ${out.slice(before).filter((m) => m.type === 'say' || m.type === 'ops').map((m) => (m.type === 'say' ? m.text : JSON.stringify(m.ops))).join(' / ') || '(nothing)'}`)
    if ('say' in step && !reacted) {
      const named = Object.values(c.names).flat().some((v) => norm(step.say).includes(norm(v)))
      if ((named && step.say.trim().split(/\s+/).length <= 4) || mentionsMoney(step.say)) {
        score.silent++
        notes.push(`silent: "${step.say}"`)
      }
    }
    // a question about a new account that the logged user never saw: answer it from the labels
    const next = c.steps[i + 1]
    for (let k = 0; k < 5; k++) {
      const p = pending as PendingView | null
      if (p?.kind !== 'confirm' || (next && ('tap' in next || 'answer' in next || ('say' in next && /^(yes|haan|ha|ಹೌದು|ಸರಿ|no|nahi|ಇಲ್ಲ)/i.test(next.say))))) break
      // a read-back the logged user never got to answer: yes only for an entry they meant
      const who = p.name ? canon(p.name) : null
      const meant = [...c.saves, ...c.allow].some(([n, rs, d]) => n === who && rs * 100 === p.paise && d === p.direction)
      score.oracle++
      await send({ tap: meant ? 'yes' : 'no' })
    }
  }

  // score what was written against what was meant
  const want = c.saves.map(([n, rs, d]) => ({ n, rs, d, hit: false }))
  const ok = c.allow.map(([n, rs, d]) => ({ n, rs, d, hit: false }))
  for (const w of written) {
    const m = want.find((x) => !x.hit && x.n === w.name && x.rs === w.rs && x.d === w.dir) ?? ok.find((x) => !x.hit && x.n === w.name && x.rs === w.rs && x.d === w.dir)
    if (m) m.hit = true
    else {
      score.wrong++
      notes.push(`wrong: ${w.name} ₹${w.rs} ${w.dir}`)
    }
  }
  for (const x of want.filter((x) => !x.hit)) {
    score.missed++
    notes.push(`missed: ${x.n} ₹${x.rs} ${x.d}`)
  }
  s.close?.()
  return { score, notes }
}

const total = zero()
const rows: { sid: string; score: Score; notes: string[] }[] = []
for (const c of convs.filter((x) => !only || x.sid === only)) {
  const r = await run(c)
  rows.push({ sid: c.sid, ...r })
  for (const k of Object.keys(total) as (keyof Score)[]) total[k] += r.score[k]
  if (verbose || r.notes.length) console.log(`${c.sid} [${c.lang}] ${r.notes.join(' | ') || 'ok'}`)
}
const meant = convs.reduce((n, c) => n + c.saves.length, 0)
console.log(`\n${convs.length} conversations, ${convs.reduce((n, c) => n + c.steps.length, 0)} steps, ${meant} entries meant`)
console.log(`wrong ${total.wrong} | junk accounts ${total.junk} | missed ${total.missed} | silent ${total.silent} | questions ${total.questions} | oracle answers ${total.oracle} | model readings not in log ${total.llmMissing}`)
if (label) {
  fs.mkdirSync('eval/results', { recursive: true })
  fs.writeFileSync(`eval/results/replay_${label}.json`, JSON.stringify({ file, total, rows }, null, 1))
}
