import { describe, expect, it } from 'vitest'
import { parseFast } from '../../shared/intent.js'
import type { SnapCustomer, SnapEntry } from '../../shared/protocol.js'
import { say, sayMore } from '../../shared/replies.js'
import { LedgerCore, PENDING_TTL_MS, type TurnMeta } from '../ledger/core.js'
import { nullLogger } from '../log.js'
import { TOOL_SCHEMAS, type ToolCall, runTool } from './tools.js'

const R = say('en')
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)

const cust = (cid: string, name: string, balanceRs = 0, over: Partial<SnapCustomer> = {}): SnapCustomer => ({
  cid, name, aliases: [], householdId: null, remindersOptIn: false, adult: false, balancePaise: balanceRs * 100, typicalPaise: null, ...over,
})
const ent = (eid: string, cid: string, rupees: number, direction: 'credit' | 'payment' = 'credit'): SnapEntry => ({
  eid, cid, paise: rupees * 100, direction, day: today,
})

function setup(customers: SnapCustomer[], entries: SnapEntry[] = []) {
  let n = 0
  let now = 1_000_000
  const core = new LedgerCore({ lang: () => 'en', now: () => now, newId: () => `id${++n}`, log: nullLogger })
  core.snap.customers = customers
  core.snap.entries = entries
  core.snap.last = entries[0] ?? null
  const meta = (transcript: string): TurnMeta & { transcript: string } => ({ snrDb: null, noisy: false, path: 'llm', transcript })
  const run = (name: ToolCall['name'], args: Record<string, unknown>, transcript: string) => runTool(core, { name, args }, meta(transcript))
  return { core, run, meta, tick: (ms: number) => { now += ms } }
}

