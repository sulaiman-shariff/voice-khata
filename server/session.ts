/**
 * One voice session: mic audio in, ledger ops + spoken replies out.
 *
 *   audio -> energy tracker (pause, SNR)  ─┐
 *        -> Prisma STT (partials, final) ──┼─> end of turn: text complete + 300 ms pause -> commit
 *                                          └─> final -> fast parser (or Haiku) -> dialogue -> ops + reply -> Timbre
 *
 * Dependencies are injected so the dialogue can be tested without the network.
 */
import { type Direction, type EntryIntent, type Intent, directionAnswer, hasUnplacedWords, mentionsMoney, nameAnswer, parseFast, turnComplete } from '../shared/intent.js'
import { NAME_NEAR, NAME_SURE, matchName } from '../shared/names.js'
import { parseAmounts } from '../shared/numbers.js'
import type { ClientMsg, LedgerOp, PendingView, ServerMsg, SnapCustomer, Snapshot, TurnMetrics } from '../shared/protocol.js'
import { type Lang, LOCALE, guardReply, say } from '../shared/replies.js'
import { FRAME_SAMPLES, newEnergyState, pushFrame, resetUtterance, tooNoisy, utteranceSnrDb } from './turn/energy.js'
import type { LlmContext, LlmReading } from './parse/llm.js'
import { validate } from './parse/llm.js'

export interface SttLike {
  send(pcm: Buffer): void
  commit(): void
  setKeyterms(terms: string[]): void
  close(): void
}
export interface SttCallbacks {
  onSpeechStart?: () => void
  onSpeechEnd?: () => void
  onPartial?: (text: string) => void
  onFinal?: (text: string) => void
  onError?: (msg: string) => void
}
export interface SessionDeps {
  openStt: (locale: string, keyterms: string[], cb: SttCallbacks) => SttLike
  speak: (text: string, locale: string, onAudio: (pcm: Buffer) => void, signal: AbortSignal) => Promise<{ firstAudioMs: number | null; bytes: number }>
  llm: (text: string, ctx: LlmContext) => Promise<Partial<LlmReading>>
  send: (msg: ServerMsg) => void
  sendAudio: (pcm: Buffer) => void
  now?: () => number
  newId?: () => string
}

/** Pause after speech before an early commit, when the words already form a complete turn. */
export const EARLY_COMMIT_PAUSE_MS = 300
const ANOMALY_FACTOR = 5
const AMOUNT_FLAGS = new Set(['confusable', 'elided_scale', 'approx_range', 'bare_fraction', 'digit_sequence'])

interface Draft {
  heardName: string | null
  cid: string | null
  newName: string | null // set when this entry creates a customer
  nameSure: boolean
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

type Pending =
  | { kind: 'confirm' | 'name' | 'direction' | 'confusable'; draft: Draft; queue: Draft[] }
  | { kind: 'which'; draft: Draft; queue: Draft[]; options: SnapCustomer[] }
  | { kind: 'delete' }

interface Reply {
  parts: string[]
  ops: LedgerOp[]
}

export class Session {
  lang: Lang = 'hi'
  snap: Snapshot = {
    shopName: 'Shop', customers: [], last: null,
    today: { creditPaise: 0, paymentPaise: 0, entries: 0 }, month: { creditPaise: 0, paymentPaise: 0, entries: 0 },
  }
  private ptt = false
  private stt: SttLike | null = null
  private energy = newEnergyState()
  private frameCarry = Buffer.alloc(0)
  private lastPartial = ''
  private committed = false
  private commitAt: number | null = null
  private earlyCommit = false
  private lastSpeechAt = 0
  pending: Pending | null = null
  private speaking: { ac: AbortController; text: string; ducked: boolean; until: number } | null = null
  private chain: Promise<void> = Promise.resolve()
  private now: () => number
  private newId: () => string

  constructor(private deps: SessionDeps) {
    this.now = deps.now ?? (() => performance.now())
    this.newId = deps.newId ?? (() => crypto.randomUUID())
  }

