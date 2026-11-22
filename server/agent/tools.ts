/**
 * The agent's tools. The model only picks a tool and fills its arguments; every tool runs through
 * the ledger safety layer (LedgerCore), so the rules that kept the old turn loop safe hold here too.
 *
 * Rules:
 *  - add_entries builds Drafts with path 'llm' and reasons from validate(), so amounts not heard
 *    are dropped, and direction-guessed / name-changed lead to confirm.
 *  - Remove, move, merge, settle and erase always go through a pending question. undo_last is
 *    instant only for a heard "hata do" within 60 s of this session writing that entry.
 *  - erase_all creates pending.kind === 'delete' with requireType = the localized word: only
 *    typing it erases; a spoken or tapped yes never does.
 *  - send_reminder refuses unless remindersOptIn && adult, and asks for confirmation; nothing is
 *    sent by the server, the phone gets a `ready` card and the shopkeeper taps to send.
 *  - A heard name not in the ledger is never written without a yes (add_customer asks; a near
 *    name asks which). rename needs a sure match. A phone number must be heard and is read back.
 *  - Two customers who fit a name: a 'choose' question lists all of them; the answer finishes the
 *    same tool call.
 *  - answer_question never takes yes / no / an amount from the model: only from what was heard.
 *    An option from the model counts only when it is exactly one on screen AND the words heard pick
 *    it (the amount was said, or the name / "doosra" / "300 wala" points at that option); a
 *    customer's name only when that name was also heard (a sure match in some stream).
 *  - Internal args (`<slot>__cid`, `_new`) are stripped from the model's calls; only our own
 *    'choose' continuations may set them.
 *  - Answers for show and query tools are computed from core.snap (balances; history via
 *    entries filtered by day).
 */
import { parseFast } from '../../shared/intent.js'
import { CASH_CATEGORIES, type CashCategory, collectFrom, daysBetween } from '../../shared/ledger.js'
import { sayShop } from '../../shared/replies-shop.js'
import { NAME_SURE, matchName } from '../../shared/names.js'
import { formatINR, parseAmounts } from '../../shared/numbers.js'
import type { SnapCustomer, SnapEntry } from '../../shared/protocol.js'
import { LANGS, LANG_NAME, type Lang, eraseWord, guardReply, say, sayMore, sayPay } from '../../shared/replies.js'
import { type ChooseOption, type EntryExtras, LedgerCore, type Reply, type TurnMeta, WRITTEN_KEEP_MS, cleanTag } from '../ledger/core.js'
import type { GeminiTool } from '../parse/gemini.js'
import { type LlmReading, validate } from '../parse/llm.js'

