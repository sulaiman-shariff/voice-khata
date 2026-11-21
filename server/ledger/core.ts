/**
 * The ledger core: the safety layer between what was heard and what is written. Drafts, the
 * read-back questions (confirm / name / amount / direction / which / batch / modify / delete),
 * name resolution, and applying ops to the local snapshot. Nothing here touches audio, STT,
 * the model or the network, so a voice agent's tools can call it as well as the turn loop.
 */
import { type Direction, type EntryIntent, type Intent, directionAnswer, mentionsMoney, mentionsSettle, nameAnswer, refersBack } from '../../shared/intent.js'
import { NAME_NEAR, NAME_SURE, matchName } from '../../shared/names.js'
import { parseAmounts } from '../../shared/numbers.js'
import type { LedgerOp, PendingView, ServerMsg, SettingMsg, SnapCustomer, SnapEntry, Snapshot } from '../../shared/protocol.js'
import { type Lang, LOCALE, say, sayMore } from '../../shared/replies.js'
import type { Logger } from '../log.js'

const ANOMALY_FACTOR = 5
/** with no history for the customer, ₹10,000 or more is read back first */
const BIG_PAISE = 10_000_00
export const PENDING_TTL_MS = 45_000
/** how long an entry written in this session is remembered for an instant undo */
export const WRITTEN_KEEP_MS = 60_000
const AMOUNT_FLAGS = new Set(['confusable', 'elided_scale', 'approx_range', 'bare_fraction', 'digit_sequence'])

/** How the turn being handled was heard: noise level, and whether the fast parser or the model read it. */
export type TurnMeta = { snrDb: number | null; noisy: boolean; path: 'fast' | 'llm' }
export type ShowMsg = Extract<ServerMsg, { type: 'show' }>

export interface Draft {
  heardName: string | null
  cid: string | null
  newName: string | null // set when this entry creates a customer
  nameSure: boolean
  /** the shopkeeper already said yes to a read-back that named this line (a list question) */
  confirmed?: boolean
  /** this line was read back on its own and the shopkeeper said yes */
  readBack?: boolean
  /** heard, not typed: a name in it may be a mishearing, so a new account is read back first */
  spoken: boolean
  /** the turn had only this one line: a known customer named anywhere in it is this line's customer */
  single?: boolean
  paise: number
  alt: number | null // confusable alternative, rupees
  direction: Direction | null
  dayOffset: number
  promise: boolean
  confidence: 'high' | 'low'
  reasons: string[]
  path: 'fast' | 'llm'
  transcript: string
  snrDb: number | null
  noisy: boolean
}

export type Pending =
  | { kind: 'confirm' | 'name' | 'amount' | 'direction' | 'confusable'; draft: Draft; queue: Draft[] }
  | { kind: 'which'; draft: Draft; queue: Draft[]; options: SnapCustomer[] }
  /**
   * Erase everything. With requireType (the agent's erase_all) only the typed word erases;
   * a spoken or tapped yes never does. Without it, a yes erases (the old flow).
   */
  | { kind: 'delete'; requireType?: string }
  /** one question for a list that shared a single direction word */
  | { kind: 'batch'; drafts: Draft[] }
  /**
   * read-back before changing or removing an older entry (also merge, move, and a reminder):
   * on a yes the ops are written, `done` is said, and `ready` (if any) goes to the phone
   */
  | { kind: 'modify'; ops: LedgerOp[]; done: string; view: PendingView; focus: string; ready?: Reply['ready'] }
  /**
   * "Which one?" for an agent tool (two customers fit a name): the chosen option's args finish the
   * original tool call through the `choose` hook, against the sentence that asked for it.
   */
  | { kind: 'choose'; ask: string; tool: string; transcript: string; options: ChooseOption[]; reasked?: number }

export interface ChooseOption {
  /** shown on screen and matched exactly when tapped */
  label: string
  /** the customer's name, matched when spoken */
  name: string
  /** the customer's balance in rupees: "the 300 one" */
  rupees?: number
  /** the tool's args with this option filled in */
  args: Record<string, unknown>
}

interface SavedState {
  v: 1
  at: number
  lang: Lang
  pending: Pending | null
  pendingAgeMs: number
  focusCid: string | null
  history: string[]
}

export interface Reply {
  parts: string[]
  ops: LedgerOp[]
  /** entries saved in this reply, and how many of them may be confirmed with a short ack */
  saved?: number
  ackable?: number
  /** a screen the phone should show with this reply */
  show?: ShowMsg
  /** a setting changed by voice, for the phone to apply */
  setting?: SettingMsg
  /** something ready for the shopkeeper to send or save with one tap (nothing is sent by the server) */
  ready?: { kind: 'whatsapp' | 'backup'; cid?: string; text?: string }
  /** heard, and taken as talk to someone else: nothing said, nothing written */
  notForMe?: true
}

export interface LedgerDeps {
  lang: () => Lang
  now: () => number
  newId: () => string
  log: Logger
  /** a customer was added to the local snapshot (the recogniser's name hints are now stale) */
  onCustomerAdded?: () => void
}

export class LedgerCore {
  snap: Snapshot = {
    shopName: 'Shop', customers: [], last: null, entries: [],
    today: { creditPaise: 0, paymentPaise: 0, entries: 0 }, month: { creditPaise: 0, paymentPaise: 0, entries: 0 },
  }
  private _pending: Pending | null = null
  /** The open question. Setting a new one stamps `pendingAt`, so every question expires on time, whoever asked it. */
  get pending(): Pending | null { return this._pending }
  set pending(p: Pending | null) {
    if (p && p !== this._pending) this.pendingAt = this.now()
    this._pending = p
  }
  /** the customer the conversation is about right now */
  focusCid: string | null = null
  /** where the turn being handled came from (taps and typed text arrive as 'tap') */
  turnSrc: 'voice' | 'tap' | 'resend' = 'voice'
  /** when the open question was asked: stale questions expire */
  pendingAt = 0
  /** last few turns, for the model and for "uska / him / same" */
  history: string[] = []
  /**
   * Handles a fresh instruction that arrives while a question is open ("a fresh, complete
   * instruction replaces the question"). Set by whoever owns the dialogue (Session).
   */
  dispatch: (intent: Intent, text: string, meta: TurnMeta) => Reply | null = (intent, text, meta) => {
    // the ledger part of a fresh instruction; Session replaces this with its full dialogue
    switch (intent.type) {
      case 'entries': return this.addEntries(intent, text, meta)
      case 'modify': return this.modifyEntry(intent)
      case 'correct': return this.correctLast(intent)
      default: return null
    }
  }
  /**
   * Saves are spoken as one sentence with the customer's new balance (savedWithBalance) instead
   * of the short read-back. The agent's tools turn this on for the duration of a tool call.
   */
  sayBalance = false
  /** Finishes an agent tool once a `choose` question is answered (set by server/agent/tools.ts). */
  choose: (tool: string, args: Record<string, unknown>, transcript: string, meta: TurnMeta) => Reply | null = () => null
  /** when each entry was written in this session (eid -> ms): only these can be undone without a question */
  writtenAt = new Map<string, number>()
  /** was this entry written in this session, within the last `ms`? */
  wroteRecently(eid: string, ms: number): boolean {
    const t = this.writtenAt.get(eid)
    return t !== undefined && this.deps.now() - t <= ms
  }
  /**
   * What each language stream heard as an amount this turn (rupees). When they disagree on a
   * single entry, the other value becomes the draft's `alt` and the shopkeeper is asked which.
   */
  heardAmounts: number[] = []

