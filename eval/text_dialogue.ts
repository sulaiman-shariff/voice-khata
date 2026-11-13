/**
 * Real-model check of conversation context, lists and changing older entries, over the same WebSocket the
 * phone uses, with typed turns (no audio). Uses the real Claude Haiku reading, unlike the unit tests.
 *   npx tsx --env-file=.env eval/text_dialogue.ts [ws-url]
 */
import WebSocket from 'ws'
import type { LedgerOp, ServerMsg, SnapCustomer, SnapEntry, Snapshot } from '../shared/protocol.js'

const url = process.argv[2] ?? 'ws://localhost:8787'
const ist = (n: number) => new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10)
const cust = (cid: string, name: string, rs: number): SnapCustomer =>
  ({ cid, name, aliases: [], householdId: null, remindersOptIn: false, adult: false, balancePaise: rs * 100, typicalPaise: null })
const ent = (eid: string, cid: string, rs: number, direction: 'credit' | 'payment', day: string): SnapEntry =>
  ({ eid, cid, paise: rs * 100, direction, day })

interface Step { say: string; expect: (ops: LedgerOp[], said: string, pending: unknown) => boolean; label: string }

function snapshot(): Snapshot {
  const recent = [ent('e3', 'g', 150, 'credit', ist(0)), ent('e2', 's', 200, 'payment', ist(0)), ent('e1', 'r', 340, 'credit', ist(-1))]
  return {
    shopName: 'Sharma Kirana', customers: [cust('r', 'Ramesh', 340), cust('s', 'Suresh', -200), cust('g', 'Geeta', 150)],
    last: recent[0], recent,
    today: { creditPaise: 15000, paymentPaise: 20000, entries: 2 }, month: { creditPaise: 49000, paymentPaise: 20000, entries: 3 },
  }
}

const isAmend = (o: LedgerOp, eid: string, f: Record<string, unknown>) => o.op === 'amend' && o.eid === eid && Object.entries(f).every(([k, v]) => (o as any)[k] === v)
const STEPS: Step[] = [
  { label: 'change yesterday\'s entry: asks first', say: 'Ramesh ka kal wala 340 asal mein 430 tha', expect: (o, _s, p: any) => o.length === 0 && p?.kind === 'modify' },
  { label: '...yes applies it to the right entry', say: 'haan', expect: (o) => o.length === 1 && isAmend(o[0], 'e1', { paise: 43000 }) },
  { label: 'remove an older entry by name: asks', say: 'Suresh wali entry hata do', expect: (o, _s, p: any) => o.length === 0 && p?.kind === 'modify' && p.remove },
  { label: '...yes removes Suresh\'s, not the last', say: 'haan', expect: (o) => o.length === 1 && o[0].op === 'void' && o[0].eid === 'e2' },
  { label: 'new entry', say: 'Geeta ka 200 udhaar', expect: (o) => o.some((x) => x.op === 'entry' && x.cid === 'g' && x.paise === 20000 && x.direction === 'credit') },
  { label: '"same for Suresh" copies amount and direction', say: 'Suresh ka bhi same likh do', expect: (o, _s, p: any) => o.some((x) => x.op === 'entry' && x.cid === 's' && x.paise === 20000 && x.direction === 'credit') || p?.kind === 'confirm' },
  { label: '"usko 50 aur udhaar" goes to the same person', say: 'usko 50 aur udhaar', expect: (o) => o.some((x) => x.op === 'entry' && x.cid === 's' && x.paise === 5000 && x.direction === 'credit') },
  { label: '"uska total?" answers for that person', say: 'uska total kitna hua', expect: (_o, s) => /सुरेश|Suresh/.test(s) },
  { label: 'list with one closing word: one question', say: 'Ramesh 200, Suresh 300, Geeta 150 udhaar', expect: (o, _s, p: any) => o.length === 0 && p?.kind === 'batch' },
  { label: '...yes saves all three as credit', say: 'haan', expect: (o) => o.filter((x) => x.op === 'entry' && x.direction === 'credit').length === 3 },
  { label: 'English change of an older entry', say: "change Geeta's 150 to 250", expect: (o, _s, p: any) => (p?.kind === 'modify' && o.length === 0) || o.some((x) => x.op === 'amend' && x.paise === 25000) },
  { label: '...yes', say: 'yes', expect: (o) => o.every((x) => x.op === 'amend') },
  { label: 'self-correction in one breath, new customer named', say: 'Ramesh ko 500 nahi 300 udhaar', expect: (o) => o.some((x) => x.op === 'entry' && x.cid === 'r' && x.paise === 30000) && !o.some((x) => x.op === 'amend') },
]

const ws = new WebSocket(url)
const inbox: ServerMsg[] = []
let wake: (() => void) | null = null
ws.on('message', (d, bin) => {
  if (bin) return
  inbox.push(JSON.parse(d.toString()))
  wake?.()
})
const until = async (pred: (m: ServerMsg) => boolean, ms = 15000) => {
  const t0 = Date.now()
  for (;;) {
    const i = inbox.findIndex(pred)
    if (i >= 0) return inbox.splice(0, i + 1)
    if (Date.now() - t0 > ms) throw new Error('timeout')
    await new Promise<void>((r) => { wake = r; setTimeout(r, 200) })
  }
}

ws.on('open', async () => {
  await until((m) => m.type === 'ready')
  ws.send(JSON.stringify({ type: 'hello', lang: 'hi', snapshot: snapshot(), firstRun: false, ptt: false }))
  let pass = 0
  for (const s of STEPS) {
    ws.send(JSON.stringify({ type: 'text', text: s.say }))
    const t0 = Date.now()
    const msgs = await until((m) => m.type === 'turn_done')
    const ops = msgs.flatMap((m) => (m.type === 'ops' ? m.ops : []))
    const said = msgs.filter((m) => m.type === 'say').map((m: any) => m.text).join(' ')
    const pending = msgs.filter((m) => m.type === 'pending').at(-1) as any
    const ok = s.expect(ops, said, pending?.pending ?? null)
    if (ok) pass++
    ws.send(JSON.stringify({ type: 'playback_done' }))
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${s.label}\n      you: ${s.say}\n      agent: ${said || '(silent)'}  [${Date.now() - t0} ms]` +
      `\n      ops: ${JSON.stringify(ops.map((o: any) => ({ op: o.op, eid: o.eid?.slice(0, 6), cid: o.cid, paise: o.paise, direction: o.direction })))}`)
  }
  console.log(`\n${pass}/${STEPS.length} passed`)
  ws.close()
  process.exit(pass === STEPS.length ? 0 : 1)
})