describe('agent tools', () => {
  it('every tool has a schema', () => {
    const names = TOOL_SCHEMAS.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toContain('add_entries')
    expect(names).toContain('unclear')
    expect(names.length).toBe(30)
  })

  it('add_entries for a known customer with a spoken credit word writes at once and says the new balance', () => {
    const { run } = setup([cust('c1', 'Ramesh', 300)])
    const r = run('add_entries', { entries: [{ name: 'Ramesh', amount: 200, direction: 'credit' }] }, 'Ramesh ko 200 udhaar')
    expect(r.ops).toHaveLength(1)
    expect(r.ops[0]).toMatchObject({ op: 'entry', cid: 'c1', paise: 20000, direction: 'credit' })
    expect((r.ops[0] as { source: { path: string } }).source.path).toBe('llm')
    expect(r.parts.join(' ')).toContain('500')
    expect(r.parts.join(' ')).toBe(R.savedWithBalance('Ramesh', 200, 'credit', 500))
  })

  it('add_entries with a direction the sentence never said is read back', () => {
    const { core, run } = setup([cust('c1', 'Ramesh', 300)])
    const r = run('add_entries', { entries: [{ name: 'Ramesh', amount: 200, direction: 'credit' }] }, 'Ramesh 200')
    expect(r.ops).toEqual([])
    expect(core.pending?.kind).toBe('confirm')
  })

  it('add_entries with an amount the sentence never had is refused', () => {
    const { core, run } = setup([cust('c1', 'Ramesh', 300)])
    const r = run('add_entries', { entries: [{ name: 'Ramesh', amount: 500, direction: 'credit' }] }, 'Ramesh ko 200 udhaar')
    expect(r.ops).toEqual([])
    expect(core.pending).toBeNull()
    expect(r.parts).toEqual([R.didNotCatch()])
  })

  it('two customers named Suresh: any write asks which one', () => {
    const { core, run } = setup([cust('c1', 'Suresh', 300), cust('c2', 'Suresh', 1200)])
    const r = run('add_entries', { entries: [{ name: 'Suresh', amount: 100, direction: 'credit' }] }, 'Suresh ko 100 udhaar')
    expect(r.ops).toEqual([])
    expect(core.pending?.kind).toBe('which')
    expect(core.pendingView()?.options).toEqual(['Suresh · ₹300', 'Suresh · ₹1,200'])
  })

  it('remove_entry, move_entry, merge_customers, settle always ask first', () => {
    const mk = () => setup([cust('c1', 'Ramesh', 200), cust('c2', 'Suresh', 50)], [ent('e1', 'c1', 200)])
    let s = mk()
    let r = s.run('remove_entry', { ref: 1 }, 'Ramesh wali entry hata do')
    expect(r.ops).toEqual([])
    expect(s.core.pending?.kind).toBe('modify')
    s = mk()
    r = s.run('move_entry', { ref: 1, to_name: 'Suresh' }, 'Ramesh ka 200 Suresh ke naam karo')
    expect(r.ops).toEqual([])
    expect(s.core.pending?.kind).toBe('modify')
    s = mk()
    r = s.run('merge_customers', { name: 'Suresh', into: 'Ramesh' }, 'Suresh aur Ramesh ek hi hain')
    expect(r.ops).toEqual([])
    expect(s.core.pending?.kind).toBe('modify')
    expect(r.parts).toEqual([R.mergeAsk('Suresh', 'Ramesh')])
    s = mk() // an entry this session did not write, so even "hata do" asks
    r = s.run('undo_last', {}, 'hata do')
    expect(r.ops).toEqual([])
    expect(s.core.pending?.kind).toBe('modify')
    s = mk()
    r = s.run('settle', { name: 'Ramesh' }, 'Ramesh ka hisaab clear')
    expect(r.ops).toEqual([])
    expect(s.core.pending?.kind).toBe('confirm')
    // and a yes then writes it
    const y = s.core.answerPending('haan', parseFast('haan'), s.meta('haan'))!
    expect(y.ops[0]).toMatchObject({ op: 'entry', cid: 'c1', paise: 20000, direction: 'payment' })
  })

  it('merge_customers after a yes merges the accounts', () => {
    const { core, run, meta } = setup([cust('c1', 'Ramesh', 200), cust('c2', 'Suresh', 50)])
    run('merge_customers', { name: 'Suresh', into: 'Ramesh' }, 'Suresh aur Ramesh ek hi hain')
    const y = core.answerPending('haan', parseFast('haan'), meta('haan'))!
    expect(y.ops).toEqual([{ op: 'merge_customers', from: 'c2', into: 'c1' }])
    for (const o of y.ops) core.applyLocal(o)
    expect(core.snap.customers.map((c) => [c.name, c.balancePaise])).toEqual([['Ramesh', 25000]])
  })

  it('erase_all needs a spoken yes and then a tap', () => {
    const { core, run, meta } = setup([cust('c1', 'Ramesh', 200)])
    const r = run('erase_all', {}, 'sab data mita do')
    expect(r.ops).toEqual([])
    expect(core.pending?.kind).toBe('delete')
    expect(core.pendingView()?.requireTap).toBe(true)
    core.turnSrc = 'voice'
    const v = core.answerPending('haan', parseFast('haan'), meta('haan'))!
    expect(v.ops).toEqual([])
    expect(v.parts).toEqual([R.eraseTap()])
    expect(core.pending?.kind).toBe('delete')
    core.turnSrc = 'tap'
    const t = core.answerPending('yes', { type: 'yes' }, meta('yes'))!
    expect(t.ops).toEqual([{ op: 'delete_all' }])
  })

  it('erase_all: a tap alone, before the spoken yes, erases nothing', () => {
    const { core, run, meta } = setup([cust('c1', 'Ramesh', 200)])
    run('erase_all', {}, 'sab data mita do')
    core.turnSrc = 'tap'
    const t = core.answerPending('yes', { type: 'yes' }, meta('yes'))!
    expect(t.ops).toEqual([])
    expect(core.pending?.kind).toBe('delete')
  })

  it('send_reminder to a customer without consent is refused with a spoken reason', () => {
    const { core, run } = setup([cust('c1', 'Ramesh', 200)])
    const r = run('send_reminder', { name: 'Ramesh' }, 'Ramesh ko reminder bhejo')
    expect(r.ops).toEqual([])
    expect(r.ready).toBeUndefined()
    expect(r.parts).toEqual([R.noConsent('Ramesh')])
    expect(core.pending).toBeNull()
  })

  it('send_reminder with consent is asked first, then made ready on a yes', () => {
    const { core, run, meta } = setup([cust('c1', 'Ramesh', 200, { remindersOptIn: true, adult: true })])
    const r = run('send_reminder', { name: 'Ramesh' }, 'Ramesh ko reminder bhejo')
    expect(r.ready).toBeUndefined()
    expect(core.pending?.kind).toBe('modify')
    const y = core.answerPending('haan', parseFast('haan'), meta('haan'))!
    expect(y.ready).toMatchObject({ kind: 'whatsapp', cid: 'c1' })
    expect(y.ready?.text).toContain('200')
  })

  it('show_customer returns a show message and a spoken balance', () => {
    const { core, run } = setup([cust('c1', 'Ramesh', 200)], [ent('e1', 'c1', 200)])
    const r = run('show_customer', { name: 'Ramesh' }, 'Ramesh ka khata dikhao')
    expect(r.show).toEqual({ type: 'show', view: 'customer', cid: 'c1' })
    expect(r.parts).toEqual([R.showCustomer('Ramesh', 200, { amt: 200, dir: 'credit' })])
    expect(core.focusCid).toBe('c1')
  })

  it('not_for_me returns notForMe and no speech', () => {
    const { run } = setup([cust('c1', 'Ramesh', 200)])
    const r = run('not_for_me', {}, 'aap kaise ho bhai')
    expect(r.notForMe).toBe(true)
    expect(r.parts).toEqual([])
    expect(r.ops).toEqual([])
  })

  it('rename_customer needs a sure match; set_phone needs the heard digits and is read back first', () => {
    const { core, run, meta } = setup([cust('c1', 'Ramesh', 200)])
    const a = run('rename_customer', { name: 'Ramesh', new_name: 'Ramesh Kumar' }, 'Ramesh ka naam Ramesh Kumar karo')
    expect(a.ops).toEqual([{ op: 'rename_customer', cid: 'c1', name: 'Ramesh Kumar' }])
    for (const o of a.ops) core.applyLocal(o)
    const near = run('rename_customer', { name: 'Rajesh', new_name: 'Suresh' }, 'Rajesh ka naam Suresh karo')
    expect(near.ops).toEqual([])
    core.pending = null
    const b = run('set_phone', { name: 'Ramesh Kumar', phone: '98450 12345' }, 'Ramesh ka number 98450 12345')
    expect(b.ops).toEqual([])
    expect(core.pending?.kind).toBe('modify')
    expect(b.parts).toEqual([sayMore('en').phoneAsk('Ramesh Kumar', '98450 12345')])
    const y = core.answerPending('haan', parseFast('haan'), meta('haan'))!
    expect(y.ops).toEqual([{ op: 'set_phone', cid: 'c1', phone: '9845012345' }])
    // digits the model wrote but nobody said
    const invented = run('set_phone', { name: 'Ramesh Kumar', phone: '9845012345' }, 'Ramesh ka number likho')
    expect(invented.ops).toEqual([])
    expect(core.pending).toBeNull()
    expect(run('set_phone', { name: 'Ramesh Kumar', phone: '123' }, 'Ramesh ka number 123').ops).toEqual([])
  })

  it('add_customer: a new heard name is asked first, a near name asks which', () => {
    const { core, run, meta } = setup([cust('c1', 'Ramesh', 200)])
    const r = run('add_customer', { name: 'pinky' }, 'Pinky naam ka naya khata kholo')
    expect(r.ops).toEqual([])
    expect(core.pendingView()).toMatchObject({ kind: 'modify', name: 'Pinky', newCustomer: true })
    core.turnSrc = 'tap'
    const y = core.answerPending('yes', { type: 'yes' }, meta('yes'))!
    expect(y.ops).toEqual([{ op: 'add_customer', cid: 'id1', name: 'Pinky' }])
    core.turnSrc = 'voice'
    const n = run('add_customer', { name: 'Ramesha' }, 'Ramesha ka khata kholo')
    expect(n.ops).toEqual([])
    expect(core.pending?.kind).toBe('choose')
    expect(core.pendingView()?.options).toEqual(['Ramesh', 'Ramesha'])
    // choosing the existing one writes nothing
    const pick = core.answerPending('Ramesh', parseFast('Ramesh'), meta('Ramesh'))!
    expect(pick.ops).toEqual([])
    expect(core.pending).toBeNull()
  })

  it('two customers with one name, for any other tool: all are offered and the answer finishes the tool', () => {
    const { core, run, meta } = setup([cust('c1', 'Suresh', 300), cust('c2', 'Suresh', 1200), cust('c3', 'Suresh', 50)])
    const r = run('show_customer', { name: 'Suresh' }, 'Suresh ka khata dikhao')
    expect(r.show).toBeUndefined()
    expect(core.pendingView()?.options).toEqual(['Suresh · ₹300', 'Suresh · ₹1,200', 'Suresh · ₹50'])
    const a = core.answerPending('doosra wala', parseFast('doosra wala'), meta('doosra wala'))!
    expect(a.show).toEqual({ type: 'show', view: 'customer', cid: 'c2' })
    // a tapped label works the same, and the original sentence is kept for the finished call
    run('send_statement', { name: 'Suresh' }, 'Suresh ko statement bhejo')
    core.turnSrc = 'tap'
    const t = core.answerPending('Suresh · ₹50', { type: 'unknown' }, meta('Suresh · ₹50'))!
    expect(t.parts).toEqual([R.noConsent('Suresh')])
  })

  it('answer_question never takes yes, an option or an amount from the model', () => {
    // yes from the model, "hmm" heard: nothing written, asked again
    let s = setup([cust('c1', 'Ramesh', 300)])
    s.run('add_entries', { entries: [{ name: 'Ramesh', amount: 200, direction: 'credit' }] }, 'Ramesh 200')
    let r = s.run('answer_question', { kind: 'yes' }, 'hmm')
    expect(r.ops).toEqual([])
    expect(r.parts).toEqual([R.didNotCatch()])
    expect(s.core.pending?.kind).toBe('confirm')
    // an option that is not on screen
    s = setup([cust('c1', 'Suresh', 300), cust('c2', 'Suresh', 1200)])
    s.run('add_entries', { entries: [{ name: 'Suresh', amount: 100, direction: 'credit' }] }, 'Suresh ko 100 udhaar')
    r = s.run('answer_question', { kind: 'option', value: 'haan' }, 'haan')
    expect(r.ops).toEqual([])
    expect(s.core.pending?.kind).toBe('which')
    // a "name" that is an amount, for the amount question
    s = setup([cust('c1', 'Ramesh', 300)])
    s.core.processDrafts([{
      heardName: 'Ramesh', cid: null, newName: null, nameSure: false, spoken: true, paise: 0, alt: null, direction: 'credit', dayOffset: 0,
      promise: false, confidence: 'low', reasons: ['no-amount'], path: 'llm', transcript: 'Ramesh udhaar', snrDb: null, noisy: false,
    }])
    expect(s.core.pending?.kind).toBe('amount')
    r = s.run('answer_question', { kind: 'name', value: '500' }, 'Ramesh')
    expect(r.ops).toEqual([])
    expect(s.core.pending?.kind).toBe('amount')
  })

  it('answer_question with nothing open says it did not catch that', () => {
    const { run } = setup([cust('c1', 'Ramesh', 300)])
    expect(run('answer_question', { kind: 'yes' }, 'haan').parts).toEqual([R.didNotCatch()])
  })

  it('undo_last is instant only right after this session wrote the entry', () => {
    const { core, run, tick } = setup([cust('c1', 'Ramesh', 300)])
    const w = run('add_entries', { entries: [{ name: 'Ramesh', amount: 200, direction: 'credit' }] }, 'Ramesh ko 200 udhaar')
    for (const o of w.ops) core.applyLocal(o)
    const eid = (w.ops[0] as { eid: string }).eid
    const u = run('undo_last', {}, 'hata do')
    expect(u.ops).toEqual([{ op: 'void', eid, reason: 'spoken undo' }])
    tick(61_000)
    const late = run('undo_last', {}, 'hata do')
    expect(late.ops).toEqual([])
    expect(core.pending?.kind).toBe('modify')
  })

  it('search counts each result once; topDebtors with nobody is a full sentence', () => {
    const { run } = setup([cust('c1', 'Ramesh', 200), cust('c2', 'Suresh', 200)], [ent('e1', 'c1', 200), ent('e2', 'c2', 200)])
    expect(run('search', { text: 'Ramesh 200' }, 'Ramesh 200 dhundo').parts).toEqual([R.searchResult('Ramesh 200', 1)])
    expect(run('search', { text: '200' }, '200 dhundo').parts).toEqual([R.searchResult('200', 2)])
    expect(R.topDebtors([])).toBe(R.noDues())
  })

  it('settings produce a setting message, the language reply is in the new language', () => {
    const { run } = setup([])
    const r = run('set_language', { lang: 'kn' }, 'Kannada mein bolo')
    expect(r.setting).toEqual({ type: 'setting', key: 'lang', value: 'kn' })
    expect(r.parts).toEqual([say('kn').languageSet('ಕನ್ನಡ')])
    expect(run('set_read_back', { on: true }, 'padh ke sunao').setting).toEqual({ type: 'setting', key: 'readBack', value: true })
    expect(run('set_speed', { fast: false }, 'dheere bolo').setting).toEqual({ type: 'setting', key: 'fastSpeech', value: false })
  })

  it('a question left open past the time limit is gone, for the tools too', () => {
    const { core, run, tick } = setup([cust('c1', 'Ramesh', 300)])
    run('add_entries', { entries: [{ name: 'Ramesh', amount: 200, direction: 'credit' }] }, 'Ramesh 200')
    expect(core.pending?.kind).toBe('confirm')
    expect(core.pendingAt).toBe(1_000_000)
    tick(PENDING_TTL_MS + 1)
    expect(core.pendingView()).toBeNull()
    expect(core.pending).toBeNull()
    const r = run('answer_question', { kind: 'yes' }, 'haan')
    expect(r.ops).toEqual([])
  })

  it('answer_question answers the open question with what was heard', () => {
    const { core, run } = setup([cust('c1', 'Ramesh', 300)])
    run('add_entries', { entries: [{ name: 'Ramesh', amount: 200, direction: 'credit' }] }, 'Ramesh 200')
    const r = run('answer_question', { kind: 'yes' }, 'haan ji')
    expect(r.ops[0]).toMatchObject({ op: 'entry', cid: 'c1', paise: 20000 })
    expect(core.pending).toBeNull()
  })
})