  constructor(private deps: LedgerDeps) {}

  /** Drop an open question older than PENDING_TTL_MS (the shopkeeper moved on). True if one was dropped. */
  expireStale(): boolean {
    if (!this._pending || this.now() - this.pendingAt <= PENDING_TTL_MS) return false
    this.log.info('pending_expired', { kind: this._pending.kind, ageMs: this.now() - this.pendingAt })
    this._pending = null
    return true
  }

  private get log(): Logger { return this.deps.log }
  /** the language replies are spoken in right now */
  get lang(): Lang { return this.deps.lang() }
  private get now(): () => number { return this.deps.now }
  private get newId(): () => string { return this.deps.newId }
  /** a fresh id for a customer or entry */
  freshId(): string { return this.deps.newId() }

  /**
   * The state a new session needs to carry on after a dropped or swapped connection: the open
   * question (with its drafts), who the conversation is about, the last few lines and the
   * language. The phone keeps the latest blob and hands it back in its next hello.
   */
  exportState(): string {
    const st: SavedState = {
      v: 1, at: Date.now(), lang: this.lang, pending: this.pending,
      pendingAgeMs: this.pending ? this.now() - this.pendingAt : 0,
      focusCid: this.focusCid, history: this.history.slice(-6),
    }
    return Buffer.from(JSON.stringify(st)).toString('base64url')
  }

  /** Restore what exportState() wrote; anything malformed or stale is ignored. */
  importState(blob: string) {
    try {
      if (blob.length > 64_000) throw new Error('too large')
      const st = JSON.parse(Buffer.from(blob, 'base64url').toString()) as SavedState
      if (st?.v !== 1 || typeof st.at !== 'number') throw new Error('bad version')
      const age = Date.now() - st.at
      if (Array.isArray(st.history)) this.history = st.history.filter((h): h is string => typeof h === 'string').slice(-8)
      if (typeof st.focusCid === 'string' || st.focusCid === null) this.focusCid = st.focusCid
      const pendingAge = age + (typeof st.pendingAgeMs === 'number' ? st.pendingAgeMs : 0)
      const kinds = ['confirm', 'name', 'direction', 'confusable', 'which', 'delete', 'batch', 'modify', 'choose']
      const pendingOk = !!st.pending && typeof st.pending === 'object' && kinds.includes((st.pending as { kind?: string }).kind ?? '')
      if (pendingOk && pendingAge < PENDING_TTL_MS) {
        this.pending = st.pending
        this.pendingAt = this.now() - pendingAge
      }
      this.log.info('resume', { ageMs: age, pending: pendingOk ? (st.pending as { kind: string }).kind : null, restored: !!this.pending, history: this.history.length })
    } catch (e) {
      this.log.warn('resume_ignored', { error: e })
    }
  }

  nameOf(cid: string): string {
    return this.snap.customers.find((c) => c.cid === cid)?.name ?? '?'
  }

  batchItems(drafts: Draft[]) {
    return drafts.map((d) => ({
      name: d.cid ? this.nameOf(d.cid) : d.heardName ? titleCase(d.heardName) : '?',
      amt: d.paise / 100,
    }))
  }

  /** Change or remove any recent entry. The newest one changes at once (like "nahi, 430"); older ones are read back first. */
  modifyEntry(intent: Extract<Intent, { type: 'modify' }>, opts: { ask?: boolean } = {}): Reply {
    const R = say(this.lang)
    const M = sayMore(this.lang)
    const e = (this.snap.entries ?? [])[intent.ref - 1]
    if (!e) return { parts: [R.didNotCatch()], ops: [] }
    const oldName = this.nameOf(e.cid)
    if (intent.remove) {
      const ops: LedgerOp[] = [{ op: 'void', eid: e.eid, reason: 'spoken remove' }]
      const done = M.removed(oldName, e.paise / 100)
      if (intent.ref === 1 && !opts.ask) return { parts: [done], ops }
      this.pending = { kind: 'modify', ops, done, focus: e.cid, view: { kind: 'modify', remove: true, name: oldName, paise: e.paise, direction: e.direction } }
      return { parts: [M.removeAsk(oldName, e.paise / 100, e.direction)], ops: [] }
    }
    const ops: LedgerOp[] = []
    const amend: Extract<LedgerOp, { op: 'amend' }> = { op: 'amend', eid: e.eid }
    if (intent.amount && Math.round(intent.amount.value * 100) !== e.paise) amend.paise = Math.round(intent.amount.value * 100)
    if (intent.direction && intent.direction !== e.direction) amend.direction = intent.direction
    let name = oldName
    if (intent.name) {
      const c = this.lookup(intent.name)
      if (c && c.cid !== e.cid) {
        amend.cid = c.cid
        name = c.name
      } else if (!c) {
        const cid = this.newId()
        name = titleCase(intent.name)
        ops.push({ op: 'add_customer', cid, name })
        amend.cid = cid
      }
    }
    if (amend.paise === undefined && !amend.direction && !amend.cid) return { parts: [R.didNotCatch()], ops: [] }
    ops.push(amend)
    const paise = amend.paise ?? e.paise
    const dir = amend.direction ?? e.direction
    const done = R.corrected(name, paise / 100, dir)
    const focus = amend.cid ?? e.cid
    const opens = ops.some((o) => o.op === 'add_customer') && this.turnSrc !== 'tap'
    if (intent.ref === 1 && !opens && !opts.ask) {
      this.focusCid = focus
      return { parts: [done], ops }
    }
    this.pending = { kind: 'modify', ops, done, focus, view: { kind: 'modify', name, paise, direction: dir, newCustomer: opens || undefined } }
    return { parts: [opens ? R.confirmNew(name, paise / 100, dir) : M.changeAsk(name, paise / 100, dir)], ops: [] }
  }
  draftFrom(e: EntryIntent, transcript: string, meta: TurnMeta): Draft {
    let alt = e.reasons.includes('confusable') && e.amount.alternatives.length ? e.amount.alternatives[0] : null
    const reasons = [...e.reasons]
    return {
      heardName: e.name,
      cid: null,
      newName: null,
      nameSure: false,
      paise: Math.round(e.amount.value * 100),
      alt,
      direction: e.direction,
      dayOffset: e.dayOffset,
      promise: e.promise,
      confidence: e.confidence,
      reasons,
      path: meta.path,
      transcript,
      snrDb: meta.snrDb,
      noisy: meta.noisy,
      spoken: this.turnSrc !== 'tap',
    }
  }

