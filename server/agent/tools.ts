/**
 * The agent's tools. The model only picks a tool and fills its arguments; every tool runs through
 * the ledger safety layer (LedgerCore), so the rules that kept the old turn loop safe hold here too.
 *
 * Rules:
 *  - add_entries builds Drafts with path 'llm' and reasons from validate(), so amounts not heard
 *    are dropped, and direction-guessed / name-changed lead to confirm.
 *  - Remove, move, merge, settle and erase always go through a pending question.
 *  - erase_all creates pending.kind === 'delete' with requireType = the localized word: only typing it erases.
 *    erases; a spoken or tapped yes never does.
 *  - send_reminder refuses unless remindersOptIn && adult, and asks for confirmation; nothing is
 *    sent by the server, the phone gets a `ready` card and the shopkeeper taps to send.
 *  - Answers for show and query tools are computed from core.snap (balances; history via
 *    entries filtered by day).
 */
import { type Intent, directionAnswer, parseFast } from '../../shared/intent.js'
import { formatINR } from '../../shared/numbers.js'
import type { SnapCustomer, SnapEntry } from '../../shared/protocol.js'
import { LANGS, LANG_NAME, type Lang, eraseWord, guardReply, say, sayMore } from '../../shared/replies.js'
import { LedgerCore, type Reply, type TurnMeta } from '../ledger/core.js'
import type { GeminiTool } from '../parse/gemini.js'
import { type LlmReading, validate } from '../parse/llm.js'

export const TOOL_NAMES = [
  'add_entries', 'change_entry', 'remove_entry', 'undo_last', 'move_entry', 'settle',
  'show_customer', 'show_dues', 'show_history', 'show_today', 'search', 'top_debtors', 'close_view',
  'add_customer', 'rename_customer', 'merge_customers', 'set_phone', 'send_reminder', 'send_statement',
  'set_language', 'set_read_back', 'set_speed', 'set_shop_name', 'open_privacy', 'backup', 'erase_all',
  'answer_question', 'query_balance', 'not_for_me', 'unclear',
] as const
export type ToolName = (typeof TOOL_NAMES)[number]
export interface ToolCall { name: ToolName; args: Record<string, unknown> }
export const isToolName = (n: string): n is ToolName => (TOOL_NAMES as readonly string[]).includes(n)

type JSONSchema = Record<string, unknown>
const STR = { type: 'string' }
const INT = { type: 'integer' }
const DIR = { type: 'string', enum: ['credit', 'payment'] }
const obj = (properties: Record<string, unknown>, required: string[] = []): JSONSchema => ({ type: 'object', properties, required })
/** how the model points at one existing entry: its number in the recent list, or who / how much / which day */
const ENTRY_REF = {
  ref: { ...INT, description: 'entry number from the recent-entries list, 1 = newest' },
  name: { ...STR, description: 'customer of the entry' },
  amount: { type: 'number', description: 'the entry\'s current amount in rupees' },
  day_offset: { ...INT, description: '0 today, -1 yesterday' },
}