  // ------------------------------------------------------------------ client messages
  onClient(msg: ClientMsg): void {
    switch (msg.type) {
      case 'hello':
        this.lang = msg.lang
        this.snap = msg.snapshot
        this.ptt = msg.ptt
        this.openStt()
        if (msg.firstRun)
          this.enqueue(async () => {
            await this.speak(say(this.lang).disclosure())
          })
        break
      case 'snapshot':
        this.snap = msg.snapshot
        this.stt?.setKeyterms(this.keyterms())
        break
      case 'ptt_start':
        this.ptt = true
        this.bargeIn()
        break
      case 'ptt_end':
        this.commit(false)
        break
      case 'tap':
        this.enqueue(() => this.handleText(msg.action === 'yes' ? 'haan' : msg.action === 'no' ? 'nahi' : 'undo', null, 'tap'))
        break
      case 'answer':
        if (msg.text.length <= 60) this.enqueue(() => this.handleText(msg.text, null, 'tap'))
        break
      case 'playback_done':
        this.speaking = null
        break
    }
  }

  private keyterms(): string[] {
    return this.snap.customers.flatMap((c) => [c.name, ...c.aliases]).slice(0, 200)
  }

  private openStt() {
    this.stt?.close()
    this.stt = this.deps.openStt(LOCALE[this.lang], this.keyterms(), {
      onSpeechStart: () => {
        if (this.isSpeaking() && this.speaking && !this.speaking.ducked) {
          this.speaking.ducked = true
          this.deps.send({ type: 'duck' })
        }
      },
      onPartial: (t) => this.onPartial(t),
      onSpeechEnd: () => {
        if (this.speaking?.ducked) {
          this.speaking.ducked = false
          this.deps.send({ type: 'unduck' })
        }
      },
      onFinal: (t) => this.onFinal(t),
      onError: (m) => this.deps.send({ type: 'error', message: `stt: ${m}` }),
    })
  }