export const TOOL_NAMES = [
  'add_entries', 'change_entry', 'remove_entry', 'undo_last', 'move_entry', 'settle',
  'show_customer', 'show_dues', 'show_history', 'show_today', 'search', 'top_debtors', 'close_view',
  'add_customer', 'rename_customer', 'merge_customers', 'set_phone', 'send_reminder', 'send_statement', 'show_qr',
  'set_language', 'set_speed', 'set_shop_name', 'open_privacy', 'backup', 'erase_all',
  'answer_question', 'query_balance', 'not_for_me', 'unclear',
  'show_overdue', 'collect_today', 'set_plan', 'cancel_plan', 'add_cash', 'set_tag',
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
          due_offset: { ...INT, description: 'credit to be paid within this many days ("das din mein", "kal tak" = 1); only if said' },
          due_weekday: { type: 'string', enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], description: 'credit to be paid by this weekday ("Somvaar tak"); only if said' },
          due_date: { ...INT, description: 'credit to be paid by this date of the month ("15 tarikh tak"); only if said' },
          items: { type: 'array', items: STR, description: 'the goods listed for this line, as said ("do kilo chawal", "ek Maggi")' },
          party: { type: 'string', enum: ['supplier'], description: 'the shop\'s own supplier (wholesaler): "Gupta ji ko 5000 dene hain" (credit = goods the shop took, owes them), "Gupta ji ko 2000 diye" (payment = the shop paid them)' },
          new_customer: { type: 'boolean', description: 'true only when the shopkeeper says this is a new / second person with a name already in the ledger ("naya Ramesh", "doosra Ramesh")' },
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
  {
    name: 'show_qr',
    description: 'Show a UPI QR on the screen for a customer at the counter to pay ("Ramesh ka QR dikhao"). Omit amount to collect the whole balance.',
    parameters: obj({ name: STR, amount: { type: 'number', description: 'rupees, only if said' } }, ['name']),
  },
  { name: 'show_overdue', description: 'Customers whose oldest unpaid credit is older than some days ("kiska 30 din se purana hai"). Default 30.', parameters: obj({ days: INT }) },
  { name: 'collect_today', description: 'Who to collect from today: due dates reached, promises for today, dues older than 30 days ("aaj kisse lena hai").', parameters: obj({}) },
  {
    name: 'set_plan',
    description: 'Split a customer\'s dues into instalments ("Ramesh ka 3000, teen hafte mein"; "har hafte 500"). Asked first. Amounts and the number of parts only as said.',
    parameters: obj({
      name: STR,
      total: { type: 'number', description: 'rupees to split; omit for the whole balance' },
      parts: { ...INT, description: 'number of instalments, only if said' },
      part_amount: { type: 'number', description: 'rupees per instalment, only if said' },
      every: { type: 'string', enum: ['day', 'week', 'month'], description: 'how often (default week)' },
    }, ['name']),
  },
  { name: 'cancel_plan', description: 'End a customer\'s instalment plan (asked first).', parameters: obj({ name: STR }, ['name']) },
  {
    name: 'add_cash',
    description: 'Cashbook (galla) money that is NO customer\'s: shop expenses and cash put in or taken out ("aaj 500 ka maal kharida", "bijli 800", "galle mein 2000 daale"). Never for a named customer or supplier.',
    parameters: obj({
      amount: { type: 'number', description: 'rupees, exactly as said' },
      dir: { type: 'string', enum: ['in', 'out'], description: 'in = into the cash box, out = spent / taken out' },
      category: { type: 'string', enum: [...CASH_CATEGORIES], description: 'stock (goods bought), bills (electricity, phone), rent, wages, personal, other when unsure' },
      note: { ...STR, description: 'a few words of what it was for' },
      day_offset: { ...INT, description: 'omit for today; -1 yesterday' },
      sure: { type: 'boolean', description: 'false when any part is a guess' },
    }, ['amount', 'category']),
  },
  { name: 'set_tag', description: 'Give a customer a nickname that tells two people with one name apart ("purane Ramesh ko doodhwala bolo").', parameters: obj({ name: STR, tag: STR }, ['name', 'tag']) },
  { name: 'set_language', description: 'Change the language the app speaks.', parameters: obj({ lang: { type: 'string', enum: [...LANGS] } }, ['lang']) },
  {
    name: 'set_speed', description: 'How fast the app speaks: slower ("dheere bolo"), normal again, or faster ("tez bolo").',
    parameters: obj({ speed: { type: 'string', enum: ['slower', 'normal', 'faster'] } }, ['speed']),
  },
  { name: 'set_shop_name', description: 'Set the shop\'s name.', parameters: obj({ name: STR }, ['name']) },
  { name: 'open_privacy', description: 'Where the data goes, is this an AI, how it works.', parameters: obj({}) },
  { name: 'backup', description: 'Make a backup file of the ledger.', parameters: obj({}) },
  { name: 'erase_all', description: 'Erase all data (the shopkeeper must then type the word on screen; a spoken yes never erases).', parameters: obj({}) },
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
/** a due date must have been said: "tak", "by", "till", a date word */
const DUE_HEARD = /(^|[\s,])(tak|takk|tarikh|taarikh|till|until|by|before|within|mein|me)([\s,.?!]|$)|तक|तारीख|में|ವರೆಗೆ|ಒಳಗೆ|ತಾರೀಖು|வரை|க்குள்|தேதி|వరకు|లోపు|తేదీ|വരെ|ക്കകം|पर्यंत|তারিখ|পর্যন্ত|মধ্যে|સુધી|ਤੱਕ/i
/** "naya / doosra Ramesh": a second person with a name the ledger has */
const NEW_HEARD = /(^|\s)(naya|nayi|naye|doosra|dusra|doosri|dusri|new|another|second)(\s|$)|नया|नई|दूसरा|दूसरी|ಹೊಸ|ಇನ್ನೊಬ್ಬ|புதிய|இன்னொரு|కొత్త|ఇంకో|പുതിയ|മറ്റൊരു|नवीन|দূসরা|নতুন|আরেক|નવા|બીજા|ਨਵਾਂ|ਦੂਜਾ/i
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
/** The pay-by day the model read (offset, weekday or date of the month), as YYYY-MM-DD in India. */
function dueFrom(e: Record<string, unknown>): string | undefined {
  const off = int(e.due_offset)
  if (off !== null && off >= 1 && off <= 120) return istDay(off)
  const wd = typeof e.due_weekday === 'string' ? WEEKDAYS.indexOf(e.due_weekday) : -1
  if (wd >= 0) {
    const now = new Date(Date.now() + 5.5 * 3600_000).getUTCDay()
    return istDay(((wd - now + 7) % 7) || 7)
  }
  const date = int(e.due_date)
  if (date !== null && date >= 1 && date <= 31) {
    const t = istDay(0)
    const [y, m, d] = t.split('-').map(Number)
    const pick = (yy: number, mm: number) => {
      const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate()
      return `${yy}-${String(mm).padStart(2, '0')}-${String(Math.min(date, last)).padStart(2, '0')}`
    }
    return date > d ? pick(y, m) : m === 12 ? pick(y + 1, 1) : pick(y, m + 1)
  }
  return undefined
}
const EVERY = { day: 1, week: 7, month: 30 } as const