/** Gemini functionDeclarations. Amounts are numbers in rupees. */
export const TOOL_SCHEMAS: { name: ToolName; description: string; parameters: JSONSchema }[] = [
  {
    name: 'add_entries',
    description: 'Write one or more ledger lines. Amounts must be ones actually said. credit = customer took goods and owes; payment = customer paid back. Set direction null if it was not said.',
    parameters: obj({
      entries: {
        type: 'array',
        items: obj({
          name: { type: ['string', 'null'] },
          amount: { type: 'number', description: 'rupees, exactly as said' },
          direction: { anyOf: [DIR, { type: 'null' }] },
          day_offset: { ...INT, description: 'omit for today; -1 yesterday' },
          promise: { type: 'boolean', description: 'a future payment ("kal de dega")' },
        }, ['name', 'amount', 'direction']),
      },
      sure: { type: 'boolean', description: 'false when any part is a guess' },
    }, ['entries']),
  },
  { name: 'change_entry', description: 'Change the amount or direction of an existing entry.', parameters: obj({ ...ENTRY_REF, new_amount: { type: 'number', description: 'rupees, as said' }, new_direction: DIR }) },
  { name: 'remove_entry', description: 'Remove one existing entry (asked first).', parameters: obj(ENTRY_REF) },
  { name: 'undo_last', description: 'Remove the entry just written ("hata do", "galti se").', parameters: obj({}) },
  { name: 'move_entry', description: 'Move an existing entry to another customer (asked first).', parameters: obj({ ...ENTRY_REF, to_name: STR }, ['to_name']) },
  { name: 'settle', description: 'The customer paid off their whole balance ("hisaab clear"). Omit name for the customer just talked about.', parameters: obj({ name: STR }) },
  { name: 'show_customer', description: 'Open a customer\'s page and say their balance.', parameters: obj({ name: STR }, ['name']) },
  { name: 'show_dues', description: 'Show everyone who owes, with the total.', parameters: obj({}) },
  { name: 'show_history', description: 'Show entries for a customer and/or a day.', parameters: obj({ name: STR, day_offset: { ...INT, description: '0 today, -1 yesterday' } }) },
  { name: 'show_today', description: 'Today\'s totals of credit and payments.', parameters: obj({}) },
  { name: 'search', description: 'Search customers and entries by a name or an amount.', parameters: obj({ text: STR }, ['text']) },
  { name: 'top_debtors', description: 'The customers with the largest balances.', parameters: obj({ count: { ...INT, description: 'default 3, at most 5' } }) },
  { name: 'close_view', description: 'Close the open panel or screen.', parameters: obj({}) },
  { name: 'add_customer', description: 'Open a new customer account with no entry.', parameters: obj({ name: STR }, ['name']) },
  { name: 'rename_customer', description: 'Change a customer\'s name.', parameters: obj({ name: STR, new_name: STR }, ['name', 'new_name']) },
  { name: 'merge_customers', description: 'Two accounts are the same person: join `name` into `into` (asked first).', parameters: obj({ name: STR, into: STR }, ['name', 'into']) },
  { name: 'set_phone', description: 'Save a customer\'s 10-digit mobile number.', parameters: obj({ name: STR, phone: STR }, ['name', 'phone']) },
  { name: 'send_reminder', description: 'Prepare a polite WhatsApp reminder of the balance (only for customers who agreed).', parameters: obj({ name: STR }, ['name']) },
  { name: 'send_statement', description: 'Prepare a WhatsApp statement of a customer\'s entries.', parameters: obj({ name: STR }, ['name']) },
  { name: 'set_language', description: 'Change the language the app speaks.', parameters: obj({ lang: { type: 'string', enum: [...LANGS] } }, ['lang']) },
  { name: 'set_read_back', description: 'Turn reading each entry back before saving on or off.', parameters: obj({ on: { type: 'boolean' } }, ['on']) },
  { name: 'set_speed', description: 'Speak faster or slower.', parameters: obj({ fast: { type: 'boolean' } }, ['fast']) },
  { name: 'set_shop_name', description: 'Set the shop\'s name.', parameters: obj({ name: STR }, ['name']) },
  { name: 'open_privacy', description: 'Where the data goes, is this an AI, how it works.', parameters: obj({}) },
  { name: 'backup', description: 'Make a backup file of the ledger.', parameters: obj({}) },
  { name: 'erase_all', description: 'Erase all data (needs a spoken yes and then a tap).', parameters: obj({}) },
  {
    name: 'answer_question',
    description: 'Answer the question the app is waiting on (pending).',
    parameters: obj({
      kind: { type: 'string', enum: ['yes', 'no', 'name', 'amount', 'direction', 'option'] },
      value: { ...STR, description: 'the name, the chosen option, or credit/payment' },
    }, ['kind']),
  },
  { name: 'query_balance', description: 'How much a customer owes (no name: everyone who owes).', parameters: obj({ name: STR }) },
  { name: 'not_for_me', description: 'Talk to someone else, TV or background: nothing to do.', parameters: obj({}) },
  { name: 'unclear', description: 'Meant for the app, but the words cannot be trusted.', parameters: obj({}) },
]

