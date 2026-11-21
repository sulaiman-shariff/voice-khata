/**
 * The agent's tools. The model only picks a tool and fills its arguments; every tool runs through
 * the ledger safety layer (LedgerCore), so the rules that kept the old turn loop safe hold here too.
 *
 * Rules:
 *  - add_entries builds Drafts with path 'llm' and reasons from validate(), so amounts not heard
 *    are dropped, and direction-guessed / name-changed lead to confirm.
 *  - Remove, move, merge, settle and erase always go through a pending question. undo_last is
 *    instant only for a heard "hata do" within 60 s of this session writing that entry.
 *  - erase_all creates pending.kind === 'delete' with view.requireTap = true: a spoken yes only
 *    arms it, the on-screen button tap erases.
 *  - send_reminder refuses unless remindersOptIn && adult, and asks for confirmation; nothing is
 *    sent by the server, the phone gets a `ready` card and the shopkeeper taps to send.
 *  - A heard name not in the ledger is never written without a yes (add_customer asks; a near
 *    name asks which). rename needs a sure match. A phone number must be heard and is read back.
 *  - Two customers who fit a name: a 'choose' question lists all of them; the answer finishes the
 *    same tool call.
 *  - answer_question never takes yes / no / an amount from the model: only from what was heard.
 *    An option from the model counts only when it is exactly one on screen; a customer's name only
 *    when that name was also heard (a sure match in some stream).
 *  - Internal args (`<slot>__cid`, `_new`) are stripped from the model's calls; only our own
 *    'choose' continuations may set them.
 *  - Answers for show and query tools are computed from core.snap (balances; history via
 *    entries filtered by day).
 */
import { parseFast } from '../../shared/intent.js'
import { NAME_SURE, matchName } from '../../shared/names.js'
import { formatINR } from '../../shared/numbers.js'
import type { SnapCustomer, SnapEntry } from '../../shared/protocol.js'
import { LANGS, LANG_NAME, type Lang, guardReply, say, sayMore } from '../../shared/replies.js'
import { type ChooseOption, LedgerCore, type Reply, type TurnMeta } from '../ledger/core.js'
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

/** The sentence the tool was called for, and every language stream's reading of it (when there are several). */
/** `fromAudio`: the reading came from the model hearing the audio, not from the transcripts: every write is read back. */
export type ToolMeta = TurnMeta & { transcript: string; heard?: string[]; fromAudio?: boolean }

/** Args only our own "which one" continuations may set (`<slot>__cid`, `_new`): never taken from the model. */
const internalKey = (k: string) => k.startsWith('_') || k.includes('__')

/** Run a tool the model called. Internal args are stripped: a model cannot pin a customer by id. */
export function runTool(core: LedgerCore, call: ToolCall, meta: ToolMeta): Reply {
  const args = Object.fromEntries(Object.entries(call.args ?? {}).filter(([k]) => !internalKey(k)))
  return runTrusted(core, { name: call.name, args }, meta)
}

/** Run a tool call whose args we built (a 'choose' continuation), or the model's after stripping. */
function runTrusted(core: LedgerCore, call: ToolCall, meta: ToolMeta): Reply {
  attachTools(core)
  const before = core.sayBalance
  core.sayBalance = true // a confident save says the new balance (savedWithBalance)
  try {
    core.expireStale()
    return run(core, call, meta)
  } finally {
    core.sayBalance = before
  }
}

/**
 * Let a "which one?" (pending 'choose') finish the tool call that asked it, also when the answer
 * arrives as a tap through the turn loop. runTool does this itself; call it once per session too.
 */
export function attachTools(core: LedgerCore) {
  core.choose = (tool, args, transcript, meta) => (isToolName(tool) ? runTrusted(core, { name: tool, args }, { ...meta, transcript }) : null)
}

/** only an entry written in this session within this long is undone without a question */
const UNDO_INSTANT_MS = 60_000