  /**
   * A fresh list of entries: drafts in order, the same line twice is one, "uska 100 aur" is the
   * customer just talked about, and one direction word for a whole list is asked once.
   */
  addEntries(intent: Extract<Intent, { type: 'entries' }>, text: string, meta: TurnMeta): Reply {
    // the same line twice in a row (said twice, or returned twice by the model) is one entry
    const drafts = intent.entries.map((e) => this.draftFrom(e, text, meta))
      .filter((d, i, a) => i === 0 || !(d.heardName && d.heardName.toLowerCase() === a[i - 1].heardName?.toLowerCase() &&
        d.paise === a[i - 1].paise && d.direction === a[i - 1].direction))
    if (drafts.length === 1) {
      drafts[0].single = true
      const d = drafts[0]
      const other = this.heardAmounts.find((v) => v > 0 && Math.round(v * 100) !== d.paise)
      if (d.alt === null && other !== undefined) {
        d.alt = other
        d.reasons.push('streams-differ')
      }
    }
    // "uska 100 aur" / "usko 50 udhaar": the customer we were just talking about
    if (this.focusCid && refersBack(text))
      for (const d of drafts)
        if (!d.heardName && !d.cid) {
          d.cid = this.focusCid
          d.nameSure = true
          d.reasons = [...d.reasons.filter((r) => r !== 'no-name'), 'from-context']
          if (d.reasons.every((r) => r === 'from-context')) d.confidence = 'high'
        }
    // one direction word for a whole list: ask once ("all credit?") rather than guess for each
    if (drafts.length > 1 && drafts.some((d) => d.reasons.includes('dir-shared'))) {
      this.pending = { kind: 'batch', drafts }
      return { parts: [sayMore(this.lang).batchAsk(this.batchItems(drafts), drafts.find((d) => d.direction)!.direction!)], ops: [] }
    }
    return this.processDrafts(drafts, { parts: [], ops: [] })
  }

  /** Customer lookup for queries: best match at NEAR or better. */
  lookup(name: string): SnapCustomer | null {
    const m = matchName(name, this.snap.customers.map((c) => ({ id: c.cid, names: [c.name, ...c.aliases] })))[0]
    return m && m.score >= NAME_NEAR ? this.snap.customers.find((c) => c.cid === m.id) ?? null : null
  }

  /** Resolve the heard name to a customer: sure / near (ask) / two candidates / new. */
  private resolveName(d: Draft): 'ok' | 'which' | SnapCustomer[] {
    if (d.cid || d.newName) return 'ok'
    const m = matchName(d.heardName!, this.snap.customers.map((c) => ({ id: c.cid, names: [c.name, ...c.aliases] })))
    const near = m.filter((x) => x.score >= NAME_NEAR)
    if (!near.length) {
      // before opening a new account: does the heard name contain a customer we already have?
      // ("ಸುರೇಶ್ ಹೆಸರಿಂದ", "Sureshdu", "ಸುರೇಶ್ದು" -> Suresh). Then read it back instead of guessing.
      let found = this.candidates(d.heardName!)
      if (!found.length && d.single) found = this.candidates(d.transcript)
      const one = LedgerCore.clearWinner(found)
      if (one) {
        this.log.info('name_guard', { heard: d.heardName, matched: one.name })
        d.cid = one.cid
        d.nameSure = false
        return 'ok'
      }
      // two customers fit about equally ("Ramesh" / "Rameshwar", two Sureshes): ask, never pick or open a third
      if (found.length >= 2) return found.slice(0, 3).map((x) => x.c)
      d.newName = titleCase(newCustomerName(d.heardName!))
      d.nameSure = true
      return 'ok'
    }
    if (near.length >= 2 && near[1].score >= near[0].score - 0.03)
      return near.slice(0, 2).map((x) => this.snap.customers.find((c) => c.cid === x.id)!)
    d.cid = near[0].id
    d.nameSure = near[0].score >= NAME_SURE
    return 'ok'
  }

  /**
   * (Close is enough: the caller reads the line back with the customer's real name.)
   * The one known customer whose name is contained in `heard`: a word of it, two adjacent words,
   * or a word without a possessive ending (Kannada -ದು/-ದ/-ರ, Latin -du/-da/-ra, Hindi -ka/-ki/-ke
   * glued on). Null when none or more than one customer fits.
   */
  knownWithin(heard: string): SnapCustomer | null {
    return LedgerCore.clearWinner(this.candidates(heard))
  }

  /** One customer clearly ahead of the rest (alone, or an exact match against only close ones), else null. */
  static clearWinner(found: { c: SnapCustomer; score: number }[]): SnapCustomer | null {
    if (found.length === 1) return found[0].c
    if (found.length >= 2 && found[0].score >= NAME_SURE && found[1].score < found[0].score - 0.05) return found[0].c
    return null
  }

  /**
   * Every known customer the heard words could name, best first: a word, two adjacent words, or a
   * word without a possessive ending. Two people with the same name both come back.
   */
  candidates(heard: string): { c: SnapCustomer; score: number }[] {
    const people = this.snap.customers.map((c) => ({ id: c.cid, names: [c.name, ...c.aliases] }))
    if (!people.length) return []
    const words = heard.split(/[\s,.;:!?।]+/).filter(Boolean)
    const tries = new Set<string>()
    for (let i = 0; i < words.length; i++) {
      tries.add(words[i])
      if (i + 1 < words.length) tries.add(`${words[i]} ${words[i + 1]}`)
      for (const suf of ['ದು', 'ದ', 'ರ', 'du', 'da', 'ra', 'ka', 'ki', 'ke', 'ಅವರ'])
        if (words[i].length > suf.length + 2 && words[i].toLowerCase().endsWith(suf)) tries.add(words[i].slice(0, -suf.length))
    }
    const best = new Map<string, number>()
    for (const t of tries)
      for (const m of matchName(t, people))
        if (m.score >= NAME_NEAR && m.score > (best.get(m.id) ?? 0)) best.set(m.id, m.score)
    return [...best]
      .map(([id, score]) => ({ c: this.snap.customers.find((x) => x.cid === id)!, score }))
      .sort((a, b) => b.score - a.score)
  }

