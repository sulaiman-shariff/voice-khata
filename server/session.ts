/**
 * One voice session: mic audio in, ledger ops + spoken replies out.
 *
 *   audio -> energy tracker (pause, SNR)  ─┐
 *        -> Prisma STT (partials, final) ──┼─> end of turn: text complete + 300 ms pause -> commit
 *                                          └─> final -> fast parser (or Haiku) -> dialogue -> ops + reply -> Timbre
 *
 * Dependencies are injected so the dialogue can be tested without the network.
 */
import { type Direction, type EntryIntent, type Intent, dangling, directionAnswer, hasUnplacedWords, mentionsChange, mentionsMoney, midList, nameAnswer, parseFast, refersBack, turnComplete } from '../shared/intent.js'
import { NAME_NEAR, NAME_SURE, matchName } from '../shared/names.js'
import { parseAmounts } from '../shared/numbers.js'
import type { ClientMsg, LedgerOp, PendingView, ServerMsg, SnapCustomer, SnapEntry, Snapshot, TurnMetrics } from '../shared/protocol.js'
import { type Lang, LOCALE, guardReply, langFromLocale, say, sayMore, stripTags } from '../shared/replies.js'
import { FRAME_SAMPLES, newEnergyState, pushFrame, resetUtterance, tooNoisy, utteranceSnrDb } from './turn/energy.js'
import type { LlmContext, LlmReading } from './parse/llm.js'
import { validate } from './parse/llm.js'

export interface SttLike {
  send(pcm: Buffer): void
  commit(): void
  setKeyterms(terms: string[]): void
  setLanguage?(locale: string): void
  close(): void
}
export interface SttCallbacks {
  onSpeechStart?: () => void
  onSpeechEnd?: () => void
  onPartial?: (text: string) => void
  onFinal?: (text: string, detectedLang?: string) => void
  onError?: (msg: string) => void
  onClose?: (code: number) => void
}
export interface SessionDeps {
  openStt: (locale: string, keyterms: string[], cb: SttCallbacks) => SttLike
  speak: (text: string, locale: string, onAudio: (pcm: Buffer) => void, signal: AbortSignal, speed?: 0.8 | 1 | 1.2) => Promise<{ firstAudioMs: number | null; bytes: number; cached?: boolean }>
  /** Pre-synthesize fixed phrases so speak() replays them without a TTS round trip. */
  warm?: (texts: string[], locale: string, speed: 0.8 | 1 | 1.2) => void
  llm: (text: string, ctx: LlmContext) => Promise<Partial<LlmReading>>
  /**
   * Optional second, independent transcription of a noisy turn's audio (Prisma REST,
   * verbatim). Returns the transcript; any error or timeout means "no second opinion".
   */
  transcribe2?: (pcm: Buffer, locale: string, keyterms: string[], previousText?: string) => Promise<{ text: string; lang?: string }>
  /** Also cross-check the amount of noisy money turns with transcribe2 (opt-in: it adds latency). */
  secondReading?: boolean
  send: (msg: ServerMsg) => void
  sendAudio: (pcm: Buffer) => void
  now?: () => number
  newId?: () => string
}

/** Pause after speech before an early commit, when the words already form a complete turn. */
export const EARLY_COMMIT_PAUSE_MS = 300
/** How long a line the recogniser closed mid-list waits for the rest of the list. */
export const MID_LIST_HOLD_MS = 1400
/** Longest wait while the shopkeeper is still speaking the rest of the list. */
export const MID_LIST_MAX_MS = 6000
const ANOMALY_FACTOR = 5
/** with no history for the customer, ₹10,000 or more is read back first */
const BIG_PAISE = 10_000_00
const PENDING_TTL_MS = 45_000
const TTS_TIMEOUT_MS = 10_000
/** words that point at an entry already written */
const POINTS_BACK = /wal[aei]\b|वाल[ाीे]|badl|बदल|change|galat|गलत|asal|असल|actually|instead|entry|एंट्री|\bkal\b|कल|yesterday|parso|परसों/i
const AMOUNT_FLAGS = new Set(['confusable', 'elided_scale', 'approx_range', 'bare_fraction', 'digit_sequence'])

type TurnTiming = { speechEnd: number; commitAt: number | null; finalAt: number; early: boolean; snrDb: number | null; noisy: boolean; pcm?: Buffer; lang?: string; heardAt?: number | null }
/** Audio kept for the second reading of a noisy turn (16 kHz s16le): the last 20 s at most. */
const UTT_AUDIO_MAX = 20 * 16000 * 2
/** Reopen the STT stream after this long, at a quiet moment (Prisma's cap is 15 min). */
const STT_REFRESH_MS = 14 * 60_000
/** A hard (LLM) turn that has not been read by now says a short filler. */
export const FILLER_AFTER_MS = 400
/** How long an unreadable turn waits for Prisma REST to hear it in another language. */
const RESCUE_WAIT_MS = 1500
/** How long a noisy turn waits for the second reading before going on without it. */
export const SECOND_READ_WAIT_MS = 1200
const minSnr = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.min(a, b))