  // ------------------------------------------------------------------ audio + end of turn
  onAudio(pcm: Buffer): void {
    this.stt?.send(pcm)
    let buf = this.frameCarry.length ? Buffer.concat([this.frameCarry, pcm]) : pcm
    const FB = FRAME_SAMPLES * 2
    while (buf.length >= FB) {
      const frame = new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + FB))
      if (pushFrame(this.energy, frame)) this.lastSpeechAt = this.now()
      buf = buf.subarray(FB)
      this.maybeEarlyCommit()
    }
    this.frameCarry = Buffer.from(buf)
  }

  private maybeEarlyCommit() {
    if (this.ptt || this.committed || !this.energy.inUtterance) return
    if (this.energy.silentMs < EARLY_COMMIT_PAUSE_MS) return
    if (this.lastPartial && turnComplete(this.lastPartial)) this.commit(true)
  }

  private commit(early: boolean) {
    if (this.committed) return
    this.committed = true
    this.commitAt = this.now()
    this.earlyCommit = early
    this.stt?.commit()
  }

  private onPartial(text: string) {
    this.lastPartial = text
    this.deps.send({ type: 'partial', text })
    // two-stage barge-in: real words that are not our own echo stop the reply
    if (this.isSpeaking() && this.speaking) {
      const words = text.trim().split(/\s+/).filter(Boolean)
      const echo = this.speaking.text.includes(text.trim())
      if (words.length >= 2 && !echo) this.bargeIn()
    }
  }

  private bargeIn() {
    if (!this.speaking) return
    this.speaking.ac.abort()
    this.speaking = null
    this.deps.send({ type: 'stop_audio' })
  }

  private isSpeaking() {
    return !!this.speaking && this.now() < this.speaking.until
  }

  private onFinal(text: string) {
    const snrDb = utteranceSnrDb(this.energy)
    const noisy = tooNoisy(this.energy)
    const speechEnd = this.lastSpeechAt
    const commitAt = this.commitAt
    const early = this.earlyCommit
    const finalAt = this.now()
    resetUtterance(this.energy)
    this.committed = false
    this.commitAt = null
    this.earlyCommit = false
    this.lastPartial = ''
    if (!text.trim()) return
    this.deps.send({ type: 'final', text })
    if (this.speaking?.ducked) this.bargeIn()
    this.enqueue(() =>
      this.handleText(text, { speechEnd, commitAt, finalAt, early, snrDb, noisy }, 'voice'),
    )
  }

  private enqueue(fn: () => Promise<void>) {
    this.chain = this.chain.then(fn).catch((e) => this.deps.send({ type: 'error', message: String(e) }))
  }

  /** Wait for queued turns (tests). */
  idle(): Promise<void> {
    return this.chain
  }

  // ------------------------------------------------------------------ the turn
  async handleText(
    text: string,
    t: { speechEnd: number; commitAt: number | null; finalAt: number; early: boolean; snrDb: number | null; noisy: boolean } | null,
    _src: 'voice' | 'tap',
  ): Promise<void> {
    const t0 = this.now()
    let intent: Intent = parseFast(text)
    let path: 'fast' | 'llm' | 'none' = 'fast'
    let llmMs: number | undefined
    const snrDb = t?.snrDb ?? null
    const noisy = t?.noisy ?? false

    if (!this.pending && this.needsLlm(text, intent)) {
      const l0 = this.now()
      try {
        const reading = await this.deps.llm(text, this.llmContext())
        const v = validate(text, reading)
        if (v.type !== 'unknown' || intent.type === 'unknown') intent = v
        path = 'llm'
      } catch {
        /* LLM unavailable: keep the fast-path reading */
      }
      llmMs = this.now() - l0
    }
    const parseMs = this.now() - t0

    const reply = this.pending
      ? this.answerPending(text, intent, snrDb, noisy, path === 'llm' ? 'llm' : 'fast')
      : this.dispatch(intent, text, snrDb, noisy, path === 'llm' ? 'llm' : 'fast')
    if (!reply) path = 'none'

    if (reply?.ops.length) {
      for (const op of reply.ops) this.applyLocal(op)
      this.deps.send({ type: 'ops', ops: reply.ops })
    }
    this.deps.send({ type: 'pending', pending: this.pendingView() })

    let firstAudioAt: number | null = null
    if (reply?.parts.length) firstAudioAt = await this.speak(reply.parts.join(' '))

    if (t) {
      const base = t.speechEnd
      const m: TurnMetrics = {
        speechMs: 0,
        commitAt: t.commitAt === null ? null : t.commitAt - base,
        finalAt: t.finalAt - base,
        parseMs,
        path,
        llmMs,
        firstAudioAt: firstAudioAt === null ? null : firstAudioAt - base,
        earlyCommit: t.early,
        snrDb,
      }
      this.deps.send({ type: 'metrics', turn: m })
    }
  }

  private needsLlm(text: string, intent: Intent): boolean {
    if (intent.type === 'entries') {
      const unsure = intent.entries.some((e) => e.reasons.includes('no-name') || e.reasons.includes('no-direction-cue'))
      // "Ramesh, 300": nothing for a model to read; asking the missing part is faster
      return unsure && hasUnplacedWords(text, intent.entries.map((e) => e.name))
    }
    if (intent.type !== 'unknown') return false
    // only spend an LLM call when the words look like ledger talk
    if (mentionsMoney(text)) return true
    const known = this.snap.customers.map((c) => ({ id: c.cid, names: [c.name, ...c.aliases] }))
    return text.split(/\s+/).some((w) => w.length > 2 && (matchName(w, known)[0]?.score ?? 0) >= NAME_SURE)
  }

  private llmContext(): LlmContext {
    const last = this.snap.last
    const c = last && this.snap.customers.find((x) => x.cid === last.cid)
    return {
      lang: LOCALE[this.lang],
      customers: this.snap.customers.flatMap((x) => [x.name, ...x.aliases]),
      lastEntry: last && c ? `${c.name} ${last.direction} ${last.paise / 100}` : undefined,
    }
  }

  // ------------------------------------------------------------------ dialogue
  private dispatch(intent: Intent, text: string, snrDb: number | null, noisy: boolean, path: 'fast' | 'llm'): Reply | null {
    const R = say(this.lang)
    switch (intent.type) {
      case 'entries': {
        const drafts = intent.entries.map((e) => this.draftFrom(e, text, snrDb, noisy, path))
        return this.processDrafts(drafts, { parts: [], ops: [] })
      }
      case 'correct':
        return this.correctLast(intent)
      case 'undo': {
        const last = this.snap.last
        if (!last) return { parts: [R.nothingToUndo()], ops: [] }
        return { parts: [R.undone()], ops: [{ op: 'void', eid: last.eid, reason: 'spoken undo' }] }
      }
      case 'yes':
      case 'no':
        return null // nothing pending: ignore stray haan/nahi
      case 'query': {
        if (intent.scope === 'customer' && intent.name) {
          const c = this.lookup(intent.name)
          if (!c) return { parts: [R.notFound(intent.name)], ops: [] }
          this.deps.send({ type: 'show', view: 'customer', cid: c.cid })
          return { parts: [R.balance(c.name, c.balancePaise / 100)], ops: [] }
        }
        if (intent.scope === 'today_credit' || intent.scope === 'today_payment') {
          const d = this.snap.today
          return { parts: [R.daySummary(d.creditPaise / 100, d.paymentPaise / 100, d.entries)], ops: [] }
        }
        return this.duesReply()
      }
      case 'summary': {
        const d = intent.period === 'month' ? this.snap.month : this.snap.today
        this.deps.send({ type: 'show', view: 'summary' })
        const f = intent.period === 'month' ? R.monthSummary : R.daySummary
        return { parts: [f(d.creditPaise / 100, d.paymentPaise / 100, d.entries)], ops: [] }
      }
      case 'remind': {
        if (!intent.name) return this.duesReply()
        const c = this.lookup(intent.name)
        if (!c) return { parts: [R.notFound(intent.name)], ops: [] }
        if (c.balancePaise <= 0) return { parts: [R.balance(c.name, c.balancePaise / 100)], ops: [] }
        if (!c.remindersOptIn || !c.adult) return { parts: [R.remindNotAllowed(c.name)], ops: [] }
        const msg = guardReply(R.reminderText(c.name, c.balancePaise / 100, this.snap.shopName))
        if (msg) this.deps.send({ type: 'remind', cid: c.cid, text: msg })
        return { parts: [R.remindReady(c.name)], ops: [] }
      }
      case 'privacy':
        this.deps.send({ type: 'show', view: 'privacy' })
        return { parts: [R.privacy()], ops: [] }
      case 'delete_all':
        this.pending = { kind: 'delete' }
        return { parts: [R.deleteAsk()], ops: [] }
      case 'unknown':
        // background talk to a customer is ignored; only speak up if it sounded like ledger talk
        if (mentionsMoney(text)) return { parts: [noisy ? R.noisyRepeat() : R.didNotCatch()], ops: [] }
        return null
    }
  }

  private duesReply(): Reply {
    const R = say(this.lang)
    const owing = this.snap.customers.filter((c) => c.balancePaise > 0)
    this.deps.send({ type: 'show', view: 'dues' })
    if (!owing.length) return { parts: [R.noDues()], ops: [] }
    return { parts: [R.dues(owing.length, owing.reduce((s, c) => s + c.balancePaise, 0) / 100)], ops: [] }
  }

  private draftFrom(e: EntryIntent, transcript: string, snrDb: number | null, noisy: boolean, path: 'fast' | 'llm'): Draft {
    return {
      heardName: e.name,
      cid: null,
      newName: null,
      nameSure: false,
      paise: Math.round(e.amount.value * 100),
      alt: e.reasons.includes('confusable') && e.amount.alternatives.length ? e.amount.alternatives[0] : null,
      direction: e.direction,
      dayOffset: e.dayOffset,
      promise: e.promise,
      confidence: e.confidence,
      reasons: e.reasons,
      path,
      transcript,
      snrDb,
      noisy,
    }
  }

  /** Customer lookup for queries: best match at NEAR or better. */
  private lookup(name: string): SnapCustomer | null {
    const m = matchName(name, this.snap.customers.map((c) => ({ id: c.cid, names: [c.name, ...c.aliases] })))[0]
    return m && m.score >= NAME_NEAR ? this.snap.customers.find((c) => c.cid === m.id) ?? null : null
  }

  /** Resolve the heard name to a customer: sure / near (ask) / two candidates / new. */
  private resolveName(d: Draft): 'ok' | 'which' | SnapCustomer[] {
    if (d.cid || d.newName) return 'ok'
    const m = matchName(d.heardName!, this.snap.customers.map((c) => ({ id: c.cid, names: [c.name, ...c.aliases] })))
    const near = m.filter((x) => x.score >= NAME_NEAR)
    if (!near.length) {
      d.newName = titleCase(d.heardName!)
      d.nameSure = true
      return 'ok'
    }
    if (near.length >= 2 && near[1].score >= near[0].score - 0.03)
      return near.slice(0, 2).map((x) => this.snap.customers.find((c) => c.cid === x.id)!)
    d.cid = near[0].id
    d.nameSure = near[0].score >= NAME_SURE
    return 'ok'
  }

  private customerName(d: Draft): string {
    return d.newName ?? this.snap.customers.find((c) => c.cid === d.cid)?.name ?? d.heardName ?? ''
  }

  /** Walk drafts in order: save the sure ones, stop at the first that needs a question. */
  private processDrafts(drafts: Draft[], acc: Reply): Reply {
    const R = say(this.lang)
    while (drafts.length) {
      const d = drafts.shift()!
      if (!d.heardName && !d.cid && !d.newName) {
        this.pending = { kind: 'name', draft: d, queue: drafts }
        acc.parts.push(R.askName(d.paise / 100))
        return acc
      }
      const res = this.resolveName(d)
      if (Array.isArray(res)) {
        this.pending = { kind: 'which', draft: d, queue: drafts, options: res }
        acc.parts.push(R.askWhich(res[0].name, res[1].name))
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
        acc.parts.push(d.noisy ? R.noisyConfirm(name, d.paise / 100, d.direction) : R.confirm(name, d.paise / 100, d.direction))
        return acc
      }
      this.save(d, acc)
    }
    this.pending = null
    return acc
  }

  private needsConfirm(d: Draft): boolean {
    if (d.noisy || !d.nameSure) return true
    const hard = d.reasons.filter((r) => r !== 'name-inherited' && r !== 'llm' && r !== 'confusable-resolved')
    if (d.confidence === 'low' && hard.length) return true
    const c = d.cid ? this.snap.customers.find((x) => x.cid === d.cid) : null
    if (c?.typicalPaise && d.paise > ANOMALY_FACTOR * c.typicalPaise) return true
    return false
  }

  private save(d: Draft, acc: Reply) {
    const R = say(this.lang)
    if (d.newName && !d.cid) {
      d.cid = this.newId()
      acc.ops.push({ op: 'add_customer', cid: d.cid, name: d.newName })
      acc.parts.push(R.newCustomer(d.newName))
    }
    const name = this.customerName(d)
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
    acc.parts.push(d.promise ? R.savedPromise(name, d.paise / 100, d.dayOffset) : R.saved(name, d.paise / 100, d.direction!))
  }

  private answerPending(text: string, intent: Intent, snrDb: number | null, noisy: boolean, path: 'fast' | 'llm'): Reply | null {
    const R = say(this.lang)
    const p = this.pending!
    const acc: Reply = { parts: [], ops: [] }
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
    // a fresh, complete instruction replaces the question
    if (intent.type === 'entries' && intent.entries.every((e) => e.name && e.direction)) {
      this.pending = null
      return this.dispatch(intent, text, snrDb, noisy, path)
    }
    const d = p.draft
    switch (p.kind) {
      case 'confirm':
        if (intent.type === 'yes') {
          this.save(d, acc)
          return this.processDrafts(p.queue, acc)
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
            const res = this.resolveName(d)
            if (Array.isArray(res)) {
              this.pending = { kind: 'which', draft: d, queue: p.queue, options: res }
              return { parts: [R.askWhich(res[0].name, res[1].name)], ops: [] }
            }
          }
          this.save(d, acc) // the user just said the right value: no second confirmation
          return this.processDrafts(p.queue, acc)
        }
        return { parts: [R.didNotCatch()], ops: [] }
      case 'name': {
        const n = nameAnswer(text)
        if (!n) return { parts: [R.didNotCatch()], ops: [] }
        d.heardName = n
        return this.processDrafts([d, ...p.queue], acc)
      }
      case 'direction': {
        const dir = directionAnswer(text) ?? (intent.type === 'correct' ? intent.direction ?? null : null)
        // "yes"/"correct" does not say which: ask the same short question again
        if (!dir) return { parts: [intent.type === 'yes' ? R.askDirection(this.customerName(d), d.paise / 100) : R.didNotCatch()], ops: [] }
        d.direction = dir
        // the shopkeeper just stated the direction: only doubts about the amount itself remain
        d.reasons = d.reasons.filter((r) => AMOUNT_FLAGS.has(r))
        d.confidence = d.reasons.length ? 'low' : 'high'
        return this.processDrafts([d, ...p.queue], acc)
      }
      case 'which': {
        const n = nameAnswer(text) ?? text
        const m = matchName(n, p.options.map((c) => ({ id: c.cid, names: [c.name, ...c.aliases] })))
        if (!m.length || m[0].score < NAME_NEAR || (m[1] && m[1].score >= m[0].score - 0.01))
          return { parts: [R.askWhich(p.options[0].name, p.options[1].name)], ops: [] }
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

  private correctLast(intent: Extract<Intent, { type: 'correct' }>): Reply {
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
    return { parts: [R.corrected(name, (amend.paise ?? last.paise) / 100, amend.direction ?? last.direction)], ops }
  }

  private pendingView(): PendingView | null {
    const p = this.pending
    if (!p) return null
    if (p.kind === 'delete') return { kind: 'delete' }
    const d = p.draft
    return {
      kind: p.kind,
      name: this.customerName(d) || undefined,
      paise: d.paise,
      direction: d.direction,
      options: p.kind === 'which' ? p.options.map((c) => c.name) : p.kind === 'confusable' ? [String(d.paise / 100), String(d.alt)] : undefined,
    }
  }

  /** Keep the server's copy of the snapshot current until the phone sends a fresh one. */
  private applyLocal(op: LedgerOp) {
    const s = this.snap
    switch (op.op) {
      case 'add_customer':
        s.customers.push({ cid: op.cid, name: op.name, aliases: [], householdId: null, remindersOptIn: false, adult: false, balancePaise: 0, typicalPaise: null })
        this.stt?.setKeyterms(this.keyterms())
        break
      case 'entry': {
        if (op.promise) break
        const c = s.customers.find((x) => x.cid === op.cid)
        if (c) c.balancePaise += op.direction === 'credit' ? op.paise : -op.paise
        s.last = { eid: op.eid, cid: op.cid, paise: op.paise, direction: op.direction, day: '' }
        if (op.dayOffset === 0) {
          s.today.entries++
          if (op.direction === 'credit') s.today.creditPaise += op.paise
          else s.today.paymentPaise += op.paise
        }
        break
      }
      case 'amend': {
        const last = s.last
        if (!last || last.eid !== op.eid) break
        const sign = (d: Direction) => (d === 'credit' ? 1 : -1)
        const before = s.customers.find((x) => x.cid === last.cid)
        if (before) before.balancePaise -= sign(last.direction) * last.paise
        if (op.paise !== undefined) last.paise = op.paise
        if (op.direction) last.direction = op.direction
        if (op.cid) last.cid = op.cid
        const after = s.customers.find((x) => x.cid === last.cid)
        if (after) after.balancePaise += sign(last.direction) * last.paise
        break
      }
      case 'void': {
        const last = s.last
        if (last && last.eid === op.eid) {
          const c = s.customers.find((x) => x.cid === last.cid)
          if (c) c.balancePaise -= (last.direction === 'credit' ? 1 : -1) * last.paise
          s.last = null
        }
        break
      }
      case 'delete_all':
        s.customers = []
        s.last = null
        break
      case 'add_alias':
        break
    }
  }

  // ------------------------------------------------------------------ speech out
  /** Speak and stream audio; returns the time first audio was sent (or null). */
  private async speak(text: string): Promise<number | null> {
    this.bargeIn() // never talk over ourselves
    const ac = new AbortController()
    const start = this.now()
    let bytes = 0
    this.speaking = { ac, text, ducked: false, until: start + 60_000 }
    this.deps.send({ type: 'say', text })
    let first: number | null = null
    await this.deps.speak(text, LOCALE[this.lang], (pcm) => {
      if (first === null) first = this.now()
      bytes += pcm.length
      this.deps.sendAudio(pcm)
    }, ac.signal)
    if (!ac.signal.aborted) {
      this.deps.send({ type: 'audio_end' })
      // the phone plays in real time: we are "speaking" until that audio has played out
      if (this.speaking?.ac === ac) this.speaking.until = (first ?? start) + (bytes / 32000) * 1000 + 300
    }
    return first
  }

  close() {
    this.speaking?.ac.abort()
    this.stt?.close()
  }
}

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase())
}