  /** How a customer is shown in a "which one?" question: with the balance when another has the same name. */
  label(c: SnapCustomer): string {
    const twin = this.snap.customers.some((x) => x.cid !== c.cid && x.name.toLowerCase() === c.name.toLowerCase())
    return twin ? `${c.name} · ₹${(c.balancePaise / 100).toLocaleString('en-IN')}` : c.name
  }
  customerName(d: Draft): string {
    return d.newName ?? this.snap.customers.find((c) => c.cid === d.cid)?.name ?? d.heardName ?? ''
  }

  /** Walk drafts in order: save the sure ones, stop at the first that needs a question. */
  processDrafts(drafts: Draft[], acc: Reply = { parts: [], ops: [] }): Reply {
    const R = say(this.lang)
    while (drafts.length) {
      const d = drafts.shift()!
      // "udhaar clear": the amount is whatever the customer owes, known once the customer is
      if (d.reasons.includes('settle-balance') && d.cid) {
        const c = this.snap.customers.find((x) => x.cid === d.cid)
        if (!c || c.balancePaise <= 0) {
          acc.parts.push(R.balance(c?.name ?? this.customerName(d), (c?.balancePaise ?? 0) / 100))
          continue
        }
        d.paise = c.balancePaise
      }
      if (d.paise <= 0) {
        if (!d.heardName && !d.cid) {
          acc.parts.push(R.didNotCatch())
          continue
        }
        // a name without an amount: ask for it, keeping the name
        const res = this.resolveName(d)
        if (Array.isArray(res)) {
          this.pending = { kind: 'which', draft: d, queue: drafts, options: res }
          acc.parts.push(R.askWhich(this.label(res[0]), this.label(res[1])))
          return acc
        }
        this.pending = { kind: 'amount', draft: d, queue: drafts }
        acc.parts.push(R.askAmount(this.customerName(d)))
        return acc
      }
      if (!d.heardName && !d.cid && !d.newName) {
        this.pending = { kind: 'name', draft: d, queue: drafts }
        acc.parts.push(R.askName(d.paise / 100))
        return acc
      }
      const res = this.resolveName(d)
      if (Array.isArray(res)) {
        this.pending = { kind: 'which', draft: d, queue: drafts, options: res }
        acc.parts.push(R.askWhich(this.label(res[0]), this.label(res[1])))
        return acc
      }
      const name = this.customerName(d)
      if (!d.direction) {
        this.pending = { kind: 'direction', draft: d, queue: drafts }
        acc.parts.push(R.askDirection(name, d.paise / 100))
        return acc
      }
      if (d.alt !== null) {
        this.pending = { kind: 'confusable', draft: d, queue: drafts }
        acc.parts.push(R.confusable(d.paise / 100, d.alt))
        return acc
      }
      if (this.needsConfirm(d)) {
        this.pending = { kind: 'confirm', draft: d, queue: drafts }
        acc.parts.push(this.opensAccount(d) ? R.confirmNew(name, d.paise / 100, d.direction)
          : d.noisy ? R.noisyConfirm(name, d.paise / 100, d.direction) : R.confirm(name, d.paise / 100, d.direction))
        return acc
      }
      this.save(d, acc)
    }
    this.pending = null
    return acc
  }

  /**
   * Would saving this line open an account under a name we only heard? Every junk account in the
   * production logs ("ಬರೀ" = "write", "Talk" from "took", "Your") came this way, so a heard name
   * that is not in the ledger is always read back first. Typed names are taken as written.
   */
  private opensAccount(d: Draft): boolean {
    return !!d.newName && !d.cid && d.spoken && !d.readBack && !d.confirmed
  }

  private needsConfirm(d: Draft): boolean {
    if (this.opensAccount(d)) return true
    if (d.confirmed && d.nameSure) return false
    if (d.noisy || !d.nameSure) return true
    const hard = d.reasons.filter((r) => r !== 'name-inherited' && r !== 'llm' && r !== 'confusable-resolved' && r !== 'from-context' && r !== 'dir-all')
    if (d.confidence === 'low' && hard.length) return true
    const c = d.cid ? this.snap.customers.find((x) => x.cid === d.cid) : null
    if (c?.typicalPaise && d.paise > ANOMALY_FACTOR * c.typicalPaise) return true
    if (!c?.typicalPaise && d.paise >= BIG_PAISE) return true
    return false
  }

  private save(d: Draft, acc: Reply) {
    const R = say(this.lang)
    if (d.newName && !d.cid) {
      d.cid = this.newId()
      const add: LedgerOp = { op: 'add_customer', cid: d.cid, name: d.newName }
      acc.ops.push(add)
      this.applyLocal(add) // so a second line about the same new name finds this customer
      acc.parts.push(R.newCustomer(d.newName))
    }
    const name = this.customerName(d)
    this.focusCid = d.cid
    acc.ops.push({
      op: 'entry',
      eid: this.newId(),
      cid: d.cid!,
      paise: d.paise,
      direction: d.direction!,
      dayOffset: d.dayOffset,
      promise: d.promise,
      source: {
        transcript: d.transcript, confidence: d.confidence, reasons: d.reasons, lang: LOCALE[this.lang],
        snrDb: d.snrDb ?? undefined, path: d.path,
      },
    })
    if (d.promise) acc.parts.push(R.savedPromise(name, d.paise / 100, d.dayOffset))
    else if (this.sayBalance) acc.parts.push(R.savedWithBalance(name, d.paise / 100, d.direction!, this.balanceAfter(d.cid!, acc.ops) / 100))
    else acc.parts.push(R.saved(name, d.paise / 100, d.direction!))
    acc.saved = (acc.saved ?? 0) + 1
    // the full sentence with the balance is the confirmation: never shortened to an ack
    if (!this.sayBalance && this.ackable(d)) acc.ackable = (acc.ackable ?? 0) + 1
  }

  /** The customer's balance (paise) once the not-yet-applied ops of this reply are written. */
  private balanceAfter(cid: string, ops: LedgerOp[]): number {
    let b = this.snap.customers.find((c) => c.cid === cid)?.balancePaise ?? 0
    for (const o of ops) if (o.op === 'entry' && o.cid === cid && !o.promise) b += o.direction === 'credit' ? o.paise : -o.paise
    return b
  }

  /**
   * May this save be confirmed with a short ack instead of name + amount? Only a plain entry for
   * today, for a known customer, that was either already read back and confirmed, or heard
   * cleanly with full confidence. New customers, promises, other days and noisy or unsure lines
   * keep the full read-back.
   */
  private ackable(d: Draft): boolean {
    if (d.promise || d.dayOffset !== 0 || d.newName) return false
    return !!d.readBack || (!d.noisy && d.nameSure && d.confidence === 'high')
  }