/** The sentence the tool was called for, and every language stream's reading of it (when there are several). */
/**
 * `fromAudio`: the reading came from the model hearing the audio, not from the transcripts. Honoured by
 * add_entries (read back, amounts may come from the audio), change_entry (asked first) and
 * answer_question (refused: an open question is answered only from heard text).
 */
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

/** Does something heard pick on-screen option `idx` (`value`) of the open question? */
function optionHeard(core: LedgerCore, idx: number, value: string, heard: string[]): boolean {
  const p = core.pending
  if (!p) return false
  switch (p.kind) {
    case 'confusable': {
      const amt = Number(value)
      return Number.isFinite(amt) && heard.some((t) => parseAmounts(t).some((a) => a.value === amt))
    }
    case 'choose':
      return heard.some((t) => LedgerCore.chooseIndex(p.options, t) === idx)
    case 'which': {
      const opts: ChooseOption[] = core.whichOptions(p.options)
      return heard.some((t) => LedgerCore.chooseIndex(opts, t) === idx)
    }
    default:
      return false
  }
}

/** Timbre speed for each set_speed choice */
const SPEED = { slower: 0.8, normal: 1, faster: 1.2 } as const

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
    // a name as the agent's list shows it ("Ramesh (doodhwala)", "Gupta [supplier]") or a label ("Ramesh 2")
    const listed = core.fromListName(name)
    if (listed) return listed
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
      ...options.map((c) => ({ label: core.label(c), name: c.name, rupees: c.balancePaise / 100, id: c.cid, ...(c.tag ? { tag: c.tag } : {}), args: { ...a, [`${slot}__cid`]: c.cid } })),
      ...extra,
    ]
    const labels = opts.map((o) => o.label)
    const ask = labels.length === 1 ? `${labels[0]}?` : R.askWhich(labels.slice(0, -1).join(', '), labels[labels.length - 1])
    core.pending = { kind: 'choose', ask, tool: call.name, transcript: text, options: opts }
    return speak(ask)
  }
  /** resolve, or the reply to give instead: not found / which one */
  // `offer`: a name not in the ledger offers to open their khata (and a near miss gets a "+ new" choice);
  // rename / merge keep a plain "not found"
  const need = (slot: string, exact = false, offer = true): SnapCustomer | Reply => {
    const r = resolve(slot, exact)
    const name = str(a[slot])
    if (Array.isArray(r)) {
      const fresh = offer && name && !str(a[`${slot}__cid`]) && !r.some((c) => c.name.toLowerCase() === name.toLowerCase())
      const newName = name ? titleCase(name) : ''
      return askWhich(slot, r, fresh ? [{ label: `+ ${newName}`, name: newName, tool: 'add_customer', args: { name: newName, _new: true } }] : [])
    }
    if (r) return r
    if (!name) return notCaught()
    return offer ? core.offerNewCustomer(name, text, tm) : speak(R.notFound(name))
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
  // customers who owe the shop: suppliers (the shop owes them) never
  const owing = () => core.snap.customers.filter((c) => c.kind !== 'supplier' && c.balancePaise > 0).sort((x, y) => y.balancePaise - x.balancePaise)
  const S = sayShop(lang)
  const balanceOf = (c: SnapCustomer) => (c.kind === 'supplier' ? S.supplierBalance(c.name, c.balancePaise / 100) : R.balance(core.spokenName(c), c.balancePaise / 100))
  const duesReply = (): Reply => {
    const o = owing()
    const show = { type: 'show', view: 'dues' } as const
    if (!o.length) return { parts: [R.noDues()], ops: [], show }
    return { parts: [R.showDues(o.length, o.reduce((s, c) => s + c.balancePaise, 0) / 100)], ops: [], show }
  }

  // the audio re-ask is for unclear ledger speech: a guess from noise ("771." -> search) may only
  // become a read-back entry or correction, never open a screen, search, or change a setting
  if (meta.fromAudio && !['add_entries', 'change_entry', 'unclear', 'not_for_me', 'answer_question'].includes(call.name)) return notCaught()

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
      // what the model added to each line (due date, items, supplier, a new twin), only when the words say it
      const rawEntries = (Array.isArray(a.entries) ? a.entries : []) as Record<string, unknown>[]
      const used = new Set<number>()
      const dueSaid = heard.some((t) => DUE_HEARD.test(t))
      const newSaid = heard.some((t) => NEW_HEARD.test(t))
      for (const e of intent.entries) {
        const i = rawEntries.findIndex((x, k) => !used.has(k) && x && x.amount === e.amount.value && (str(x.name) ?? null) === e.name)
        if (i < 0) continue
        used.add(i)
        const x = rawEntries[i]
        const extra: EntryExtras = {}
        const due = dueSaid && e.direction === 'credit' && !e.promise ? dueFrom(x) : undefined
        if (due) extra.due = due
        const items = Array.isArray(x.items) ? x.items.map(str).filter((v): v is string => !!v && v.length <= 40).slice(0, 12) : []
        if (items.length) extra.note = items.join(', ')
        if (x.party === 'supplier' && e.name && !core.lookup(e.name)) extra.supplier = true
        if (x.new_customer === true && newSaid && e.name && core.snap.customers.some((c) => c.name.toLowerCase() === e.name!.toLowerCase())) extra.forceNew = true
        Object.assign(e, extra)
      }
      // the same customer + amount + direction as an entry written in the last 60 s: the model
      // repeating itself (or a re-read of one sentence) is not a second entry. Saying it plainly
      // again takes the instant path, which still writes.
      const dup = (e: (typeof intent.entries)[number]): SnapCustomer | null => {
        const c = e.name ? core.lookup(e.name) : null
        if (!c || e.promise || !e.direction) return null
        const same = entries.some((x) => x.cid === c.cid && !x.promise && x.direction === e.direction &&
          x.paise === Math.round(e.amount.value * 100) && core.wroteRecently(x.eid, WRITTEN_KEEP_MS))
        return same ? c : null
      }
      const dups = intent.entries.filter((e) => dup(e))
      if (dups.length) {
        const said = dups.map((e) => R.alreadyWritten(dup(e)!.name, e.amount.value))
        const rest = intent.entries.filter((e) => !dup(e))
        if (!rest.length) return speak(...said)
        const r = core.addEntries({ ...intent, entries: rest }, text, tm)
        return { ...r, parts: [...said, ...r.parts] }
      }
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
      const newAmount = num(a.new_amount)
      const intent = validate(text, reading, meta.fromAudio && newAmount != null ? [...contextAmounts, newAmount] : contextAmounts, entries.length)
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
      const newName = titleCase(name)
      // "Ramesh 300 ka khata (kholo)": the amount belongs to this khata. Read back with the entry (credit
      // when no direction was said), so a yes opens the khata and writes the 300 together
      const said = parseFast(text)
      if (said.type === 'entries' && said.entries.length === 1 && said.entries[0].amount) {
        const e = said.entries[0]
        e.name = same && !a._new && !heard.some((t) => NEW_HEARD.test(t)) ? same.name : newName
        if (!e.direction && !e.promise) e.direction = 'credit'
        if (same && e.name === newName && (a._new === true || heard.some((t) => NEW_HEARD.test(t)))) Object.assign(e, { forceNew: true })
        return core.addEntries(said, text, tm)
      }
      // "naya / doosra Ramesh": a second Ramesh, read back, then asked for a nickname
      if (same && heard.some((t) => NEW_HEARD.test(t))) {
        const cid = core.freshId()
        core.pending = {
          kind: 'modify', ops: [{ op: 'add_customer', cid, name: newName }], done: R.customerAdded(newName), focus: cid,
          view: { kind: 'modify', name: newName, newCustomer: true },
          then: { pending: { kind: 'nickname', cid, name: newName }, ask: S.nicknameAsk(newName) },
        }
        return speak(M.addAsk(newName))
      }
      if (same) return speak(R.showCustomer(same.name, same.balancePaise / 100, lastOf(same.cid)))
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
      const c = need('name', true, false)
      if (isReply(c)) return c
      const to = str(a.new_name)
      if (!to || to.length > 40 || to === c.name) return notCaught()
      return { parts: [R.renamed(c.name, titleCase(to))], ops: [{ op: 'rename_customer', cid: c.cid, name: titleCase(to) }] }
    }
    case 'merge_customers': {
      const from = need('name', false, false)
      if (isReply(from)) return from
      const into = need('into', false, false)
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
      if (c.kind === 'supplier') return speak(S.noSupplierReminder(c.name))
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
      if (c.kind === 'supplier') return speak(S.noSupplierReminder(c.name))
      if (!c.remindersOptIn || !c.adult) return speak(R.noConsent(c.name))
      const lines = entries.filter((e) => e.cid === c.cid && !e.promise).slice(0, 10)
        .map((e) => `${e.day}  ${e.direction === 'credit' ? '+' : '-'}₹${formatINR(e.paise / 100)}`)
      const body = guardReply([core.snap.shopName, R.balance(c.name, c.balancePaise / 100), ...lines].join('\n'))
      if (!body) return notCaught()
      core.focusCid = c.cid
      return { parts: [R.statementReady(c.name)], ops: [], ready: { kind: 'whatsapp', cid: c.cid, text: body } }
    }
    case 'show_qr': {
      // a QR for the customer at the counter: the amount said, else the whole balance. Nothing is
      // written; the payment books itself when it lands (webhook -> pending -> announce).
      const c = need('name')
      if (isReply(c)) return c
      // the shop pays suppliers; it never collects from them
      if (c.kind === 'supplier') return speak(sayPay(lang).qrSupplier(c.name))
      const said = num(a.amount)
      let paise: number
      if (said !== null) {
        paise = Math.round(said * 100)
        // like any amount: it must have been heard, or be exactly the balance
        const heardIt = heard.some((t) => parseAmounts(t).some((x) => Math.round(x.value * 100) === paise))
        if (!heardIt && paise !== c.balancePaise) return notCaught()
      } else paise = c.balancePaise
      if (paise <= 0) return speak(R.balance(c.name, c.balancePaise / 100))
      if (paise < 100) return notCaught()
      core.focusCid = c.cid
      return { parts: [sayPay(lang).qrReady(c.name, paise / 100)], ops: [], ready: { kind: 'qr', cid: c.cid, paise } }
    }
    case 'erase_all':
      // only the typed word erases (LedgerCore.answerPending)
      core.pending = { kind: 'delete', requireType: eraseWord(lang) }
      return speak(R.eraseType(eraseWord(lang)))

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
      const part = c.kind === 'supplier' ? balanceOf(c)
        : call.name === 'show_customer' ? R.showCustomer(core.spokenName(c), c.balancePaise / 100, lastOf(c.cid)) : R.balance(core.spokenName(c), c.balancePaise / 100)
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
      // a customer alone: their page; a day (with or without a customer): the entries of that day
      const show: Reply['show'] = c && !dayStr ? { type: 'show', view: 'customer', cid: c.cid }
        : { type: 'show', view: 'history', from: dayStr ?? istDay(0), to: dayStr ?? istDay(0), ...(c ? { cid: c.cid } : {}) }
      return { parts: [R.showHistory(label, list.length)], ops: [], show }
    }
    case 'show_today': {
      // "aaj ka hisaab": credit and payments, new customers, the largest dues, today's promises, the galla
      const t = core.snap.today
      const today = istDay(0)
      const promised = [...new Set(entries.filter((e) => e.promise && e.day === today).map((e) => e.cid))]
        .map((cid) => core.snap.customers.find((c) => c.cid === cid)).filter((c): c is SnapCustomer => !!c).map((c) => core.spokenName(c))
      const text = S.dailySummary({
        credit: t.creditPaise / 100, paid: t.paymentPaise / 100, newCustomers: t.newCustomers ?? 0,
        top: owing().slice(0, 3).map((c) => ({ name: core.spokenName(c), amt: c.balancePaise / 100 })),
        promises: promised.slice(0, 5),
        ...(t.cashIn ? { cashIn: t.cashIn / 100 } : {}), ...(t.cashOut ? { cashOut: t.cashOut / 100 } : {}),
      })
      return { parts: [guardReply(text) ?? R.showToday(t.creditPaise / 100, t.paymentPaise / 100)], ops: [], show: { type: 'show', view: 'today' } }
    }
    case 'show_overdue': {
      const days = Math.min(365, Math.max(1, int(a.days) ?? 30))
      const today = istDay(0)
      const old = owing().filter((c) => c.oldestDay && daysBetween(c.oldestDay, today) > days)
      const show = { type: 'show', view: 'overdue', days } as const
      if (!old.length) return { parts: [S.noOverdue(days)], ops: [], show }
      const total = old.reduce((t, c) => t + c.balancePaise, 0) / 100
      return { parts: [S.overdueList(old.length, days, total, old.slice(0, 3).map((c) => core.spokenName(c)))], ops: [], show }
    }
    case 'collect_today': {
      const rows = collectFrom(core.snap.customers.map((c) => ({
        cid: c.cid, balancePaise: c.balancePaise, kind: c.kind, oldestDay: c.oldestDay, dueDay: c.dueDay, promiseDay: c.promiseDay,
      })), istDay(0))
      const show = { type: 'show', view: 'collect' } as const
      if (!rows.length) return { parts: [S.nothingToCollect()], ops: [], show }
      const nameOf = (cid: string) => { const c = core.snap.customers.find((x) => x.cid === cid); return c ? core.spokenName(c) : '' }
      return { parts: [S.collectToday(rows.length, rows.reduce((t, r) => t + r.paise, 0) / 100, rows.slice(0, 3).map((r) => nameOf(r.cid)))], ops: [], show }
    }
    case 'set_plan': {
      const c = need('name')
      if (isReply(c)) return c
      if (c.kind === 'supplier') return speak(S.noSupplierReminder(c.name))
      if (c.balancePaise <= 0) return speak(R.balance(c.name, c.balancePaise / 100))
      // every number said, whole or word by word ("3000 teen hafte" reads as one 3003 and as 3000 + 3)
      const saidAmounts = heard.flatMap((t) => [
        ...parseAmounts(t).flatMap((x) => [x.value, ...x.alternatives]),
        ...t.split(/ +/).flatMap((w) => parseAmounts(w).map((x) => x.value)),
      ])
      const heardIt = (rs: number) => saidAmounts.includes(rs)
      const totalRs = num(a.total)
      const partRs = num(a.part_amount)
      let parts = int(a.parts)
      // every amount and the number of parts only as said (the whole balance needs no number)
      if (totalRs !== null && !heardIt(totalRs) && Math.round(totalRs * 100) !== c.balancePaise) return notCaught()
      if (partRs !== null && !heardIt(partRs)) return notCaught()
      if (parts !== null && !heardIt(parts)) return notCaught()
      const totalPaise = totalRs !== null ? Math.round(totalRs * 100) : c.balancePaise
      if (totalPaise <= 0) return notCaught()
      if (totalPaise > c.balancePaise) return speak(R.balance(c.name, c.balancePaise / 100))
      if (parts === null && partRs !== null && partRs > 0) parts = Math.ceil(totalPaise / Math.round(partRs * 100))
      if (parts === null || parts < 1 || parts > 52) return notCaught()
      const everyDays = a.every === 'day' || a.every === 'week' || a.every === 'month' ? EVERY[a.every] : 7
      const partPaise = Math.floor(totalPaise / parts)
      if (partPaise < 100) return notCaught()
      core.pending = {
        kind: 'modify', focus: c.cid,
        ops: [{ op: 'set_plan', cid: c.cid, pid: core.freshId(), totalPaise, parts, everyDays, startOffset: everyDays }],
        done: S.planSet(core.spokenName(c), partPaise / 100, everyDays),
        view: { kind: 'modify', name: core.label(c), paise: totalPaise },
      }
      return speak(S.planAsk(core.spokenName(c), totalPaise / 100, parts, partPaise / 100, everyDays))
    }
    case 'cancel_plan': {
      const c = need('name')
      if (isReply(c)) return c
      if (!c.plan) return speak(S.noPlan(core.spokenName(c)))
      core.pending = {
        kind: 'modify', focus: c.cid, ops: [{ op: 'cancel_plan', cid: c.cid, pid: c.plan.pid }],
        done: S.planCancelled(core.spokenName(c)), view: { kind: 'modify', name: core.label(c) },
      }
      return speak(S.planCancelAsk(core.spokenName(c)))
    }
    case 'add_cash': {
      const amt = num(a.amount)
      if (amt === null || amt <= 0 || !heard.some((t) => parseAmounts(t).some((x) => x.value === amt))) return notCaught()
      const category: CashCategory = (CASH_CATEGORIES as readonly string[]).includes(a.category as string) ? a.category as CashCategory : 'other'
      // spending categories go out of the galla; "other" needs the direction said
      const dir: 'in' | 'out' | null = a.dir === 'in' || a.dir === 'out' ? a.dir : category !== 'other' ? 'out' : null
      if (!dir) return notCaught()
      const note = str(a.note)?.slice(0, 60)
      const dayOffset = Math.max(-30, Math.min(0, int(a.day_offset) ?? 0))
      const op = { op: 'cash' as const, eid: core.freshId(), paise: Math.round(amt * 100), dir, category, ...(note ? { note } : {}), dayOffset }
      // a customer named in the sentence: their line wins, so this is only read back, never written at once
      const named = heard.some((t) => !!core.knownWithin(t))
      if (a.sure === false || named) {
        core.pending = { kind: 'modify', focus: core.focusCid ?? '', ops: [op], done: S.cashSaved(amt, dir, category), view: { kind: 'modify', name: S.category(category), paise: op.paise } }
        return speak(S.cashAsk(amt, dir, category))
      }
      return { parts: [S.cashSaved(amt, dir, category)], ops: [op] }
    }
    case 'set_tag': {
      const c = need('name')
      if (isReply(c)) return c
      const raw = str(a.tag)
      const tag = raw ? cleanTag(raw) : ''
      // the nickname must have been said
      if (!tag || !heard.some((t) => LedgerCore.mentions(t, tag))) return notCaught()
      core.focusCid = c.cid
      return { parts: [S.tagSet(c.name, tag)], ops: [{ op: 'set_tag', cid: c.cid, tag }] }
    }
    case 'search': {
      const q = str(a.text)
      if (!q) return notCaught()
      const found = core.candidates(q).map((x) => x.c)
      const amounts = (q.match(/\d+(\.\d+)?/g) ?? []).map((x) => Math.round(Number(x) * 100))
      // "Ramesh 200": Ramesh's 200 entries; "200": every 200 entry; "Ramesh": the customer
      const hits = amounts.length ? entries.filter((e) => amounts.includes(e.paise) && (!found.length || found.some((c) => c.cid === e.cid))) : []
      const count = amounts.length ? hits.length : found.length
      const reply: Reply = { parts: [R.searchResult(q, count)], ops: [] }
      if (!count) return reply // nothing found: say so, don't open an empty screen
      reply.show = found.length === 1 && !hits.length ? { type: 'show', view: 'customer', cid: found[0].cid } : { type: 'show', view: 'search', text: q, cids: found.map((x) => x.cid), eids: hits.map((e) => e.eid) }
      return reply
    }
    case 'top_debtors': {
      const n = Math.min(5, Math.max(1, int(a.count) ?? 3))
      return { parts: [R.topDebtors(owing().slice(0, n).map((c) => core.spokenName(c)))], ops: [], show: { type: 'show', view: 'top_debtors', count: n } }
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
    case 'set_speed': {
      const speed = a.speed === 'slower' || a.speed === 'normal' || a.speed === 'faster' ? a.speed : null
      if (!speed) return notCaught()
      return { parts: [R.speedSet(speed)], ops: [], setting: { type: 'setting', key: 'speed', value: SPEED[speed] } }
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
      if (meta.fromAudio) return notCaught() // the audio reading never answers a question; the card stays open
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
      // an option from the model only when it is exactly one on screen and what was heard picks it:
      // on a confusable card the model must not choose the amount, on a which card not the customer
      const idx = kind === 'option' && value ? view?.options?.indexOf(value) ?? -1 : -1
      if (idx >= 0) {
        if (!optionHeard(core, idx, value!, heard)) return notCaught()
        return core.answerPending(value!, { type: 'unknown' }, tm) ?? notCaught()
      }
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