/** The same declarations in the shape geminiAgentCall takes. */
export const GEMINI_TOOLS: GeminiTool[] = TOOL_SCHEMAS.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }))

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const int = (v: unknown): number | null => (Number.isInteger(v) ? (v as number) : null)
const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase())
/** YYYY-MM-DD in India, offset by n days (the shop's calendar). */
const istDay = (n: number) => new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10)

export function runTool(core: LedgerCore, call: ToolCall, meta: TurnMeta & { transcript: string }): Reply {
  const before = core.sayBalance
  core.sayBalance = true // a confident save says the new balance (savedWithBalance)
  try {
    core.expireStale()
    return run(core, call, meta)
  } finally {
    core.sayBalance = before
  }
}

function run(core: LedgerCore, call: ToolCall, meta: TurnMeta & { transcript: string }): Reply {
  const lang = core.lang
  const R = say(lang)
  const a = call.args ?? {}
  const text = meta.transcript
  const tm: TurnMeta = { snrDb: meta.snrDb, noisy: meta.noisy, path: 'llm' }
  const speak = (...parts: string[]): Reply => ({ parts, ops: [] })
  const notCaught = () => speak(meta.noisy ? R.noisyRepeat() : R.didNotCatch())
  const entries = core.snap.entries ?? []
  const recent = entries.slice(0, 12)
  const contextAmounts = recent.map((e) => e.paise / 100)

  /** One customer for a name, or 'many' when two fit equally (then the agent is told which ones). */
  const resolve = (name: string | null): SnapCustomer | 'many' | null => {
    if (!name) return null
    // a "which one" option sent back exactly as shown ("Suresh · ₹300")
    const byLabel = core.snap.customers.find((c) => core.label(c) === name)
    if (byLabel) return byLabel
    const c = core.lookup(name)
    if (!c) return null
    const twins = core.snap.customers.filter((x) => x.name.toLowerCase() === c.name.toLowerCase())
    return twins.length > 1 ? 'many' : c
  }
  const twinsAsk = (name: string): Reply => {
    const t = core.snap.customers.filter((x) => x.name.toLowerCase() === core.lookup(name)?.name.toLowerCase())
    return speak(R.askWhich(core.label(t[0]), core.label(t[1])))
  }
  /** resolve or answer: not found / which one */
  const customer = (name: string | null): SnapCustomer | Reply => {
    const c = resolve(name)
    if (c === 'many') return twinsAsk(name!)
    if (!c) return name ? speak(R.notFound(name)) : notCaught()
    return c
  }
  const isReply = (x: SnapCustomer | Reply): x is Reply => 'parts' in x
  /** the entry the model pointed at: its number, else the newest that fits name / amount / day */
  const findRef = (): number | null => {
    const ref = int(a.ref)
    if (ref !== null) return ref >= 1 && ref <= entries.length ? ref : null
    const name = str(a.name)
    const c = name ? resolve(name) : null
    if (name && (!c || c === 'many')) return null
    const amt = num(a.amount)
    const day = int(a.day_offset)
    if (!c && amt === null && day === null) return null
    const i = entries.findIndex((e) => (!c || c === 'many' || e.cid === c.cid) &&
      (amt === null || e.paise === Math.round(amt * 100)) && (day === null || e.day === istDay(day)))
    return i >= 0 ? i + 1 : null
  }
  const lastOf = (cid: string): { amt: number; dir: SnapEntry['direction'] } | undefined => {
    const e = entries.find((x) => x.cid === cid && !x.promise)
    return e ? { amt: e.paise / 100, dir: e.direction } : undefined
  }
  const owing = () => core.snap.customers.filter((c) => c.balancePaise > 0).sort((x, y) => y.balancePaise - x.balancePaise)

  switch (call.name) {
    // ------------------------------------------------------------------ writes
    case 'add_entries': {
      // the model's reading goes through validate(): amounts not heard are dropped, a guessed
      // direction or a changed name makes the line low-confidence, so it is read back
      const raw: Partial<LlmReading> = {
        intent: 'entries',
        entries: (Array.isArray(a.entries) ? a.entries : []) as LlmReading['entries'],
        sure: a.sure !== false,
      }
      const intent = validate(text, raw, contextAmounts, recent.length)
      if (intent.type !== 'entries') return notCaught()
      return core.addEntries(intent, text, tm)
    }
    case 'change_entry': {
      const ref = findRef()
      if (ref === null) return notCaught()
      const reading: Partial<LlmReading> = {
        intent: 'modify',
        modify: { ref, amount: num(a.new_amount), direction: a.new_direction === 'credit' || a.new_direction === 'payment' ? a.new_direction : null, name: null, remove: false },
      }
      // the new amount must have been heard, like any amount
      const intent = validate(text, reading, contextAmounts, entries.length)
      if (intent.type !== 'modify') return notCaught()
      return core.modifyEntry(intent)
    }
    case 'remove_entry': {
      const ref = findRef()
      if (ref === null) return notCaught()
      return core.modifyEntry({ type: 'modify', ref, remove: true }, { ask: true })
    }
    case 'undo_last': {
      const last = core.snap.last
      if (!last) return speak(R.nothingToUndo())
      return { parts: [R.undone()], ops: [{ op: 'void', eid: last.eid, reason: 'spoken undo' }] }
    }
    case 'move_entry': {
      const ref = findRef()
      const to = str(a.to_name)
      if (ref === null || !to) return notCaught()
      if (resolve(to) === 'many') return twinsAsk(to)
      const target = resolve(to)
      return core.modifyEntry({ type: 'modify', ref, name: target && target !== 'many' ? target.name : to }, { ask: true })
    }
    case 'settle': {
      const name = str(a.name)
      return core.settleFor(name, text, tm) ?? (name ? speak(R.notFound(name)) : notCaught())
    }
    case 'add_customer': {
      const name = str(a.name)
      if (!name) return notCaught()
      const same = core.snap.customers.find((c) => [c.name, ...c.aliases].some((n) => n.toLowerCase() === name.toLowerCase()))
      if (same) return speak(R.showCustomer(same.name, same.balancePaise / 100, lastOf(same.cid)))
      const cid = core.freshId()
      return { parts: [R.customerAdded(titleCase(name))], ops: [{ op: 'add_customer', cid, name: titleCase(name) }] }
    }
    case 'rename_customer': {
      const c = customer(str(a.name))
      if (isReply(c)) return c
      const to = str(a.new_name)
      if (!to || to.length > 40 || to === c.name) return notCaught()
      return { parts: [R.renamed(c.name, titleCase(to))], ops: [{ op: 'rename_customer', cid: c.cid, name: titleCase(to) }] }
    }
    case 'merge_customers': {
      const from = customer(str(a.name))
      if (isReply(from)) return from
      const into = customer(str(a.into))
      if (isReply(into)) return into
      if (from.cid === into.cid) return notCaught()
      core.pending = {
        kind: 'modify', ops: [{ op: 'merge_customers', from: from.cid, into: into.cid }], done: R.merged(from.name, into.name), focus: into.cid,
        view: { kind: 'modify', name: `${core.label(from)} → ${core.label(into)}` },
      }
      return speak(R.mergeAsk(from.name, into.name))
    }
    case 'set_phone': {
      const c = customer(str(a.name))
      if (isReply(c)) return c
      let digits = String(a.phone ?? '').replace(/\D/g, '')
      if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
      if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
      if (!/^[6-9]\d{9}$/.test(digits)) return notCaught()
      return { parts: [R.phoneSet(c.name)], ops: [{ op: 'set_phone', cid: c.cid, phone: digits }] }
    }
    case 'send_reminder': {
      const c = customer(str(a.name))
      if (isReply(c)) return c
      if (c.balancePaise <= 0) return speak(R.balance(c.name, c.balancePaise / 100))
      // only customers who agreed to messages, and adults
      if (!c.remindersOptIn || !c.adult) return speak(R.noConsent(c.name))
      const msg = guardReply(R.reminderText(c.name, c.balancePaise / 100, core.snap.shopName))
      if (!msg) return notCaught()
      core.pending = {
        kind: 'modify', ops: [], done: R.remindReady(c.name), focus: c.cid,
        view: { kind: 'modify', name: c.name, paise: c.balancePaise }, ready: { kind: 'whatsapp', cid: c.cid, text: msg },
      }
      return speak(sayMore(lang).reminderAsk(c.name))
    }
    case 'send_statement': {
      const c = customer(str(a.name))
      if (isReply(c)) return c
      if (!c.remindersOptIn || !c.adult) return speak(R.noConsent(c.name))
      const lines = entries.filter((e) => e.cid === c.cid && !e.promise).slice(0, 10)
        .map((e) => `${e.day}  ${e.direction === 'credit' ? '+' : '-'}₹${formatINR(e.paise / 100)}`)
      const text = guardReply([core.snap.shopName, R.balance(c.name, c.balancePaise / 100), ...lines].join('\n'))
      if (!text) return notCaught()
      core.focusCid = c.cid
      return { parts: [R.statementReady(c.name)], ops: [], ready: { kind: 'whatsapp', cid: c.cid, text } }
    }
    case 'erase_all':
      // only the typed word erases (LedgerCore.answerPending)
      core.pending = { kind: 'delete', requireType: eraseWord(lang) }
      return speak(R.eraseType(eraseWord(lang)))

    // ------------------------------------------------------------------ show and ask
    case 'show_customer':
    case 'query_balance': {
      const name = str(a.name)
      if (!name && call.name === 'query_balance') {
        const focus = core.focusCid ? core.snap.customers.find((c) => c.cid === core.focusCid) : undefined
        if (!focus) {
          const o = owing()
          const show = { type: 'show', view: 'dues' } as const
          return o.length ? { parts: [R.showDues(o.length, o.reduce((s, c) => s + c.balancePaise, 0) / 100)], ops: [], show } : { parts: [R.noDues()], ops: [], show }
        }
      }
      const c = name ? customer(name) : core.snap.customers.find((x) => x.cid === core.focusCid) ?? notCaught()
      if (isReply(c)) return c
      core.focusCid = c.cid
      const part = call.name === 'show_customer' ? R.showCustomer(c.name, c.balancePaise / 100, lastOf(c.cid)) : R.balance(c.name, c.balancePaise / 100)
      return { parts: [part], ops: [], show: { type: 'show', view: 'customer', cid: c.cid } }
    }
    case 'show_dues': {
      const o = owing()
      const show = { type: 'show', view: 'dues' } as const
      if (!o.length) return { parts: [R.noDues()], ops: [], show }
      return { parts: [R.showDues(o.length, o.reduce((s, c) => s + c.balancePaise, 0) / 100)], ops: [], show }
    }
    case 'show_history': {
      const name = str(a.name)
      const day = int(a.day_offset)
      let c: SnapCustomer | null = null
      if (name) {
        const r = customer(name)
        if (isReply(r)) return r
        c = r
        core.focusCid = c.cid
      }
      const dayStr = day !== null ? istDay(day) : null
      const list = entries.filter((e) => (!c || e.cid === c.cid) && (!dayStr || e.day === dayStr))
      const label = c ? c.name : dayStr ?? istDay(0)
      // a customer alone: their page; a day (with or without a customer): the entries of that day
      const show: Reply['show'] = c && !dayStr ? { type: 'show', view: 'customer', cid: c.cid }
        : { type: 'show', view: 'history', from: dayStr ?? istDay(0), to: dayStr ?? istDay(0), ...(c ? { cid: c.cid } : {}) }
      return { parts: [R.showHistory(label, list.length)], ops: [], show }
    }
    case 'show_today': {
      const t = core.snap.today
      return { parts: [R.showToday(t.creditPaise / 100, t.paymentPaise / 100)], ops: [], show: { type: 'show', view: 'today' } }
    }
    case 'search': {
      const q = str(a.text)
      if (!q) return notCaught()
      const found = core.candidates(q).map((x) => x.c)
      const amounts = (q.match(/\d+(\.\d+)?/g) ?? []).map((x) => Math.round(Number(x) * 100))
      const hits = amounts.length ? entries.filter((e) => amounts.includes(e.paise)) : []
      const reply: Reply = { parts: [R.searchResult(q, found.length + hits.length)], ops: [] }
      reply.show = found.length === 1 && !hits.length ? { type: 'show', view: 'customer', cid: found[0].cid } : { type: 'show', view: 'search', text: q, cids: found.map((x) => x.cid), eids: hits.map((e) => e.eid) }
      return reply
    }
    case 'top_debtors': {
      const n = Math.min(5, Math.max(1, int(a.count) ?? 3))
      return { parts: [R.topDebtors(owing().slice(0, n).map((c) => c.name))], ops: [], show: { type: 'show', view: 'top_debtors', count: n } }
    }
    case 'close_view':
      return { parts: [R.closed()], ops: [], show: { type: 'show', view: 'close' } }

    // ------------------------------------------------------------------ settings
    case 'set_language': {
      const l = LANGS.find((x) => x === a.lang) as Lang | undefined
      if (!l) return notCaught()
      // said in the new language: the phone switches with this reply
      return { parts: [say(l).languageSet(LANG_NAME[l])], ops: [], setting: { type: 'setting', key: 'lang', value: l } }
    }
    case 'set_read_back': {
      const on = a.on === true
      return { parts: [R.readBackSet(on)], ops: [], setting: { type: 'setting', key: 'readBack', value: on } }
    }
    case 'set_speed': {
      const fast = a.fast === true
      return { parts: [R.speedSet(fast)], ops: [], setting: { type: 'setting', key: 'fastSpeech', value: fast } }
    }
    case 'set_shop_name': {
      const name = str(a.name)
      if (!name || name.length > 60) return notCaught()
      return { parts: [R.shopNameSet(name)], ops: [], setting: { type: 'setting', key: 'shopName', value: name } }
    }
    case 'open_privacy':
      return { parts: [R.privacyOpen()], ops: [], show: { type: 'show', view: 'privacy' } }
    case 'backup':
      return { parts: [R.backupReady()], ops: [], ready: { kind: 'backup' } }

    // ------------------------------------------------------------------ the dialogue
    case 'answer_question': {
      if (!core.pending) return speak()
      const kind = a.kind
      const value = str(a.value)
      // a name or a tapped option may come from the model (any script); amounts and the rest only
      // from what was heard
      const said = (kind === 'name' || kind === 'option') && value ? value : text
      let intent: Intent = parseFast(said)
      if ((kind === 'yes' || kind === 'no') && intent.type === 'unknown') intent = { type: kind }
      if (kind === 'direction' && (value === 'credit' || value === 'payment') && !directionAnswer(said)) intent = { type: 'correct', direction: value }
      return core.answerPending(said, intent, tm) ?? speak()
    }
    case 'not_for_me':
      return { parts: [], ops: [], notForMe: true }
    case 'unclear':
      return notCaught()
  }
}