  /**
   * Can the fast parse alone answer the open question? When not, the agent reads the turn (it sees
   * `pending`) and may call answer_question. Taps always answer.
   */
  canAnswerFast(text: string, intent: Intent): boolean {
    const p = this.pending
    if (!p) return true
    if (this.turnSrc === 'tap') return true
    if (intent.type === 'yes' || intent.type === 'no' || intent.type === 'undo') return true
    const words = text.trim().split(/\s+/).filter(Boolean).length
    const full = intent.type === 'entries' && intent.entries.every((e) => e.name && e.direction)
    switch (p.kind) {
      case 'choose':
        return full || LedgerCore.chooseIndex(p.options, text) >= 0
      case 'modify':
      case 'delete':
        return full
      case 'batch':
        return full || intent.type === 'entries' || !!directionAnswer(text)
      case 'confirm':
        return intent.type === 'entries' || intent.type === 'correct'
      case 'name': {
        const n = nameAnswer(text)
        return !!n && n.split(' ').length <= 2 && words <= 4 && !mentionsMoney(text)
      }
      case 'amount':
        return words <= 4 && parseAmounts(text).some((a) => a.value > 0)
      case 'direction':
        return full || (words <= 4 && !!(directionAnswer(text) ?? (intent.type === 'correct' ? intent.direction : null)))
      case 'which': {
        if (p.options.some((c) => this.label(c) === text.trim())) return true
        const n = nameAnswer(text) ?? text
        const m = matchName(n, p.options.map((c) => ({ id: c.cid, names: [c.name, ...c.aliases] })))
        return words <= 4 && m.length > 0 && m[0].score >= NAME_NEAR && !(m[1] && m[1].score >= m[0].score - 0.01)
      }
      case 'confusable': {
        const heard = parseAmounts(text).map((x) => x.value)
        return heard.includes(p.draft.alt!) || heard.includes(p.draft.paise / 100) || (heard.length === 1 && words <= 4)
      }
    }
    return false
  }

  /**
   * Which option an answer picks: the label exactly (a tap), "first / pehla / doosra", the
   * balance ("300 wala"), or the name when only one option has it. -1 when it is not clear.
   */
  static chooseIndex(options: ChooseOption[], text: string): number {
    const t = text.trim()
    const exact = options.findIndex((o) => o.label === t)
    if (exact >= 0) return exact
    const ords: [RegExp, number][] = [
      [/\b(pehl|pahl|first|1st)|पहल|ಮೊದಲ|முதல்|మొదట/i, 0],
      [/\b(doosr|dusr|second|2nd)|दूसर|ಎರಡನೇ|இரண்டாவது|రెండో/i, 1],
      [/\b(teesr|tisr|third|3rd)|तीसर|ಮೂರನೇ|மூன்றாவது|మూడో/i, 2],
    ]
    for (const [re, i] of ords) if (re.test(t) && i < options.length) return i
    const amts = parseAmounts(t).map((a) => a.value)
    const byAmt = options.map((o, i) => (o.rupees !== undefined && amts.includes(o.rupees) ? i : -1)).filter((i) => i >= 0)
    if (byAmt.length === 1) return byAmt[0]
    const m = matchName(nameAnswer(t) ?? t, options.map((o, i) => ({ id: String(i), names: [o.name] })))
    if (m.length && m[0].score >= NAME_NEAR && !(m[1] && m[1].score >= m[0].score - 0.01)) return Number(m[0].id)
    return -1
  }