interface Draft {
  heardName: string | null
  cid: string | null
  newName: string | null // set when this entry creates a customer
  nameSure: boolean
  /** the shopkeeper already said yes to a read-back that named this line (a list question) */
  confirmed?: boolean
  /** this line was read back on its own and the shopkeeper said yes */
  readBack?: boolean
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
  /** one question for a list that shared a single direction word */
  | { kind: 'batch'; drafts: Draft[] }
  /** read-back before changing or removing an older entry */
  | { kind: 'modify'; ops: LedgerOp[]; done: string; view: PendingView; focus: string }

interface Reply {
  parts: string[]
  ops: LedgerOp[]
  /** entries saved in this reply, and how many of them may be confirmed with a short ack */
  saved?: number
  ackable?: number
}

export class Session {
  lang: Lang = 'hi'
  snap: Snapshot = {
    shopName: 'Shop', customers: [], last: null, recent: [],
    today: { creditPaise: 0, paymentPaise: 0, entries: 0 }, month: { creditPaise: 0, paymentPaise: 0, entries: 0 },
  }
  private ptt = false
  private speed: 0.8 | 1 | 1.2 = 1
  /** read every saved entry back in full instead of a short ack (Settings) */
  private readBackAll = false
  /** when the "heard you" cue went out for the current utterance */
  private heardAt: number | null = null
  /** turnComplete() of the last partial, cached: maybeEarlyCommit runs every 32 ms frame */
  private completeFor = ''
  private completeVal = false
  private stt: SttLike | null = null
  private energy = newEnergyState()
  private frameCarry = Buffer.alloc(0)
  /** mic audio since the last final, for the second reading of a noisy turn */
  private uttAudio: Buffer[] = []
  private uttBytes = 0
  /** amounts the second reading heard for the turn being handled (null: none asked or none usable) */
  private secondAmounts: number[] | null = null
  private lastPartial = ''
  private committed = false
  private commitAt: number | null = null
  private earlyCommit = false
  private lastSpeechAt = 0
  /** a final that stopped mid-list, waiting to be joined with the next one */
  private held: { text: string; t: TurnTiming; since: number; timer: ReturnType<typeof setTimeout> } | null = null
  pending: Pending | null = null
  /** last few turns, for the model and for "uska / him / same" */
  private history: string[] = []
  /** the customer the conversation is about right now */
  private focusCid: string | null = null
  /** when the open question was asked: stale questions expire */
  private pendingAt = 0
  /** what we said last and until when it may echo back through the mic */
  private lastSaid: { text: string; until: number } | null = null
  private sttRetries = 0
  private sttOpenedAt = 0
  private closed = false
  private speaking: { ac: AbortController; text: string; ducked: boolean; until: number; filler?: boolean } | null = null
  /** the filler being spoken, so the reply waits for its audio instead of interleaving with it */
  private fillerP: Promise<unknown> | null = null
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
        this.snap.recent ??= []
        this.ptt = msg.ptt
        this.speed = msg.speed === 0.8 || msg.speed === 1.2 ? msg.speed : 1
        this.readBackAll = msg.readBack === true
        this.openStt()
        this.warmPhrases()
        if (msg.firstRun)
          this.enqueue(async () => {
            await this.speak(say(this.lang).disclosure())
          })
        break
      case 'snapshot':
        this.snap = msg.snapshot
        this.snap.recent ??= []
        this.stt?.setKeyterms(this.keyterms())
        break
      case 'ptt_start':
        this.ptt = true
        this.bargeIn()
        break
      case 'ptt_end':
        this.sendHeard()
        this.commit(false)
        break
      case 'tap':
        this.enqueue(() => this.handleText(msg.action === 'yes' ? 'haan' : msg.action === 'no' ? 'nahi' : 'undo', null, 'tap'))
        break
      case 'text':
        // typed lists: one line per entry reads like a spoken list with pauses
        if (msg.text.trim() && msg.text.length <= 2000)
          this.enqueue(() => this.handleText(msg.text.replace(/\s*[\r\n]+\s*/g, ', ').trim(), null, 'tap'))
        break
      case 'answer':
        if (msg.text.length <= 60) this.enqueue(() => this.handleText(msg.text, null, 'tap'))
        break
      case 'barge':
        this.bargeIn()
        break
      case 'speed':
        this.speed = msg.speed
        this.warmPhrases()
        break
      case 'readback':
        this.readBackAll = msg.on
        break
      case 'playback_done':
        if (this.speaking?.ducked) this.deps.send({ type: 'unduck' })
        this.speaking = null
        break
    }
  }

  /** The phrases that are spoken often and never change, ready in memory for this language and speed. */
  private warmPhrases() {
    const R = say(this.lang)
    this.deps.warm?.([R.ack(), R.filler(), R.didNotCatch()], LOCALE[this.lang], this.speed)
  }

  private keyterms(): string[] {
    return this.snap.customers.flatMap((c) => [c.name, ...c.aliases]).slice(0, 200)
  }

  private openStt() {
    const old = this.stt
    this.stt = null
    old?.close()
    this.sttOpenedAt = this.now()
    const stream: SttLike = this.deps.openStt(LOCALE[this.lang], this.keyterms(), {
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
      onFinal: (t, l) => this.onFinal(t, l),
      onError: (m) => this.deps.send({ type: 'error', message: `stt: ${m}` }),
      onClose: () => {
        // Prisma dropped the stream (idle timeout, session cap, network): reopen, with backoff
        if (this.stt !== stream) return // a stream we replaced on purpose
        if (this.closed || this.sttRetries >= 5) return
        const wait = 250 * 2 ** this.sttRetries++
        setTimeout(() => {
          if (!this.closed) this.openStt()
        }, wait).unref?.()
      },
    })
    this.stt = stream
  }

  /** Prisma ends every stream at 15 min (close 1001): swap to a fresh one at a quiet moment before that. */
  private maybeRefreshStt() {
    if (this.now() - this.sttOpenedAt < STT_REFRESH_MS || this.closed) return
    if (this.energy.inUtterance || this.committed || this.held || this.lastPartial) return
    this.openStt()
  }

  // ------------------------------------------------------------------ audio + end of turn
  onAudio(pcm: Buffer): void {
    this.stt?.send(pcm)
    if (this.deps.transcribe2) {
      this.uttAudio.push(pcm)
      this.uttBytes += pcm.length
      while (this.uttBytes - this.uttAudio[0].length > UTT_AUDIO_MAX) this.uttBytes -= this.uttAudio.shift()!.length
    }
    let buf = this.frameCarry.length ? Buffer.concat([this.frameCarry, pcm]) : pcm
    const FB = FRAME_SAMPLES * 2
    while (buf.length >= FB) {
      const frame = new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + FB))
      if (pushFrame(this.energy, frame)) this.lastSpeechAt = this.now()
      buf = buf.subarray(FB)
      this.maybeEarlyCommit()
    }
    this.maybeRefreshStt()
    this.frameCarry = Buffer.from(buf)
  }

  private maybeEarlyCommit() {
    if (this.ptt || !this.energy.inUtterance) return
    if (this.energy.silentMs < EARLY_COMMIT_PAUSE_MS) return
    if (this.lastPartial && (this.pending || mentionsMoney(this.lastPartial))) this.sendHeard()
    if (this.committed || !this.lastPartial) return
    if (this.completeFor !== this.lastPartial) {
      this.completeFor = this.lastPartial
      this.completeVal = turnComplete(this.lastPartial)
    }
    if (this.completeVal) this.commit(true)
  }

  /**
   * "Heard you": a tick on the phone ~300 ms after the shopkeeper stops, long before the reply
   * audio (end of turn itself is unchanged). Once per utterance, never while we are talking
   * (our own read-back would echo into the mic).
   */
  private sendHeard() {
    if (this.heardAt !== null || !this.lastPartial || this.isSpeaking()) return
    this.heardAt = this.now()
    this.deps.send({ type: 'heard' })
  }

  private commit(early: boolean) {
    if (this.committed) return
    this.committed = true
    this.commitAt = this.now()
    this.earlyCommit = early
    this.stt?.commit()
    const at = this.commitAt
    // Prisma sends no final when it had nothing buffered: do not stay "committed" forever
    setTimeout(() => {
      if (this.committed && this.commitAt === at) {
        this.committed = false
        this.commitAt = null
      }
    }, 2500).unref?.()
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

  private onFinal(text: string, detectedLang?: string) {
    const snrDb = utteranceSnrDb(this.energy)
    const noisy = tooNoisy(this.energy)
    const speechEnd = this.lastSpeechAt
    const commitAt = this.commitAt
    const early = this.earlyCommit
    const finalAt = this.now()
    const pcm = this.takeUttAudio()
    const heardAt = this.heardAt
    this.heardAt = null
    resetUtterance(this.energy)
    this.committed = false
    this.commitAt = null
    this.earlyCommit = false
    this.lastPartial = ''
    if (!text.trim()) return
    this.sttRetries = 0
    if (this.isEcho(text)) return // our own reply heard back through the phone speaker
    let t: TurnTiming = { speechEnd, commitAt, finalAt, early, snrDb, noisy, pcm, lang: detectedLang, heardAt }
    if (this.held) {
      // the rest of a list the recogniser split at a breath: one turn, as spoken
      clearTimeout(this.held.timer)
      // a list continues after a comma; a sentence cut after "रमेश का" continues with a space
      const sep = dangling(this.held.text.replace(/[।.]\s*$/, '')) ? ' ' : ', '
      text = `${this.held.text.trim().replace(/[।.]$/, '')}${sep}${text.trim()}`
      const both = this.held.t.pcm && pcm ? Buffer.concat([this.held.t.pcm, pcm]) : pcm
      t = { ...t, noisy: t.noisy || this.held.t.noisy, snrDb: minSnr(t.snrDb, this.held.t.snrDb), pcm: both }
      this.held = null
    } else if (commitAt === null && !this.ptt && !this.pending && (midList(text) || dangling(text))) {
      const since = this.now()
      this.held = { text, t, since, timer: setTimeout(() => this.releaseHeld(), MID_LIST_HOLD_MS) }
      this.held.timer.unref?.()
      this.deps.send({ type: 'partial', text })
      return
    }
    this.dispatchFinal(text, t)
  }

  private takeUttAudio(): Buffer | undefined {
    if (!this.uttAudio.length) return undefined
    const pcm = Buffer.concat(this.uttAudio)
    this.uttAudio = []
    this.uttBytes = 0
    return pcm
  }

  /**
   * Second, independent reading of a noisy money turn: Prisma REST in verbatim format (numbers
   * spelled out, read by our own number parser) on the same audio. Resolves to the amounts it
   * heard (rupees), or null when there is no usable second opinion.
   */
  private secondReading(read: Promise<{ text: string; lang?: string } | null>, text: string): Promise<number[] | null> {
    const amounts = read
      .then((r) => {
        // heard in another language: that is the rescue's business, not a second opinion on the amount
        if (!r || (r.lang && r.lang !== LOCALE[this.lang])) return null
        const t2 = r.text
        if (process.env.VK_DEBUG) console.log('[second]', JSON.stringify({ text, t2 }))
        const v = parseAmounts(t2).map((a) => a.value)
        return v.length ? v : null
      })
    const wait = new Promise<null>((resolve) => setTimeout(() => resolve(null), SECOND_READ_WAIT_MS).unref?.())
    return Promise.race([amounts, wait])
  }

  /**
   * A voice turn nobody could read: maybe the shopkeeper spoke another language than the one
   * picked (realtime Prisma forces the session language and returns garble). Prisma REST follows
   * the spoken language; when it hears another supported language AND that text reads as a
   * ledger turn, switch the session to it and use that reading.
   */
  /** One Prisma REST reading of this turn's audio, shared by the second reading and the rescue (REST allows one request at a time). */
  private restRead(pcm: Buffer | undefined): Promise<{ text: string; lang?: string } | null> | null {
    if (!pcm || !this.deps.transcribe2 || pcm.length < 16000) return null
    const prev = this.history.length ? this.history[this.history.length - 1].replace(/^\w+: /, '') : undefined
    return Promise.race([
      this.deps.transcribe2(pcm, LOCALE[this.lang], this.keyterms(), prev).catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), RESCUE_WAIT_MS).unref?.()),
    ])
  }

  /**
   * Unreadable, or money with no readable direction AND words we could not place: the verbs may
   * be in another language. A plain "Ramesh, 400" has nothing unplaced, so it asks at once
   * instead of waiting for Prisma REST (that wait cost 0.5-1.4 s per turn in the e2e suite).
   */
  private static rescuable(intent: Intent, text: string): boolean {
    if (intent.type === 'unknown') return true
    return intent.type === 'entries' && intent.entries.some((e) => !e.direction && !e.promise) &&
      hasUnplacedWords(text, intent.entries.map((e) => e.name))
  }

  private async languageRescue(read: Promise<{ text: string; lang?: string } | null>): Promise<{ text: string; intent: Intent } | null> {
    const r = await read
    if (!r?.lang || !r.text.trim()) return null
    const lang = langFromLocale(r.lang)
    if (lang === this.lang || LOCALE[lang] !== r.lang) return null
    const intent = parseFast(r.text)
    if (intent.type === 'unknown' || intent.type === 'yes' || intent.type === 'no') return null
    if (intent.type === 'entries' && intent.entries.some((e) => !e.direction && !e.promise)) return null // no better than what we had
    if (process.env.VK_DEBUG) console.log('[rescue]', JSON.stringify({ from: this.lang, to: lang, text: r.text }))
    this.switchLang(lang)
    this.deps.send({ type: 'final', text: r.text })
    return { text: r.text, intent }
  }

  /** Replies, and the realtime stream (update_settings, no reconnect), follow the shopkeeper's language. */
  private switchLang(lang: Lang) {
    if (process.env.VK_DEBUG) console.log('[switch-lang]', this.lang, '->', lang)
    this.lang = lang
    this.stt?.setLanguage?.(LOCALE[lang])
    this.deps.send({ type: 'lang', lang })
    this.warmPhrases()
  }

  /**
   * Realtime Prisma tagged this turn with another language and it reads as a ledger turn: switch.
   * Never on English (Hinglish code-mixing is normal) and never Hindi <-> Marathi (same script;
   * the docs warn short clips are tagged hi-IN).
   */
  private followDetectedLang(detected: string | undefined, intent: Intent) {
    if (!detected) return
    const lang = langFromLocale(detected)
    if (LOCALE[lang] !== detected || lang === this.lang || lang === 'en') return
    if ((lang === 'hi' && this.lang === 'mr') || (lang === 'mr' && this.lang === 'hi')) return
    if (intent.type === 'unknown' || intent.type === 'yes' || intent.type === 'no') return
    this.switchLang(lang)
  }

  private dispatchFinal(text: string, t: TurnTiming) {
    this.deps.send({ type: 'final', text })
    if (this.speaking?.ducked) this.bargeIn()
    this.enqueue(() => this.handleText(text, t, 'voice'))
  }

  /** Nothing more came after a mid-list line: handle it as it is (unless the rest is still being spoken). */
  private releaseHeld() {
    const h = this.held
    if (!h || this.closed) return
    if (this.energy.inUtterance && this.now() - h.since < MID_LIST_MAX_MS) {
      h.timer = setTimeout(() => this.releaseHeld(), 300)
      h.timer.unref?.()
      return
    }
    this.held = null
    this.dispatchFinal(h.text, h.t)
  }

  private isEcho(text: string): boolean {
    const said = this.speaking?.text ?? (this.lastSaid && this.now() < this.lastSaid.until ? this.lastSaid.text : null)
    if (!said) return false
    const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    const t = norm(text)
    return t.length >= 6 && norm(said).includes(t)
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
    t: TurnTiming | null,
    _src: 'voice' | 'tap',
  ): Promise<void> {
    const t0 = this.now()
    // started now so it runs alongside parsing; only noisy money turns ask for it
    let intent: Intent = parseFast(text)
    let path: 'fast' | 'llm' | 'none' = 'fast'
    let llmMs: number | undefined
    const snrDb = t?.snrDb ?? null
    const noisy = t?.noisy ?? false
    // a question left hanging (shopkeeper turned to a customer) expires instead of catching a later "haan"
    if (this.pending && this.now() - this.pendingAt > PENDING_TTL_MS) this.pending = null
    // a turn that does not read may be in another language: ask Prisma REST now, decide after parsing
    const wantRescue = !this.pending && Session.rescuable(intent, text)
    const wantSecond = !!this.deps.secondReading && !!t?.noisy && mentionsMoney(text)
    const rest = wantRescue || wantSecond ? this.restRead(t?.pcm) : null
    // started now so they run alongside parsing
    const second = rest && wantSecond ? this.secondReading(rest, text) : null
    const rescue = wantRescue ? rest : null

    let unsureChange = false
    let fillerSaid = false
    if (!this.pending && this.needsLlm(text, intent)) {
      const change = this.isChangeTalk(text, intent)
      const l0 = this.now()
      // a model turn takes ~1-1.5 s: say "one second" if it is not back soon, so it never feels dead
      const filler = setTimeout(() => {
        fillerSaid = true
        this.fillerP = this.speak(say(this.lang).filler(), { filler: true })
      }, FILLER_AFTER_MS)
      filler.unref?.()
      try {
        const ctx = this.llmContext()
        const reading = await this.deps.llm(text, ctx).finally(() => clearTimeout(filler))
        if (process.env.VK_DEBUG) console.log('[llm]', JSON.stringify({ text, reading, recent: ctx.recent }))
        const v = validate(text, reading, ctx.contextAmounts, ctx.recent?.length ?? 0)
        // a model "no"/"unknown" never overrides a usable fast reading
        if ((v.type !== 'unknown' && v.type !== 'no') || intent.type === 'unknown') intent = v
        else if (change) unsureChange = true
        path = 'llm'
      } catch {
        unsureChange = change
      }
      // a change to an older entry that could not be read must not fall back to changing the last one
      if (unsureChange && intent.type !== 'modify') intent = { type: 'unknown' }
      llmMs = this.now() - l0
    }
    if (rescue && !this.pending && Session.rescuable(intent, text)) {
      const rescued = await this.languageRescue(rescue)
      if (rescued) ({ text, intent } = rescued)
    } else if (!this.pending) this.followDetectedLang(t?.lang, intent)
    const parseMs = this.now() - t0
    this.secondAmounts = second ? await second : null

    const before = this.pending
    let reply = this.pending
      ? this.answerPending(text, intent, snrDb, noisy, path === 'llm' ? 'llm' : 'fast')
      : this.dispatch(intent, text, snrDb, noisy, path === 'llm' ? 'llm' : 'fast')
    if (!reply && unsureChange) reply = { parts: [say(this.lang).didNotCatch()], ops: [] }
    // one confident save: the screen shows name and amount, so a short "noted" is enough
    if (reply && !this.readBackAll && reply.saved === 1 && reply.ackable === 1 && reply.parts.length === 1)
      reply.parts = [say(this.lang).ack()]
    if (this.pending && this.pending !== before) this.pendingAt = this.now()
    this.secondAmounts = null
    if (!reply) path = 'none'
    this.remember(`Shopkeeper: ${text}`)
    if (reply?.parts.length) this.remember(`Agent: ${reply.parts.join(' ')}`)

    if (reply?.ops.length) {
      for (const op of reply.ops) this.applyLocal(op)
      this.deps.send({ type: 'ops', ops: reply.ops })
    }
    this.deps.send({ type: 'pending', pending: this.pendingView() })

    let firstAudioAt: number | null = null
    let spoken: { bytes: number; cached: boolean } | null = null
    if (reply?.parts.length) {
      const r = await this.speak(reply.parts.join(' '))
      firstAudioAt = r.first
      spoken = r
    } else if (fillerSaid) this.deps.send({ type: 'audio_end' }) // the filler was all we had to say

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
        heardAt: t.heardAt == null ? null : t.heardAt - base,
        replyChars: reply?.parts.join(' ').length ?? 0,
        replyAudioMs: spoken ? Math.round(spoken.bytes / 32) : 0,
        cached: spoken?.cached ?? false,
      }
      this.deps.send({ type: 'metrics', turn: m })
      if (process.env.VK_DEBUG) console.log('[metrics]', JSON.stringify({ ...m, text }))
    }
    this.deps.send({ type: 'turn_done' })
  }

  private remember(line: string) {
    this.history.push(line.slice(0, 300))
    if (this.history.length > 8) this.history.splice(0, this.history.length - 8)
  }

  /** Known customers named in the text (sure matches only). */
  private namedCids(text: string): string[] {
    const known = this.snap.customers.map((c) => ({ id: c.cid, names: [c.name, ...c.aliases] }))
    const out = new Set<string>()
    for (const raw of text.split(/[\s,.;:!?।]+/)) {
      const w = raw.replace(/['’]s$/i, '') // "Geeta's"
      if (w.length < 3) continue
      const m = matchName(w, known)[0]
      if (m && m.score >= NAME_SURE) out.add(m.id)
    }
    return [...out]
  }

  /**
   * Changing or removing something already written, about a named customer ("Geeta wali entry hata do",
   * "Ramesh ka kal wala 340 asal mein 430"): the model picks which entry from the numbered list.
   */
  private isChangeTalk(text: string, intent: Intent): boolean {
    const recent = this.snap.recent ?? []
    if (recent.length < 2 || !mentionsChange(text)) return false
    // a new entry with an in-breath slip ("Ramesh ko 500 nahi 300") is not a change; "kal wala", "galat tha" are
    if (intent.type === 'entries' && !POINTS_BACK.test(text)) return false
    const named = this.namedCids(text)
    return named.some((cid) => cid !== this.snap.last?.cid) || (named.length > 0 && POINTS_BACK.test(text))
  }

  private needsLlm(text: string, intent: Intent): boolean {
    const recent = this.snap.recent ?? []
    if (this.isChangeTalk(text, intent)) return true
    if (intent.type === 'entries') {
      const unsure = intent.entries.some((e) => e.reasons.includes('no-name') || e.reasons.includes('no-direction-cue'))
      // "uska 100 aur udhaar": the conversation already says who
      if (this.focusCid && refersBack(text) && !intent.entries.some((e) => e.reasons.includes('no-direction-cue'))) return false
      // "Ramesh, 300": nothing for a model to read; asking the missing part is faster
      return unsure && hasUnplacedWords(text, intent.entries.map((e) => e.name))
    }
    if (intent.type === 'query' && !intent.name && this.focusCid && refersBack(text)) return false
    if (intent.type !== 'unknown') return false
    // "same for Suresh", "him too": only the conversation can say what that means
    if (refersBack(text) && (this.focusCid || recent.length)) return true
    // only spend an LLM call when the words look like ledger talk
    if (mentionsMoney(text)) return true
    const known = this.snap.customers.map((c) => ({ id: c.cid, names: [c.name, ...c.aliases] }))
    return text.split(/\s+/).some((w) => w.length > 2 && (matchName(w, known)[0]?.score ?? 0) >= NAME_SURE)
  }

  private nameOf(cid: string): string {
    return this.snap.customers.find((c) => c.cid === cid)?.name ?? '?'
  }

  private llmContext(): LlmContext {
    const recent = (this.snap.recent ?? []).slice(0, 12)
    const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10) // shops are in IST
    const when = (e: SnapEntry) => {
      const d = e.day ? Math.round((Date.parse(e.day) - Date.parse(today)) / 86_400_000) : 0
      return d === 0 ? 'today' : d === -1 ? 'yesterday' : d === 1 ? 'tomorrow' : e.day
    }
    const focus = this.focusCid ? this.nameOf(this.focusCid) : null
    return {
      lang: LOCALE[this.lang],
      customers: this.snap.customers.flatMap((x) => [x.name, ...x.aliases]),
      recent: recent.map((e, i) => `#${i + 1} ${this.nameOf(e.cid)} ${e.promise ? 'promise' : e.direction} ${e.paise / 100} ${when(e)}`),
      history: focus ? [...this.history.slice(-6), `(customer being discussed: ${focus})`] : this.history.slice(-6),
      contextAmounts: recent.map((e) => e.paise / 100),
    }
  }

  // ------------------------------------------------------------------ dialogue
  private dispatch(intent: Intent, text: string, snrDb: number | null, noisy: boolean, path: 'fast' | 'llm'): Reply | null {
    const R = say(this.lang)
    switch (intent.type) {
      case 'entries': {
        const drafts = intent.entries.map((e) => this.draftFrom(e, text, snrDb, noisy, path))
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
      case 'modify':
        return this.modifyEntry(intent)
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
        if ((!intent.name || !this.lookup(intent.name)) && this.focusCid && refersBack(text)) {
          const c = this.snap.customers.find((x) => x.cid === this.focusCid)
          if (c) {
            this.deps.send({ type: 'show', view: 'customer', cid: c.cid })
            return { parts: [R.balance(c.name, c.balancePaise / 100)], ops: [] }
          }
        }
        if (intent.scope === 'customer' && intent.name) {
          const c = this.lookup(intent.name)
          if (!c) return { parts: [R.notFound(intent.name)], ops: [] }
          this.focusCid = c.cid
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
        if (!msg) return { parts: [R.didNotCatch()], ops: [] }
        this.deps.send({ type: 'remind', cid: c.cid, text: msg })
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

  private batchItems(drafts: Draft[]) {
    return drafts.map((d) => ({
      name: d.cid ? this.nameOf(d.cid) : d.heardName ? titleCase(d.heardName) : '?',
      amt: d.paise / 100,
    }))
  }

  /** Change or remove any recent entry. The newest one changes at once (like "nahi, 430"); older ones are read back first. */
  private modifyEntry(intent: Extract<Intent, { type: 'modify' }>): Reply {
    const R = say(this.lang)
    const M = sayMore(this.lang)
    const e = (this.snap.recent ?? [])[intent.ref - 1]
    if (!e) return { parts: [R.didNotCatch()], ops: [] }
    const oldName = this.nameOf(e.cid)
    if (intent.remove) {
      const ops: LedgerOp[] = [{ op: 'void', eid: e.eid, reason: 'spoken remove' }]
      const done = M.removed(oldName, e.paise / 100)
      if (intent.ref === 1) return { parts: [done], ops }
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
    if (intent.ref === 1) {
      this.focusCid = focus
      return { parts: [done], ops }
    }
    this.pending = { kind: 'modify', ops, done, focus, view: { kind: 'modify', name, paise, direction: dir } }
    return { parts: [M.changeAsk(name, paise / 100, dir)], ops: [] }
  }

  private duesReply(): Reply {
    const R = say(this.lang)
    const owing = this.snap.customers.filter((c) => c.balancePaise > 0)
    this.deps.send({ type: 'show', view: 'dues' })
    if (!owing.length) return { parts: [R.noDues()], ops: [] }
    return { parts: [R.dues(owing.length, owing.reduce((s, c) => s + c.balancePaise, 0) / 100)], ops: [] }
  }

  private draftFrom(e: EntryIntent, transcript: string, snrDb: number | null, noisy: boolean, path: 'fast' | 'llm'): Draft {
    let alt = e.reasons.includes('confusable') && e.amount.alternatives.length ? e.amount.alternatives[0] : null
    const reasons = [...e.reasons]
    const sec = this.secondAmounts
    if (alt === null && sec && !sec.includes(e.amount.value)) {
      // the second reading of this noisy audio heard a different number: ask which, never guess
      const other = sec.length === 1 ? sec[0] : null
      if (other !== null && other > 0) {
        alt = other
        reasons.push('second-reading-differs')
      }
    } else if (sec?.includes(e.amount.value)) reasons.push('second-reading-agrees')
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
      if (d.paise <= 0) {
        acc.parts.push(R.didNotCatch())
        continue
      }
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
    acc.parts.push(d.promise ? R.savedPromise(name, d.paise / 100, d.dayOffset) : R.saved(name, d.paise / 100, d.direction!))
    acc.saved = (acc.saved ?? 0) + 1
    if (this.ackable(d)) acc.ackable = (acc.ackable ?? 0) + 1
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

  private answerPending(text: string, intent: Intent, snrDb: number | null, noisy: boolean, path: 'fast' | 'llm'): Reply | null {
    const R = say(this.lang)
    const p = this.pending!
    const acc: Reply = { parts: [], ops: [] }
    if (p.kind === 'batch') return this.answerBatch(p.drafts, text, intent, snrDb, noisy, path)
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
        return { parts: [p.done], ops: p.ops }
      }
      // anything else is a new instruction: drop the question and handle it
      return intent.type === 'unknown' ? { parts: [R.notSaved()], ops: [] } : this.dispatch(intent, text, snrDb, noisy, path)
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
          d.readBack = true
          this.save(d, acc)
          return this.processDrafts(p.queue, acc)
        }
        if (intent.type === 'entries' && refersBack(text)) {
          // "usko 50 aur" while a read-back is open is a new line about the person being asked about,
          // not a fix to that line (which stays unwritten: we say so)
          this.pending = null
          if (d.cid) this.focusCid = d.cid
          const r = this.dispatch(intent, text, snrDb, noisy, path)
          return { parts: [R.notSaved(), ...(r?.parts ?? [])], ops: r?.ops ?? [] }
        }
        if (intent.type === 'entries' && intent.entries[0]?.name) {
          const other = this.lookup(intent.entries[0].name)
          const same = other ? other.cid === d.cid : !!d.newName && titleCase(intent.entries[0].name) === d.newName
          if (!same) {
            // "Suresh 200" in reply to "Ramesh 500, correct?": not a yes, a different entry
            this.pending = null
            const r = this.dispatch(intent, text, snrDb, noisy, path)
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
            const res = this.resolveName(d)
            if (Array.isArray(res)) {
              this.pending = { kind: 'which', draft: d, queue: p.queue, options: res }
              return { parts: [R.askWhich(res[0].name, res[1].name)], ops: [] }
            }
          }
          this.save(d, acc) // the user just said the right value: no second confirmation
          return this.processDrafts(p.queue, acc)
        }
        return this.quietUnlessShort(text)
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

  private answerBatch(drafts: Draft[], text: string, intent: Intent, snrDb: number | null, noisy: boolean, path: 'fast' | 'llm'): Reply | null {
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
      return this.dispatch(intent, text, snrDb, noisy, path)
    }
    const first = drafts.find((d) => d.direction)
    return { parts: [first ? sayMore(this.lang).batchAsk(this.batchItems(drafts), first.direction!) : R.didNotCatch()], ops: [] }
  }

  /** Long talk with no answer in it is the shopkeeper talking to someone else: keep the question, stay quiet. */
  private quietUnlessShort(text: string): Reply | null {
    if (text.trim().split(/\s+/).length > 4 && !mentionsMoney(text)) return null
    return { parts: [say(this.lang).didNotCatch()], ops: [] }
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
    this.focusCid = amend.cid ?? last.cid
    return { parts: [R.corrected(name, (amend.paise ?? last.paise) / 100, amend.direction ?? last.direction)], ops }
  }

  private pendingView(): PendingView | null {
    const p = this.pending
    if (!p) return null
    if (p.kind === 'delete') return { kind: 'delete' }
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
      options: p.kind === 'which' ? p.options.map((c) => c.name) : p.kind === 'confusable' ? [String(d.paise / 100), String(d.alt)] : undefined,
    }
  }

  /** Keep the server's copy of the snapshot current until the phone sends a fresh one. */
  private applyLocal(op: LedgerOp) {
    const s = this.snap
    switch (op.op) {
      case 'add_customer':
        if (s.customers.some((x) => x.cid === op.cid)) break
        s.customers.push({ cid: op.cid, name: op.name, aliases: [], householdId: null, remindersOptIn: false, adult: false, balancePaise: 0, typicalPaise: null })
        this.stt?.setKeyterms(this.keyterms())
        break
      case 'entry': {
        const day = istDay(op.dayOffset)
        s.last = { eid: op.eid, cid: op.cid, paise: op.paise, direction: op.direction, day, promise: op.promise || undefined }
        s.recent = [{ ...s.last }, ...(s.recent ?? [])].slice(0, 20)
        if (op.promise) break // a promise is remembered, never posted to the balance
        const c = s.customers.find((x) => x.cid === op.cid)
        if (c) c.balancePaise += op.direction === 'credit' ? op.paise : -op.paise
        this.totals(day, op.direction, op.paise, 1)
        break
      }
      case 'amend': {
        const sign = (d: Direction) => (d === 'credit' ? 1 : -1)
        const copies = [s.last, ...(s.recent ?? [])].filter((e): e is SnapEntry => !!e && e.eid === op.eid)
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
        const e = [s.last, ...(s.recent ?? [])].find((x) => x && x.eid === op.eid)
        if (e && !e.promise) {
          const c = s.customers.find((x) => x.cid === e.cid)
          if (c) c.balancePaise -= (e.direction === 'credit' ? 1 : -1) * e.paise
          this.totals(e.day, e.direction, e.paise, -1)
        }
        s.recent = (s.recent ?? []).filter((x) => x.eid !== op.eid)
        if (s.last?.eid === op.eid) s.last = s.recent[0] ?? null
        break
      }
      case 'delete_all':
        s.customers = []
        s.last = null
        s.recent = []
        this.focusCid = null
        break
      case 'add_alias':
        break
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

  // ------------------------------------------------------------------ speech out
  /** Speak and stream audio; returns the time first audio was sent (or null). */
  private async speak(spoken: string, opts: { filler?: boolean } = {}): Promise<{ first: number | null; bytes: number; cached: boolean }> {
    // never talk over ourselves; a filler is the one thing the real reply follows instead of cutting
    if (!this.speaking?.filler) this.bargeIn()
    const ac = new AbortController()
    const start = this.now()
    let bytes = 0
    let cached = false
    const text = stripTags(spoken) // what the screen shows and what can echo back
    const prev = this.speaking?.filler ? this.speaking : null
    this.speaking = { ac, text: prev ? `${prev.text} ${text}` : text, ducked: false, until: start + 60_000, filler: opts.filler }
    if (prev) prev.ac.signal.addEventListener('abort', () => ac.abort()) // a barge-in on the filler cuts the reply too
    if (!opts.filler) this.deps.send({ type: 'say', text })
    if (prev && this.fillerP) await this.fillerP.catch(() => {})
    this.fillerP = null
    let first: number | null = null
    // a stalled TTS socket must not block every later turn
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        ac.abort()
        resolve()
      }, TTS_TIMEOUT_MS)
      timer.unref?.()
    })
    try {
      await Promise.race([
        this.deps.speak(spoken, LOCALE[this.lang], (pcm) => {
          if (ac.signal.aborted) return
          if (first === null) first = this.now()
          bytes += pcm.length
          this.deps.sendAudio(pcm)
        }, ac.signal, this.speed).then((r) => { cached = !!r.cached }),
        timeout,
      ])
    } catch (e) {
      this.deps.send({ type: 'error', message: `tts: ${String(e)}` })
    } finally {
      clearTimeout(timer)
    }
    this.lastSaid = { text: this.speaking?.ac === ac ? this.speaking.text : text, until: (first ?? start) + (bytes / 32000) * 1000 + 1500 }
    if (!ac.signal.aborted) {
      // a filler's audio runs straight into the reply: one playback, one audio_end
      if (!opts.filler) this.deps.send({ type: 'audio_end' })
      // the phone plays in real time: we are "speaking" until that audio has played out
      if (this.speaking?.ac === ac) this.speaking.until = (first ?? start) + (bytes / 32000) * 1000 + 300
    }
    return { first, bytes, cached }
  }

  close() {
    this.closed = true
    if (this.held) clearTimeout(this.held.timer)
    this.held = null
    this.speaking?.ac.abort()
    this.stt?.close()
  }
}

/** YYYY-MM-DD in India, offset by n days (the shop's calendar, not the server's). */
function istDay(n: number): string {
  return new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10)
}

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase())
}