function run(core: LedgerCore, call: ToolCall, meta: ToolMeta): Reply {
  const lang = core.lang
  const R = say(lang)
  const M = sayMore(lang)
  const a = call.args ?? {}
  const text = meta.transcript
  const heard = [text, ...(meta.heard ?? [])].filter((t) => t && t.trim())
  const tm: TurnMeta = { snrDb: meta.snrDb, noisy: meta.noisy, path: 'llm' }
  const speak = (...parts: string[]): Reply => ({ parts, ops: [] })
  const notCaught = () => speak(meta.noisy ? R.noisyRepeat() : R.didNotCatch())
  const entries = core.snap.entries ?? []
  const recent = entries.slice(0, 12)
  const contextAmounts = recent.map((e) => e.paise / 100)
  const isReply = (x: unknown): x is Reply => !!x && typeof x === 'object' && 'parts' in x

  /**
   * The customer a name argument means: one customer, several (two who fit equally: asked), or
   * none. A "which one" answer pins the choice as `<slot>__cid`. `exact` needs a sure match.
   */
  const resolve = (slot: string, exact = false): SnapCustomer | SnapCustomer[] | null => {
    const pinned = str(a[`${slot}__cid`])
    if (pinned) return core.snap.customers.find((c) => c.cid === pinned) ?? null
    const name = str(a[slot])
    if (!name) return null
    // a "which one" option sent back exactly as shown ("Suresh · ₹300")
    const byLabel = core.snap.customers.filter((c) => core.label(c) === name)
    if (byLabel.length === 1) return byLabel[0]
    const c = core.lookup(name)
    if (c) {
      const twins = core.snap.customers.filter((x) => x.name.toLowerCase() === c.name.toLowerCase())
      if (twins.length > 1) return twins
    }
    if (!exact) return c
    const best = matchName(name, core.snap.customers.map((x) => ({ id: x.cid, names: [x.name, ...x.aliases] })))[0]
    if (best && best.score >= NAME_SURE) return core.snap.customers.find((x) => x.cid === best.id) ?? null
    const near = core.candidates(name).map((x) => x.c)
    return near.length ? near.slice(0, 3) : null
  }
  /** Ask which customer (all of them as options); the answer finishes this same tool call. */
  const askWhich = (slot: string, options: SnapCustomer[], extra: ChooseOption[] = []): Reply => {
    const opts: ChooseOption[] = [
      ...options.map((c) => ({ label: core.label(c), name: c.name, rupees: c.balancePaise / 100, args: { ...a, [`${slot}__cid`]: c.cid } })),
      ...extra,
    ]
    const labels = opts.map((o) => o.label)
    const ask = labels.length === 1 ? `${labels[0]}?` : R.askWhich(labels.slice(0, -1).join(', '), labels[labels.length - 1])
    core.pending = { kind: 'choose', ask, tool: call.name, transcript: text, options: opts }
    return speak(ask)
  }
  /** resolve, or the reply to give instead: not found / which one */
  const need = (slot: string, exact = false): SnapCustomer | Reply => {
    const r = resolve(slot, exact)
    if (Array.isArray(r)) return askWhich(slot, r)
    if (r) return r
    const name = str(a[slot])
    return name ? speak(R.notFound(name)) : notCaught()
  }
  /** the entry the model pointed at: its number in snap.entries (1 = newest), else the newest that fits name / amount / day */
  const findRef = (): number | Reply => {
    const ref = int(a.ref)
    if (ref !== null) return ref >= 1 && ref <= entries.length ? ref : notCaught()
    let c: SnapCustomer | null = null
    if (str(a.name) || str(a.name__cid)) {
      const r = need('name')
      if (isReply(r)) return r
      c = r
    }
    const amt = num(a.amount)
    const day = int(a.day_offset)
    if (!c && amt === null && day === null) return notCaught()
    const i = entries.findIndex((e) => (!c || e.cid === c.cid) &&
      (amt === null || e.paise === Math.round(amt * 100)) && (day === null || e.day === istDay(day)))
    return i >= 0 ? i + 1 : notCaught()
  }
  const lastOf = (cid: string): { amt: number; dir: SnapEntry['direction'] } | undefined => {
    const e = entries.find((x) => x.cid === cid && !x.promise)
    return e ? { amt: e.paise / 100, dir: e.direction } : undefined
  }
  const owing = () => core.snap.customers.filter((c) => c.balancePaise > 0).sort((x, y) => y.balancePaise - x.balancePaise)
  const duesReply = (): Reply => {
    const o = owing()
    const show = { type: 'show', view: 'dues' } as const
    if (!o.length) return { parts: [R.noDues()], ops: [], show }
    return { parts: [R.showDues(o.length, o.reduce((s, c) => s + c.balancePaise, 0) / 100)], ops: [], show }
  }

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
      // an audio reading may carry amounts no transcript has; it is read back (hard reason) before any write
      const known = meta.fromAudio ? [...contextAmounts, ...(raw.entries ?? []).map((e) => e?.amount).filter((v): v is number => typeof v === 'number')] : contextAmounts
      const intent = validate(text, raw, known, recent.length)
      if (intent.type !== 'entries') return notCaught()
      if (meta.fromAudio) for (const e of intent.entries) { e.reasons = [...e.reasons, 'from-audio']; e.confidence = 'low' }
      return core.addEntries(intent, text, tm)
    }
    case 'change_entry': {
      const ref = findRef()
      if (isReply(ref)) return ref
      const reading: Partial<LlmReading> = {
        intent: 'modify',
        modify: { ref, amount: num(a.new_amount), direction: a.new_direction === 'credit' || a.new_direction === 'payment' ? a.new_direction : null, name: null, remove: false },
      }
      // the new amount must have been heard, like any amount
      const intent = validate(text, reading, meta.fromAudio && num(a.new_amount) != null ? [...contextAmounts, num(a.new_amount)!] : contextAmounts, entries.length)
      if (intent.type !== 'modify') return notCaught()
      return core.modifyEntry(intent, meta.fromAudio ? { ask: true } : undefined)
    }
    case 'remove_entry': {
      const ref = findRef()
      if (isReply(ref)) return ref
      return core.modifyEntry({ type: 'modify', ref, remove: true }, { ask: true })
    }
    case 'undo_last': {
      const last = core.snap.last
      if (!last) return speak(R.nothingToUndo())
      // at once only for "hata do" heard right after this session wrote the entry; otherwise asked
      const saidUndo = heard.some((t) => parseFast(t).type === 'undo')
      if (saidUndo && core.wroteRecently(last.eid, UNDO_INSTANT_MS))
        return { parts: [R.undone()], ops: [{ op: 'void', eid: last.eid, reason: 'spoken undo' }] }
      const ref = entries.findIndex((e) => e.eid === last.eid) + 1
      if (ref < 1) return notCaught()
      return core.modifyEntry({ type: 'modify', ref, remove: true }, { ask: true })
    }
    case 'move_entry': {
      const ref = findRef()
      if (isReply(ref)) return ref
      const to = str(a.to_name)
      if (!to && !str(a.to_name__cid)) return notCaught()
      const target = resolve('to_name')
      if (Array.isArray(target)) return askWhich('to_name', target)
      if (!target) return core.modifyEntry({ type: 'modify', ref, name: to! }, { ask: true }) // a new name: read back as a new customer
      const e = entries[ref - 1]
      if (e.cid === target.cid) return notCaught()
      core.pending = {
        kind: 'modify', ops: [{ op: 'amend', eid: e.eid, cid: target.cid }], done: R.corrected(target.name, e.paise / 100, e.direction),
        focus: target.cid, view: { kind: 'modify', name: core.label(target), paise: e.paise, direction: e.direction },
      }
      return speak(M.changeAsk(core.label(target), e.paise / 100, e.direction))
    }
    case 'settle': {
      const name = str(a.name)
      return core.settleFor(name, text, tm) ?? (name ? speak(R.notFound(name)) : notCaught())
    }
    case 'add_customer': {
      const pinned = resolve('name')
      if (str(a.name__cid) && pinned && !Array.isArray(pinned)) return speak(R.showCustomer(pinned.name, pinned.balancePaise / 100, lastOf(pinned.cid)))
      const name = str(a.name)
      if (!name) return notCaught()
      const same = core.snap.customers.find((c) => [c.name, ...c.aliases].some((n) => n.toLowerCase() === name.toLowerCase()))
      if (same) return speak(R.showCustomer(same.name, same.balancePaise / 100, lastOf(same.cid)))
      const newName = titleCase(name)
      // a name close to one we have is probably that customer, misheard: ask which
      if (a._new !== true) {
        const near = [...new Map([...(core.lookup(name) ? [core.lookup(name)!] : []), ...core.candidates(name).map((x) => x.c)].map((c) => [c.cid, c])).values()]
        if (near.length) return askWhich('name', near.slice(0, 3), [{ label: newName, name: newName, args: { ...a, _new: true } }])
      }
      // a heard name not in the ledger is never written without a yes (a tap on the card counts)
      const cid = core.freshId()
      core.pending = {
        kind: 'modify', ops: [{ op: 'add_customer', cid, name: newName }], done: R.customerAdded(newName), focus: cid,
        view: { kind: 'modify', name: newName, newCustomer: true },
      }
      return speak(M.addAsk(newName))
    }
    case 'rename_customer': {
      // the account to rename must be named surely; a near name is asked about first
      const c = need('name', true)
      if (isReply(c)) return c
      const to = str(a.new_name)
      if (!to || to.length > 40 || to === c.name) return notCaught()
      return { parts: [R.renamed(c.name, titleCase(to))], ops: [{ op: 'rename_customer', cid: c.cid, name: titleCase(to) }] }
    }
    case 'merge_customers': {
      const from = need('name')
      if (isReply(from)) return from
      const into = need('into')
      if (isReply(into)) return into
      if (from.cid === into.cid) return notCaught()
      core.pending = {
        kind: 'modify', ops: [{ op: 'merge_customers', from: from.cid, into: into.cid }], done: R.merged(from.name, into.name), focus: into.cid,
        view: { kind: 'modify', name: `${core.label(from)} → ${core.label(into)}` },
      }
      return speak(R.mergeAsk(core.label(from), core.label(into)))
    }
    case 'set_phone': {
      const c = need('name')
      if (isReply(c)) return c
      let digits = String(a.phone ?? '').replace(/\D/g, '')
      if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
      if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
      // a valid mobile, every digit of it heard, and read back before it is saved
      if (!/^[6-9]\d{9}$/.test(digits) || !heard.some((t) => t.replace(/\D/g, '').includes(digits))) return notCaught()
      core.pending = {
        kind: 'modify', ops: [{ op: 'set_phone', cid: c.cid, phone: digits }], done: R.phoneSet(c.name), focus: c.cid,
        view: { kind: 'modify', name: core.label(c) },
      }
      return speak(M.phoneAsk(core.label(c), `${digits.slice(0, 5)} ${digits.slice(5)}`))
    }
    case 'send_reminder': {
      const c = need('name')
      if (isReply(c)) return c
      if (c.balancePaise <= 0) return speak(R.balance(c.name, c.balancePaise / 100))
      // only customers who agreed to messages, and adults
      if (!c.remindersOptIn || !c.adult) return speak(R.noConsent(c.name))
      const msg = guardReply(R.reminderText(c.name, c.balancePaise / 100, core.snap.shopName))
      if (!msg) return notCaught()
      core.pending = {
        kind: 'modify', ops: [], done: R.remindReady(c.name), focus: c.cid,
        view: { kind: 'modify', name: core.label(c), paise: c.balancePaise }, ready: { kind: 'whatsapp', cid: c.cid, text: msg },
      }
      return speak(M.reminderAsk(core.label(c)))
    }
    case 'send_statement': {
      const c = need('name')
      if (isReply(c)) return c
      if (!c.remindersOptIn || !c.adult) return speak(R.noConsent(c.name))
      const lines = entries.filter((e) => e.cid === c.cid && !e.promise).slice(0, 10)
        .map((e) => `${e.day}  ${e.direction === 'credit' ? '+' : '-'}₹${formatINR(e.paise / 100)}`)
      const body = guardReply([core.snap.shopName, R.balance(c.name, c.balancePaise / 100), ...lines].join('\n'))
      if (!body) return notCaught()
      core.focusCid = c.cid
      return { parts: [R.statementReady(c.name)], ops: [], ready: { kind: 'whatsapp', cid: c.cid, text: body } }
    }
    case 'erase_all':
      // a spoken yes arms it, then only the on-screen button erases (LedgerCore.answerPending)
      core.pending = { kind: 'delete', requireTap: true }
      return speak(R.eraseAsk())

    // ------------------------------------------------------------------ show and ask
    case 'show_customer':
    case 'query_balance': {
      let c: SnapCustomer | Reply
      if (str(a.name) || str(a.name__cid)) c = need('name')
      else {
        const focus = core.focusCid ? core.snap.customers.find((x) => x.cid === core.focusCid) : undefined
        if (!focus) return call.name === 'query_balance' ? duesReply() : notCaught()
        c = focus
      }
      if (isReply(c)) return c
      core.focusCid = c.cid
      const part = call.name === 'show_customer' ? R.showCustomer(c.name, c.balancePaise / 100, lastOf(c.cid)) : R.balance(c.name, c.balancePaise / 100)
      return { parts: [part], ops: [], show: { type: 'show', view: 'customer', cid: c.cid } }
    }
    case 'show_dues':
      return duesReply()
    case 'show_history': {
      const day = int(a.day_offset)
      let c: SnapCustomer | null = null
      if (str(a.name) || str(a.name__cid)) {
        const r = need('name')
        if (isReply(r)) return r
        c = r
        core.focusCid = c.cid
      }
      const dayStr = day !== null ? istDay(day) : null
      const list = entries.filter((e) => (!c || e.cid === c.cid) && (!dayStr || e.day === dayStr))
      const label = c ? c.name : dayStr ?? istDay(0)
      const show = c ? { type: 'show', view: 'customer', cid: c.cid } as const : { type: 'show', view: 'summary' } as const
      return { parts: [R.showHistory(label, list.length)], ops: [], show }
    }
    case 'show_today': {
      const t = core.snap.today
      return { parts: [R.showToday(t.creditPaise / 100, t.paymentPaise / 100)], ops: [], show: { type: 'show', view: 'summary' } }
    }
    case 'search': {
      const q = str(a.text)
      if (!q) return notCaught()
      const found = core.candidates(q).map((x) => x.c)
      const amounts = (q.match(/\d+(\.\d+)?/g) ?? []).map((x) => Math.round(Number(x) * 100))
      // "Ramesh 200": Ramesh's 200 entries; "200": every 200 entry; "Ramesh": the customer
      const count = amounts.length
        ? entries.filter((e) => amounts.includes(e.paise) && (!found.length || found.some((c) => c.cid === e.cid))).length
        : found.length
      const reply: Reply = { parts: [R.searchResult(q, count)], ops: [] }
      if (found.length === 1) reply.show = { type: 'show', view: 'customer', cid: found[0].cid }
      return reply
    }
    case 'top_debtors': {
      const n = Math.min(5, Math.max(1, int(a.count) ?? 3))
      return { parts: [R.topDebtors(owing().slice(0, n).map((c) => c.name))], ops: [], show: { type: 'show', view: 'dues' } }
    }
    case 'close_view':
      return speak(R.closed())

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
      // nothing open (or it expired): say so rather than stay silent
      if (!core.pending) return notCaught()
      const kind = a.kind
      const value = str(a.value)
      const view = core.pendingView()
      // a customer's name from the model counts only when that name was also heard (a sure match
      // in some stream): a made-up existing name must never get an entry attached to it
      const named = kind === 'name' && value ? core.snap.customers.filter((c) => c.name === value || core.label(c) === value) : []
      if (named.length) {
        const sure = heard.some((t) => core.candidates(t).some((x) => x.score >= NAME_SURE && named.some((c) => c.cid === x.c.cid)))
        if (!sure) return notCaught()
        return core.answerPending(value!, { type: 'unknown' }, tm) ?? notCaught()
      }
      // an option from the model only when it is exactly one on screen
      if (kind === 'option' && value && view?.options?.includes(value))
        return core.answerPending(value, { type: 'unknown' }, tm) ?? notCaught()
      // everything else (yes, no, amounts, directions) only from what was heard
      const read = heard.map((t) => ({ t, i: parseFast(t) })).find((x) => x.i.type !== 'unknown')
      if (!read && (kind === 'yes' || kind === 'no')) return notCaught() // the question stays open
      const said = read ?? { t: text, i: parseFast(text) }
      return core.answerPending(said.t, said.i, tm) ?? notCaught()
    }
    case 'not_for_me':
      return { parts: [], ops: [], notForMe: true }
    case 'unclear':
      return notCaught()
  }
}