  answerPending(text: string, intent: Intent, meta: TurnMeta): Reply | null {
    const R = say(this.lang)
    // a question left hanging expires instead of catching a later "haan": this is a fresh turn
    if (this.expireStale() || !this.pending) return this.dispatch(intent, text, meta)
    const p = this.pending
    const acc: Reply = { parts: [], ops: [] }
    if (p.kind === 'batch') return this.answerBatch(p.drafts, text, intent, meta)
    if (p.kind === 'choose') {
      if (intent.type === 'undo' || intent.type === 'no') {
        this.pending = null
        return { parts: [R.notSaved()], ops: [] }
      }
      if (intent.type === 'entries' && intent.entries.every((e) => e.name && e.direction)) {
        this.pending = null
        return this.dispatch(intent, text, meta)
      }
      const i = intent.type === 'yes' && p.options.length === 1 ? 0 : LedgerCore.chooseIndex(p.options, text)
      if (i < 0) {
        // talk that answers nothing (one stray word, or a long aside with no money in it) keeps the
        // question on screen quietly; otherwise it is asked again once, then it waits
        const words = text.trim().split(/\s+/).filter(Boolean).length
        if ((words <= 1 || words > 4) && !mentionsMoney(text)) return null
        p.reasked = (p.reasked ?? 0) + 1
        return p.reasked > 1 ? null : { parts: [p.ask], ops: [] }
      }
      this.pending = null
      return this.choose(p.tool, p.options[i].args, p.transcript, meta) ?? { parts: [R.didNotCatch()], ops: [] }
    }
    if (p.kind === 'delete' && p.requireType) {
      // typed on the phone (answer / text), exactly the word: nothing spoken can do this
      const norm = (x: string) => x.normalize('NFC').trim().toLowerCase()
      if (this.turnSrc === 'tap' && norm(text) === norm(p.requireType)) {
        this.pending = null
        return { parts: [R.deleted()], ops: [{ op: 'delete_all' }] }
      }
      // a yes (spoken or tapped) is not enough: keep waiting for the word
      if (intent.type === 'yes') return { parts: [R.eraseType(p.requireType)], ops: [] }
    }
    if (intent.type === 'undo' || (intent.type === 'no' && p.kind !== 'confusable')) {
      this.pending = null
      if (p.kind === 'delete') return { parts: [R.notSaved()], ops: [] }
      return { parts: [R.notSaved()], ops: [] }
    }
    if (p.kind === 'delete') {
      this.pending = null
      if (intent.type === 'yes') return { parts: [R.deleted()], ops: [{ op: 'delete_all' }] }
      return { parts: [R.notSaved()], ops: [] }
    }
    if (p.kind === 'modify') {
      this.pending = null
      if (intent.type === 'yes') {
        this.focusCid = p.focus
        return p.ready ? { parts: [p.done], ops: p.ops, ready: p.ready } : { parts: [p.done], ops: p.ops }
      }
      // anything else is a new instruction: drop the question and handle it
      return intent.type === 'unknown' ? { parts: [R.notSaved()], ops: [] } : this.dispatch(intent, text, meta)
    }
    // a fresh, complete instruction replaces the question
    if (intent.type === 'entries' && intent.entries.every((e) => e.name && e.direction)) {
      this.pending = null
      return this.dispatch(intent, text, meta)
    }
    const d = p.draft
    switch (p.kind) {
      case 'confirm':
        if (intent.type === 'yes') {
          d.readBack = true
          this.save(d, acc)
          return this.processDrafts(p.queue, acc)
        }
        if (intent.type === 'entries' && refersBack(text)) {
          // "usko 50 aur" while a read-back is open is a new line about the person being asked about,
          // not a fix to that line (which stays unwritten: we say so)
          this.pending = null
          if (d.cid) this.focusCid = d.cid
          const r = this.dispatch(intent, text, meta)
          return { parts: [R.notSaved(), ...(r?.parts ?? [])], ops: r?.ops ?? [] }
        }
        if (intent.type === 'entries' && intent.entries[0]?.name) {
          const other = this.lookup(intent.entries[0].name)
          const same = other ? other.cid === d.cid : !!d.newName && titleCase(intent.entries[0].name) === d.newName
          if (!same) {
            // "Suresh 200" in reply to "Ramesh 500, correct?": not a yes, a different entry
            this.pending = null
            const r = this.dispatch(intent, text, meta)
            return { parts: [R.notSaved(), ...(r?.parts ?? [])], ops: r?.ops ?? [] }
          }
        }
        if (intent.type === 'correct' || intent.type === 'entries') {
          const amt = intent.type === 'correct' ? intent.amount?.value : intent.entries[0]?.amount.value
          const dir = intent.type === 'correct' ? intent.direction : intent.entries[0]?.direction
          if (amt !== undefined) d.paise = Math.round(amt * 100)
          if (dir) d.direction = dir
          if (intent.type === 'correct' && intent.name) {
            d.heardName = intent.name
            d.cid = null
            d.newName = null
            d.single = false // the name is the one just said, never one from the sentence being corrected
            d.transcript = text
            const res = this.resolveName(d)
            if (Array.isArray(res)) {
              this.pending = { kind: 'which', draft: d, queue: p.queue, options: res }
              return { parts: [R.askWhich(this.label(res[0]), this.label(res[1]))], ops: [] }
            }
            // a name not in the ledger: read back as a new customer first
            if (this.opensAccount(d)) return this.processDrafts([d, ...p.queue], acc)
          }
          this.save(d, acc) // the user just said the right value: no second confirmation
          return this.processDrafts(p.queue, acc)
        }
        return { parts: [R.didNotCatch()], ops: [] }
      case 'name': {
        const n = nameAnswer(text)
        if (!n || n.split(' ').length > 2) return { parts: [R.askName(d.paise / 100)], ops: [] }
        d.heardName = n
        this.fillDirection(d, text)
        return this.processDrafts([d, ...p.queue], acc)
      }
      case 'amount': {
        // the amount blank: read only the number (and a credit/paid word), whatever else was said
        // ("300 ಬರೀ" = "write 300": ಬರೀ is not a name here, the name is already known)
        const amounts = parseAmounts(text).filter((a) => a.value > 0)
        if (!amounts.length) return { parts: [R.askAmount(this.customerName(d))], ops: [] }
        d.paise = Math.round(amounts[0].value * 100)
        d.reasons = d.reasons.filter((r) => r !== 'no-amount')
        if (amounts.some((a) => a.value !== amounts[0].value)) d.reasons.push('amounts-differ')
        this.fillDirection(d, text)
        return this.processDrafts([d, ...p.queue], acc)
      }
      case 'direction': {
        const dir = directionAnswer(text) ?? (intent.type === 'correct' ? intent.direction ?? null : null)
        // "yes"/"correct" does not say which: ask the same short question again
        if (!dir) {
          return { parts: [R.askDirection(this.customerName(d), d.paise / 100)], ops: [] }
        }
        d.direction = dir
        if (this.turnSrc === 'tap') {
          // tapped on the card that shows the name and the amount: that is the yes, new customer included
          d.confirmed = true
          d.readBack = true
          d.nameSure = true
        }
        // the shopkeeper just stated the direction: only doubts about the amount itself remain
        d.reasons = d.reasons.filter((r) => AMOUNT_FLAGS.has(r))
        d.confidence = d.reasons.length ? 'low' : 'high'
        return this.processDrafts([d, ...p.queue], acc)
      }
      case 'which': {
        // a tap sends the option exactly as shown ("Suresh · ₹300"); speech is matched by name
        const tapped = p.options.find((c) => this.label(c) === text.trim())
        const n = nameAnswer(text) ?? text
        const m = tapped ? [{ id: tapped.cid, score: 1 }] : matchName(n, p.options.map((c) => ({ id: c.cid, names: [c.name, ...c.aliases] })))
        if (!m.length || m[0].score < NAME_NEAR || (m[1] && m[1].score >= m[0].score - 0.01))
          return { parts: [R.askWhich(this.label(p.options[0]), this.label(p.options[1]))], ops: [] }
        d.cid = m[0].id
        d.nameSure = true
        return this.processDrafts([d, ...p.queue], acc)
      }
      case 'confusable': {
        const heard = parseAmounts(text).map((s) => s.value)
        let pick: number | null = null
        if (heard.includes(d.alt!)) pick = d.alt
        else if (heard.includes(d.paise / 100)) pick = d.paise / 100
        else if (intent.type === 'yes') pick = d.paise / 100
        else if (heard.length === 1 && /^\d/.test(String(heard[0]))) pick = heard[0]
        if (pick === null) return { parts: [R.confusable(d.paise / 100, d.alt!)], ops: [] }
        d.paise = Math.round(pick * 100)
        d.alt = null
        d.reasons = [...d.reasons.filter((r) => r !== 'confusable'), 'confusable-resolved']
        // the shopkeeper just chose the amount, so no extra read-back unless the room is noisy
        if (!d.noisy && d.nameSure) {
          this.save(d, acc)
          return this.processDrafts(p.queue, acc)
        }
        return this.processDrafts([d, ...p.queue], acc)
      }
    }
  }

  private answerBatch(drafts: Draft[], text: string, intent: Intent, meta: TurnMeta): Reply | null {
    const R = say(this.lang)
    if (intent.type === 'undo') {
      this.pending = null
      return { parts: [R.notSaved()], ops: [] }
    }
    const clear = (d: Draft) => {
      d.reasons = d.reasons.filter((r) => r !== 'dir-shared')
      if (!d.reasons.some((r) => r !== 'name-inherited' && r !== 'llm' && r !== 'from-context')) d.confidence = 'high'
    }
    if (intent.type === 'yes') {
      // the list was read back name by name: one yes confirms every line, even in noise
      for (const d of drafts) {
        if (d.reasons.includes('dir-shared')) clear(d)
        d.confirmed = true
      }
      return this.processDrafts(drafts, { parts: [], ops: [] })
    }
    // a one-word direction answers for the list ("jama"): it replaces the shared guess
    const dir = directionAnswer(text)
    if (dir) {
      // the list shared one spoken word, so the answer replaces it for every line
      for (const d of drafts) {
        d.confirmed = true
        d.direction = dir
        clear(d)
      }
      return this.processDrafts(drafts, { parts: [], ops: [] })
    }
    if (intent.type === 'no') {
      // not all the same: ask about each one that had no direction of its own
      for (const d of drafts)
        if (d.reasons.includes('dir-shared')) {
          d.direction = null
          d.reasons = d.reasons.filter((r) => r !== 'dir-shared')
        }
      return this.processDrafts(drafts, { parts: [], ops: [] })
    }
    if (intent.type === 'entries') {
      this.pending = null
      return this.dispatch(intent, text, meta)
    }
    const first = drafts.find((d) => d.direction)
    return { parts: [first ? sayMore(this.lang).batchAsk(this.batchItems(drafts), first.direction!) : R.didNotCatch()], ops: [] }
  }
  /** A credit/paid word in an answer to another question fills that blank too ("Mahi, udhaar"). */
  fillDirection(d: Draft, text: string) {
    if (d.direction) return
    const dir = directionAnswer(text)
    if (dir) {
      d.direction = dir
      d.reasons = d.reasons.filter((r) => r !== 'no-direction-cue')
    }
  }
  /**
   * "Ramesh ka udhaar clear" / "hisaab chukta" / just "clear": the customer paid off what they owe.
   * The customer is the one named, or the one just talked about when no name is said. Two customers
   * who both fit ("Ramesh" / "Rameshwar", two Sureshes) are asked about first. Always read back
   * with that customer's balance ("Ramesh, 200 rupees paid, correct?"); nothing is written without a yes.
   */
  settle(text: string, meta: TurnMeta): Reply | null {
    if (!mentionsSettle(text) || parseAmounts(text).some((a) => a.value > 0)) return null
    const found = this.candidates(text)
    const named = nameAnswer(text)
    const saysNoName = !named || named.split(' ').every((w) => mentionsSettle(w))
    const focus = saysNoName && this.focusCid ? this.snap.customers.find((c) => c.cid === this.focusCid) ?? null : null
    const one = LedgerCore.clearWinner(found) ?? (found.length ? null : focus)
    if (!one && found.length < 2) return null // nobody we know: not a settle
    return this.settleWith(one, found, text, meta)
  }

  /**
   * Settle by name, for the agent: the customer named (two who fit are asked about), or the one
   * just talked about when no name is given. Always read back with the balance; null when nobody fits.
   */
  settleFor(name: string | null, text: string, meta: TurnMeta): Reply | null {
    const exact = name ? this.lookup(name) : null
    const twins = exact ? this.snap.customers.filter((c) => c.name.toLowerCase() === exact.name.toLowerCase()) : []
    if (twins.length >= 2) return this.settleWith(null, twins.map((c) => ({ c, score: 1 })), text, meta)
    const found = name ? this.candidates(name) : []
    const focus = !name && this.focusCid ? this.snap.customers.find((c) => c.cid === this.focusCid) ?? null : null
    const one = LedgerCore.clearWinner(found) ?? exact ?? focus
    if (!one && found.length < 2) return null
    return this.settleWith(one, found, text, meta)
  }

  private settleWith(one: SnapCustomer | null, found: { c: SnapCustomer; score: number }[], text: string, meta: TurnMeta): Reply {
    const d: Draft = {
      heardName: one?.name ?? null, cid: one?.cid ?? null, newName: null, nameSure: true, paise: one?.balancePaise ?? 1, alt: null,
      direction: 'payment', dayOffset: 0, promise: false, confidence: 'low', reasons: ['settle-balance'], path: meta.path, transcript: text,
      snrDb: meta.snrDb, noisy: meta.noisy, spoken: this.turnSrc !== 'tap', single: true,
    }
    if (!one) {
      const options = found.slice(0, 3).map((x) => x.c)
      this.pending = { kind: 'which', draft: d, queue: [], options }
      return { parts: [say(this.lang).askWhich(this.label(options[0]), this.label(options[1]))], ops: [] }
    }
    return this.processDrafts([d], { parts: [], ops: [] })
  }

  correctLast(intent: Extract<Intent, { type: 'correct' }>): Reply {
    const R = say(this.lang)
    const last = this.snap.last
    if (!last) return { parts: [R.nothingToUndo()], ops: [] }
    const ops: LedgerOp[] = []
    const amend: Extract<LedgerOp, { op: 'amend' }> = { op: 'amend', eid: last.eid }
    if (intent.amount) amend.paise = Math.round(intent.amount.value * 100)
    if (intent.direction) amend.direction = intent.direction
    let name = this.snap.customers.find((c) => c.cid === last.cid)?.name ?? ''
    if (intent.name) {
      const c = this.lookup(intent.name)
      if (c) {
        amend.cid = c.cid
        name = c.name
      } else {
        const cid = this.newId()
        name = titleCase(intent.name)
        ops.push({ op: 'add_customer', cid, name })
        amend.cid = cid
      }
    }
    ops.push(amend)
    const focus = amend.cid ?? last.cid
    const paise = amend.paise ?? last.paise
    const dir = amend.direction ?? last.direction
    const done = R.corrected(name, paise / 100, dir)
    if (ops.some((o) => o.op === 'add_customer') && this.turnSrc !== 'tap') {
      // moving the entry to a name not in the ledger: read back as a new customer first
      this.pending = { kind: 'modify', ops, done, focus, view: { kind: 'modify', name, paise, direction: dir, newCustomer: true } }
      return { parts: [R.confirmNew(name, paise / 100, dir)], ops: [] }
    }
    this.focusCid = focus
    return { parts: [done], ops }
  }

  /** the amounts this customer usually has (typical, then recent), as buttons for the amount question */
  private amountChoices(cid: string | null): number[] | undefined {
    if (!cid) return undefined
    const c = this.snap.customers.find((x) => x.cid === cid)
    const recent = (this.snap.entries ?? []).filter((e) => e.cid === cid && !e.promise).map((e) => e.paise)
    const out = [...new Set([...recent, c?.typicalPaise ?? 0].filter((p) => p > 0))].slice(0, 3).map((p) => p / 100)
    return out.length ? out : undefined
  }

  pendingView(): PendingView | null {
    this.expireStale()
    const p = this.pending
    if (!p) return null
    if (p.kind === 'delete') return p.requireType ? { kind: 'delete', requireType: p.requireType } : { kind: 'delete' }
    if (p.kind === 'choose') return { kind: 'which', options: p.options.map((o) => o.label) }
    if (p.kind === 'modify') return p.view
    if (p.kind === 'batch') {
      const dir = p.drafts.find((d) => d.direction)?.direction ?? null
      return { kind: 'batch', direction: dir, options: this.batchItems(p.drafts).map((i) => `${i.name} ₹${i.amt}`) }
    }
    const d = p.draft
    return {
      kind: p.kind,
      name: this.customerName(d) || undefined,
      paise: d.paise,
      direction: d.direction,
      newCustomer: p.kind === 'confirm' && this.opensAccount(d) ? true : undefined,
      amounts: p.kind === 'amount' ? this.amountChoices(d.cid) : undefined,
      options: p.kind === 'which' ? p.options.map((c) => this.label(c)) : p.kind === 'confusable' ? [String(d.paise / 100), String(d.alt)] : undefined,
    }
  }

  /** Keep the server's copy of the snapshot current until the phone sends a fresh one. */
  applyLocal(op: LedgerOp) {
    const s = this.snap
    switch (op.op) {
      case 'add_customer':
        if (s.customers.some((x) => x.cid === op.cid)) break
        s.customers.push({ cid: op.cid, name: op.name, aliases: [], householdId: null, remindersOptIn: false, adult: false, balancePaise: 0, typicalPaise: null })
        this.deps.onCustomerAdded?.()
        break
      case 'entry': {
        const day = istDay(op.dayOffset)
        s.last = { eid: op.eid, cid: op.cid, paise: op.paise, direction: op.direction, day, promise: op.promise || undefined }
        for (const [eid, t] of this.writtenAt) if (this.now() - t > WRITTEN_KEEP_MS) this.writtenAt.delete(eid)
        this.writtenAt.set(op.eid, this.now())
        s.entries = [{ ...s.last }, ...(s.entries ?? [])]
        if (op.promise) break // a promise is remembered, never posted to the balance
        const c = s.customers.find((x) => x.cid === op.cid)
        if (c) c.balancePaise += op.direction === 'credit' ? op.paise : -op.paise
        this.totals(day, op.direction, op.paise, 1)
        break
      }
      case 'amend': {
        const sign = (d: Direction) => (d === 'credit' ? 1 : -1)
        const copies = [s.last, ...(s.entries ?? [])].filter((e): e is SnapEntry => !!e && e.eid === op.eid)
        const e = copies[0]
        if (!e) break
        if (!e.promise) {
          const before = s.customers.find((x) => x.cid === e.cid)
          if (before) before.balancePaise -= sign(e.direction) * e.paise
          this.totals(e.day, e.direction, e.paise, -1)
        }
        for (const x of copies) {
          if (op.paise !== undefined) x.paise = op.paise
          if (op.direction) x.direction = op.direction
          if (op.cid) x.cid = op.cid
        }
        if (!e.promise) {
          const after = s.customers.find((x) => x.cid === e.cid)
          if (after) after.balancePaise += sign(e.direction) * e.paise
          this.totals(e.day, e.direction, e.paise, 1)
        }
        break
      }
      case 'void': {
        const e = [s.last, ...(s.entries ?? [])].find((x) => x && x.eid === op.eid)
        if (e && !e.promise) {
          const c = s.customers.find((x) => x.cid === e.cid)
          if (c) c.balancePaise -= (e.direction === 'credit' ? 1 : -1) * e.paise
          this.totals(e.day, e.direction, e.paise, -1)
        }
        s.entries = (s.entries ?? []).filter((x) => x.eid !== op.eid)
        if (s.last?.eid === op.eid) s.last = s.entries[0] ?? null
        break
      }
      case 'delete_all':
        s.customers = []
        s.last = null
        s.entries = []
        this.focusCid = null
        break
      case 'add_alias': {
        const c = s.customers.find((x) => x.cid === op.cid)
        if (c && !c.aliases.includes(op.alias)) c.aliases.push(op.alias)
        break
      }
      case 'rename_customer': {
        const c = s.customers.find((x) => x.cid === op.cid)
        if (c) c.name = op.name
        this.deps.onCustomerAdded?.() // the recogniser's name hints change
        break
      }
      case 'set_phone': {
        const c = s.customers.find((x) => x.cid === op.cid)
        if (c) c.phone = op.phone
        break
      }
      case 'merge_customers': {
        const into = s.customers.find((x) => x.cid === op.into)
        const from = s.customers.find((x) => x.cid === op.from)
        if (!into || !from || into === from) break
        for (const n of [from.name, ...from.aliases]) if (n !== into.name && !into.aliases.includes(n)) into.aliases.push(n)
        into.balancePaise += from.balancePaise
        into.typicalPaise = null
        for (const e of [s.last, ...(s.entries ?? [])]) if (e && e.cid === op.from) e.cid = op.into
        s.customers = s.customers.filter((x) => x.cid !== op.from)
        if (this.focusCid === op.from) this.focusCid = op.into
        this.deps.onCustomerAdded?.()
        break
      }
    }
  }

  /** Keep today's and this month's totals in step with a change (sign +1 add, -1 remove). */
  private totals(day: string, dir: Direction, paise: number, sign: 1 | -1) {
    const today = istDay(0)
    const buckets = []
    if (day === today) buckets.push(this.snap.today)
    if (day && day.slice(0, 7) === today.slice(0, 7)) buckets.push(this.snap.month)
    for (const b of buckets) {
      b.entries += sign
      if (dir === 'credit') b.creditPaise += sign * paise
      else b.paymentPaise += sign * paise
    }
  }
}

/**
 * The name for a new account: a Kannada possessive -ದು glued after a consonant ("ಸುರೇಶ್ದು",
 * "Suresh's") is dropped, so the account is "ಸುರೇಶ್". Names that end in ದು by themselves
 * ("ಬಿಂದು") are kept: there the ದು follows a vowel sign or anusvara, not a virama.
 */
export function newCustomerName(heard: string): string {
  return heard
    .split(' ')
    .map((w) => {
      if (w.length > 3 && w.endsWith('್ದು')) return w.slice(0, -2)
      // the same possessive heard in Latin ("Sureshdu"); not after n, so Bindu / Indu / Pandu stay
      if (/^[a-z]{3,}[b-df-hj-mp-tv-z]du$/i.test(w) && !/ndu$/i.test(w)) return w.slice(0, -2)
      return w
    })
    .join(' ')
}

/** YYYY-MM-DD in India, offset by n days (the shop's calendar, not the server's). */
function istDay(n: number): string {
  return new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10)
}

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase())
}
