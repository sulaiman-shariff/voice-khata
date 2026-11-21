/**
 * One voice session: mic audio in, ledger ops + spoken replies out.
 *
 *   audio -> energy tracker (pause, SNR)  ─┐
 *        -> Prisma STT (partials, final) ──┼─> end of turn: text complete + 300 ms pause -> commit
 *                                          └─> final -> fast parser (or Haiku) -> dialogue -> ops + reply -> Timbre
 *
 * Dependencies are injected so the dialogue can be tested without the network.
 */
import { type Direction, type EntryIntent, type Intent, dangling, directionAnswer, hasNameWord, mentionsSettle, hasUnplacedWords, mentionsChange, mentionsMoney, midList, nameAnswer, parseFast, refersBack, turnComplete } from '../shared/intent.js'
import { NAME_NEAR, NAME_SURE, matchName } from '../shared/names.js'
import { parseAmounts } from '../shared/numbers.js'
import type { ClientMsg, LedgerOp, PendingView, ServerMsg, SnapCustomer, SnapEntry, Snapshot, TurnMetrics } from '../shared/protocol.js'
import { type Lang, LOCALE, guardReply, langFromLocale, say, sayMore, stripTags } from '../shared/replies.js'
import { FRAME_SAMPLES, newEnergyState, pushFrame, resetUtterance, tooNoisy, utteranceSnrDb } from './turn/energy.js'
import { type Logger, nullLogger } from './log.js'
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
  onOpen?: () => void
  /** Several languages heard the same utterance: the index of the transcript to use. */
  pick?: (heard: { text: string; locale: string }[]) => number
}
export interface SessionDeps {
  openStt: (locale: string, keyterms: string[], cb: SttCallbacks) => SttLike
  speak: (text: string, locale: string, onAudio: (pcm: Buffer) => void, signal: AbortSignal, speed?: 0.8 | 1 | 1.2) => Promise<{ firstAudioMs: number | null; bytes: number; cached?: boolean }>
  /** Pre-synthesize fixed phrases so speak() replays them without a TTS round trip. */
  warm?: (texts: string[], locale: string, speed: 0.8 | 1 | 1.2) => void
  llm: (text: string, ctx: LlmContext) => Promise<Partial<LlmReading>>
  send: (msg: ServerMsg) => void
  sendAudio: (pcm: Buffer) => void
  /** Structured logger for this session (server/log.ts); silent when absent. */
  log?: Logger
  /** Local test runs only (KB_RECORD_DIR): keep each turn's audio and what was made of it. */
  record?: (turn: Record<string, unknown>, pcm?: Buffer) => void
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
/** Ledger words per language, given to the recogniser as hints (see keyterms()). */
const LEDGER_TERMS: Record<string, string[]> = {
  en: ['credit', 'paid', 'udhaar', 'jama', 'rupees', 'clear'],
  hi: ['उधार', 'जमा', 'रुपये', 'दिए', 'लिए', 'चुकता'],
  kn: ['ಸಾಲ', 'ಉದ್ರಿ', 'ಜಮಾ', 'ರೂಪಾಯಿ', 'ಕೊಟ್ಟರು', 'ಬರೆಯಿರಿ'],
  ta: ['கடன்', 'வரவு', 'ரூபாய்', 'கொடுத்தார்'],
  te: ['అప్పు', 'జమ', 'రూపాయలు', 'ఇచ్చారు'],
  ml: ['കടം', 'വരവ്', 'രൂപ', 'തന്നു'],
  mr: ['उधार', 'जमा', 'रुपये', 'दिले'],
  bn: ['বাকি', 'জমা', 'টাকা', 'দিয়েছে'],
  gu: ['ઉધાર', 'જમા', 'રૂપિયા', 'આપ્યા'],
  pa: ['ਉਧਾਰ', 'ਜਮ੍ਹਾ', 'ਰੁਪਏ', 'ਦਿੱਤੇ'],
}
const TTS_TIMEOUT_MS = 10_000
/** words that point at an entry already written */
const POINTS_BACK = /wal[aei]\b|वाल[ाीे]|badl|बदल|change|galat|गलत|asal|असल|actually|instead|entry|एंट्री|\bkal\b|कल|yesterday|parso|परसों/i
const AMOUNT_FLAGS = new Set(['confusable', 'elided_scale', 'approx_range', 'bare_fraction', 'digit_sequence'])

type TurnTiming = { speechEnd: number; commitAt: number | null; finalAt: number; early: boolean; snrDb: number | null; noisy: boolean; pcm?: Buffer; lang?: string; heardAt?: number | null }
/** Audio kept for the turn (16 kHz s16le): the last 20 s at most. */
const UTT_AUDIO_MAX = 20 * 16000 * 2
/** Reopen the STT stream after this long, at a quiet moment (Prisma's cap is 15 min). */
const STT_REFRESH_MS = 14 * 60_000
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
  /** heard, not typed: a name in it may be a mishearing, so a new account is read back first */
  spoken: boolean
  /** the turn had only this one line: a known customer named anywhere in it is this line's customer */
  single?: boolean
  /** times the open question about this line was asked again (once at most, then it waits quietly) */
  reasked?: number
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
  | { kind: 'confirm' | 'name' | 'amount' | 'direction' | 'confusable'; draft: Draft; queue: Draft[] }
  | { kind: 'which'; draft: Draft; queue: Draft[]; options: SnapCustomer[] }
  | { kind: 'delete' }
  /** one question for a list that shared a single direction word */
  | { kind: 'batch'; drafts: Draft[] }
  /** read-back before changing or removing an older entry */
  | { kind: 'modify'; ops: LedgerOp[]; done: string; view: PendingView; focus: string }

interface SavedState {
  v: 1
  at: number
  lang: Lang
  pending: Pending | null
  pendingAgeMs: number
  focusCid: string | null
  history: string[]
}

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
  /** mic audio since the last final (16 kHz s16le) */
  private uttAudio: Buffer[] = []
  private uttBytes = 0
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
  /** the last utterance as heard in each language (MultiStt), for the turn record */
  private lastHeard: { text: string; locale: string }[] | null = null
  /** where the turn being handled came from (taps and typed text arrive as 'tap') */
  private turnSrc: 'voice' | 'tap' | 'resend' = 'voice'
  /** when the open question was asked: stale questions expire */
  private pendingAt = 0
  /** what we said last and until when it may echo back through the mic */
  private lastSaid: { text: string; until: number } | null = null
  private sttRetries = 0
  private sttOpenedAt = 0
  private closed = false
  private speaking: { ac: AbortController; text: string; ducked: boolean; until: number } | null = null
  private chain: Promise<void> = Promise.resolve()
  private now: () => number
  private newId: () => string

  private log: Logger
  /** ledger ops batches sent, and the ones the phone has not acknowledged yet */
  private opsSeq = 0
  private unacked = new Map<number, number>()
  /** voice/tap turns handled so far (logged as `turn`) */
  private turnNo = 0
  private startedAt = 0

  constructor(private deps: SessionDeps) {
    this.log = deps.log ?? nullLogger
    this.now = deps.now ?? (() => performance.now())
    this.startedAt = this.now()
    this.newId = deps.newId ?? (() => crypto.randomUUID())
  }

  // ------------------------------------------------------------------ client messages
  onClient(msg: ClientMsg): void {
    switch (msg.type) {
      case 'hello':
        this.log.info('hello', {
          lang: msg.lang, ptt: msg.ptt, speed: msg.speed ?? 1, readBack: !!msg.readBack, firstRun: msg.firstRun,
          customers: msg.snapshot.customers.length, todayEntries: msg.snapshot.today.entries,
        })
        this.lang = msg.lang
        this.snap = msg.snapshot
        this.snap.entries ??= []
        this.ptt = msg.ptt
        this.speed = msg.speed === 0.8 || msg.speed === 1.2 ? msg.speed : 1
        this.readBackAll = msg.readBack === true
        if (msg.resume) this.importState(msg.resume)
        this.openStt()
        this.warmPhrases()
        // always: the phone keeps showing its last question until told otherwise
        this.deps.send({ type: 'pending', pending: this.pendingView() })
        if (msg.resend && msg.resend.trim() && msg.resend.length <= 2000) {
          const text = msg.resend.trim()
          this.log.info('resend', { text })
          this.enqueue(() => this.handleText(text, null, 'resend'))
        }
        if (msg.firstRun)
          this.enqueue(async () => {
            await this.speak(say(this.lang).disclosure())
          })
        break
      case 'snapshot':
        this.log.debug('snapshot', { customers: msg.snapshot.customers.length, todayEntries: msg.snapshot.today.entries })
        this.snap = msg.snapshot
        this.snap.entries ??= []
        this.stt?.setKeyterms(this.keyterms())
        break
      case 'ptt_start':
        this.log.debug('ptt_start')
        this.ptt = true
        this.bargeIn()
        break
      case 'ptt_end':
        this.log.debug('ptt_end', { partial: this.lastPartial })
        this.sendHeard()
        this.commit(false)
        break
      case 'tap':
        this.log.info('input', { kind: 'tap', action: msg.action })
        this.enqueue(() => this.handleText(msg.action === 'yes' ? 'haan' : msg.action === 'no' ? 'nahi' : 'undo', null, 'tap'))
        break
      case 'text':
        this.log.info('input', { kind: 'typed', text: msg.text })
        // typed lists: one line per entry reads like a spoken list with pauses
        if (msg.text.trim() && msg.text.length <= 2000)
          this.enqueue(() => this.handleText(msg.text.replace(/\s*[\r\n]+\s*/g, ', ').trim(), null, 'tap'))
        break
      case 'answer':
        this.log.info('input', { kind: 'answer', text: msg.text })
        if (msg.text.length <= 60) this.enqueue(() => this.handleText(msg.text, null, 'tap'))
        break
      case 'barge':
        this.log.info('barge_in', { by: 'tap', speaking: !!this.speaking })
        this.bargeIn()
        break
      case 'speed':
        this.log.info('setting', { speed: msg.speed })
        this.speed = msg.speed
        this.warmPhrases()
        break
      case 'ack':
        this.unacked.delete(msg.seq)
        break
      case 'readback':
        this.log.info('setting', { readBack: msg.on })
        this.readBackAll = msg.on
        break
      case 'playback_done':
        this.log.debug('playback_done')
        if (this.speaking?.ducked) this.deps.send({ type: 'unduck' })
        this.speaking = null
        break
    }
  }

  /** The phrases that are spoken often and never change, ready in memory for this language and speed. */
  private warmPhrases() {
    const R = say(this.lang)
    this.deps.warm?.([R.ack(), R.didNotCatch()], LOCALE[this.lang], this.speed)
  }

  /**
   * Hints for Prisma: customer names, then the ledger words of the language (and the English ones
   * shopkeepers mix in). Measured on recorded turns: "500 pet" -> "500 paid", "uthar clear" ->
   * "udhaar clear", and a name lost in chatter came back.
   */
  private keyterms(): string[] {
    const names = this.snap.customers.flatMap((c) => [c.name, ...c.aliases])
    return [...names, ...(LEDGER_TERMS[this.lang] ?? []), ...LEDGER_TERMS.en].filter((x, i, a) => a.indexOf(x) === i).slice(0, 200)
  }

  private openStt(reason = 'hello') {
    this.log.info('stt_open', { reason, locale: LOCALE[this.lang], keyterms: this.keyterms().length })
    const old = this.stt
    this.stt = null
    old?.close()
    this.sttOpenedAt = this.now()
    const t0 = this.now()
    const stream: SttLike = this.deps.openStt(LOCALE[this.lang], this.keyterms(), {
      onOpen: () => this.log.info('stt_ready', { reason, ms: this.now() - t0 }),
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
      pick: (heard) => this.pickHeard(heard),
      onError: (m) => {
        // a stream torn down with its session is not worth a warning
        if (this.closed) this.log.debug('stt_error_after_close', { message: m })
        else this.log.warn('stt_error', { message: m })
        this.deps.send({ type: 'error', message: `stt: ${m}` })
      },
      onClose: (code) => {
        // Prisma dropped the stream (idle timeout, session cap, network): reopen, with backoff
        if (this.stt !== stream) return // a stream we replaced on purpose
        if (this.closed) return
        if (this.sttRetries >= 5) {
          this.log.error('stt_gave_up', { code, retries: this.sttRetries })
          return
        }
        const wait = 250 * 2 ** this.sttRetries++
        this.log.warn('stt_closed', { code, retry: this.sttRetries, waitMs: wait })
        setTimeout(() => {
          if (!this.closed) this.openStt('reconnect')
        }, wait).unref?.()
      },
    })
    this.stt = stream
  }

  /** Prisma ends every stream at 15 min (close 1001): swap to a fresh one at a quiet moment before that. */
  private maybeRefreshStt() {
    if (this.now() - this.sttOpenedAt < STT_REFRESH_MS || this.closed) return
    if (this.energy.inUtterance || this.committed || this.held || this.lastPartial) return
    this.openStt('refresh')
  }

  // ------------------------------------------------------------------ audio + end of turn
  onAudio(pcm: Buffer): void {
    this.stt?.send(pcm)
    this.uttAudio.push(pcm)
    this.uttBytes += pcm.length
    while (this.uttBytes - this.uttAudio[0].length > UTT_AUDIO_MAX) this.uttBytes -= this.uttAudio.shift()!.length
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
    this.log.debug('heard', { afterSpeechMs: this.heardAt - this.lastSpeechAt, partial: this.lastPartial })
    this.deps.send({ type: 'heard' })
  }

  private commit(early: boolean) {
    if (this.committed) return
    this.committed = true
    this.commitAt = this.now()
    this.earlyCommit = early
    this.log.debug('commit', { early, afterSpeechMs: this.commitAt - this.lastSpeechAt, partial: this.lastPartial })
    this.stt?.commit()
    const at = this.commitAt
    // Prisma sends no final when it had nothing buffered: do not stay "committed" forever
    setTimeout(() => {
      if (this.committed && this.commitAt === at) {
        this.log.warn('commit_no_final', { waitedMs: 2500 })
        this.committed = false
        this.commitAt = null
      }
    }, 2500).unref?.()
  }

  private onPartial(text: string) {
    this.lastPartial = text
    this.log.debug('partial', { text })
    this.deps.send({ type: 'partial', text })
    // two-stage barge-in: real words that are not our own echo stop the reply
    if (this.isSpeaking() && this.speaking) {
      const words = text.trim().split(/\s+/).filter(Boolean)
      const echo = this.speaking.text.includes(text.trim())
      if (words.length >= 2 && !echo) {
        this.log.info('barge_in', { by: 'speech', text })
        this.bargeIn()
      }
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
    if (!text.trim()) {
      this.log.debug('final_empty', { committed: commitAt !== null })
      return
    }
    this.sttRetries = 0
    if (this.isEcho(text)) {
      this.log.info('echo_dropped', { text })
      return // our own reply heard back through the phone speaker
    }
    this.log.info('final', {
      text, detectedLang, snrDb, noisy, early, pending: this.pending?.kind ?? null,
      finalAfterSpeechMs: finalAt - speechEnd, commitAfterSpeechMs: commitAt === null ? null : commitAt - speechEnd,
    })
    let t: TurnTiming = { speechEnd, commitAt, finalAt, early, snrDb, noisy, pcm, lang: detectedLang, heardAt }
    if (this.held) {
      // the rest of a list the recogniser split at a breath: one turn, as spoken
      clearTimeout(this.held.timer)
      // a list continues after a comma; a sentence cut after "रमेश का" continues with a space
      const heldText = this.held.text.replace(/[।.]\s*$/, '')
      const sep = dangling(heldText) || this.loneName(heldText) ? ' ' : ', '
      text = `${this.held.text.trim().replace(/[।.]$/, '')}${sep}${text.trim()}`
      const both = this.held.t.pcm && pcm ? Buffer.concat([this.held.t.pcm, pcm]) : pcm
      t = { ...t, noisy: t.noisy || this.held.t.noisy, snrDb: minSnr(t.snrDb, this.held.t.snrDb), pcm: both }
      this.log.info('held_joined', { text, heldMs: this.now() - this.held.since })
      this.held = null
    } else if (commitAt === null && !this.ptt && !this.pending && (midList(text) || dangling(text) || this.loneName(text))) {
      const since = this.now()
      this.held = { text, t, since, timer: setTimeout(() => this.releaseHeld(), MID_LIST_HOLD_MS) }
      this.held.timer.unref?.()
      this.log.info('held', { text, why: midList(text) ? 'mid_list' : dangling(text) ? 'dangling' : 'lone_name' })
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

  /** Replies, and the realtime stream (update_settings, no reconnect), follow the shopkeeper's language. */
  private switchLang(lang: Lang) {
    this.log.info('language_switch', { from: this.lang, to: lang })
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
    this.log.info('held_released', { text: h.text, heldMs: this.now() - h.since })
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
    _src: 'voice' | 'tap' | 'resend',
  ): Promise<void> {
    const t0 = this.now()
    this.turnSrc = _src
    let intent: Intent = parseFast(text)
    let path: 'fast' | 'llm' | 'none' = 'fast'
    let llmMs: number | undefined
    const snrDb = t?.snrDb ?? null
    const noisy = t?.noisy ?? false
    // a question left hanging (shopkeeper turned to a customer) expires instead of catching a later "haan"
    if (this.pending && this.now() - this.pendingAt > PENDING_TTL_MS) {
      this.log.info('pending_expired', { kind: this.pending.kind, ageMs: this.now() - this.pendingAt })
      this.pending = null
    }
    const turn = ++this.turnNo
    let unsureChange = false
    if (!this.pending && this.needsLlm(text, intent)) {
      const change = this.isChangeTalk(text, intent)
      const l0 = this.now()
      try {
        const ctx = this.llmContext()
        const reading = await this.deps.llm(text, ctx)
        const v = validate(text, reading, ctx.contextAmounts, ctx.recent?.length ?? 0)
        this.log.info('llm', { turn, text, ms: this.now() - l0, reading, validated: v.type })
        // a model "no"/"unknown" never overrides a usable fast reading - unless the model is sure it
        // is chatter and the fast reading is only a stray number ("it says 1 second...": no rupee
        // word, no direction)
        const weakFast = intent.type === 'entries' && intent.entries.every((e) => !e.direction && !e.amount.hasCurrency)
        if ((v.type !== 'unknown' && v.type !== 'no') || intent.type === 'unknown') intent = v
        else if (weakFast && reading.intent === 'chitchat' && reading.sure) {
          this.log.info('chatter_over_number', { turn, text })
          intent = { type: 'unknown' }
        }
        // the model could not read it either, and the fast reading has no credit/paid word and no
        // customer we know ("Sukha, 3 rupees" from "teen sau"; "So, 1300"): a guess, not an entry
        else if (reading.intent === 'unclear' && intent.type === 'entries' &&
          intent.entries.every((e) => !e.direction && !(e.name && this.lookup(e.name))) &&
          !(intent.entries.length === 1 && this.knownWithin(text))) {
          this.log.info('unclear_over_guess', { turn, text })
          intent = { type: 'unknown' }
        }
        else if (change) unsureChange = true
        path = 'llm'
      } catch (e) {
        this.log.error('llm_failed', { turn, text, ms: this.now() - l0, error: e })
        unsureChange = change
      }
      // a change to an older entry that could not be read must not fall back to changing the last one
      if (unsureChange && intent.type !== 'modify') intent = { type: 'unknown' }
      llmMs = this.now() - l0
    }
    if (!this.pending) this.followDetectedLang(t?.lang, intent)
    const parseMs = this.now() - t0

    const before = this.pending
    let reply = this.pending
      ? this.answerPending(text, intent, snrDb, noisy, path === 'llm' ? 'llm' : 'fast')
      : this.dispatch(intent, text, snrDb, noisy, path === 'llm' ? 'llm' : 'fast')
    if (!reply && unsureChange) reply = { parts: [say(this.lang).didNotCatch()], ops: [] }
    // one confident save: the screen shows name and amount, so a short "noted" is enough
    if (reply && _src !== 'resend' && !this.readBackAll && reply.saved === 1 && reply.ackable === 1 && reply.parts.length === 1)
      reply.parts = [say(this.lang).ack()]
    // a turn lost to a dropped connection, handled again: say so, then the full read-back
    if (reply && _src === 'resend') reply.parts.unshift(say(this.lang).resent())
    if (this.pending && this.pending !== before) this.pendingAt = this.now()
    if (!reply) path = 'none'
    this.remember(`Shopkeeper: ${text}`)
    if (reply?.parts.length) this.remember(`Agent: ${reply.parts.join(' ')}`)

    if (reply?.ops.length) {
      for (const op of reply.ops) this.applyLocal(op)
      const seq = ++this.opsSeq
      this.unacked.set(seq, reply.ops.length)
      this.deps.send({ type: 'ops', ops: reply.ops, seq })
    }
    this.deps.send({ type: 'pending', pending: this.pendingView() })

    let firstAudioAt: number | null = null
    let spoken: { bytes: number; cached: boolean } | null = null
    if (reply?.parts.length) {
      const r = await this.speak(reply.parts.join(' '))
      firstAudioAt = r.first
      spoken = r
    }

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
    }
    this.log.info('turn', {
      turn, src: _src, text, lang: this.lang, intent: intent.type, path,
      reply: reply?.parts.join(' ') ?? null,
      ops: reply?.ops.map((o) => (o.op === 'entry' ? { op: o.op, cid: o.cid, paise: o.paise, direction: o.direction, promise: o.promise, dayOffset: o.dayOffset } : { op: o.op })) ?? [],
      pending: this.pending?.kind ?? null,
      ...(t
        ? {
          snrDb: t.snrDb, noisy: t.noisy, earlyCommit: t.early,
          heardAt: t.heardAt == null ? null : t.heardAt - t.speechEnd,
          commitAt: t.commitAt === null ? null : t.commitAt - t.speechEnd,
          finalAt: t.finalAt - t.speechEnd,
          firstAudioAt: firstAudioAt === null ? null : firstAudioAt - t.speechEnd,
        }
        : {}),
      parseMs, llmMs, replyAudioMs: spoken ? Math.round(spoken.bytes / 32) : 0, cached: spoken?.cached ?? false,
    })
    const heardAll = _src === 'voice' ? this.lastHeard : null
    this.lastHeard = null
    this.deps.record?.({
      turn, src: _src, text, lang: this.lang, detectedLang: t?.lang ?? null, heardAll, intent: intent.type, path,
      reply: reply?.parts.join(' ') ?? null, pending: this.pending?.kind ?? null,
      ops: reply?.ops ?? [], snrDb: t?.snrDb ?? null, noisy: t?.noisy ?? null,
      finalAfterSpeechMs: t ? t.finalAt - t.speechEnd : null, parseMs, llmMs: llmMs ?? null,
    }, t?.pcm)
    // heard and left alone (talk to a customer): the phone shows it dimmed, so it is clear it was heard
    if (_src === 'voice' && !reply && !this.pending) this.deps.send({ type: 'not_entry', text })
    this.deps.send({ type: 'turn_done', resume: this.exportState() })
  }

  // ------------------------------------------------------------------ continuity across reconnects
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
      const kinds = ['confirm', 'name', 'direction', 'confusable', 'which', 'delete', 'batch', 'modify']
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
    const recent = this.snap.entries ?? []
    if (recent.length < 2 || !mentionsChange(text)) return false
    // a new entry with an in-breath slip ("Ramesh ko 500 nahi 300") is not a change; "kal wala", "galat tha" are
    if (intent.type === 'entries' && !POINTS_BACK.test(text)) return false
    const named = this.namedCids(text)
    return named.some((cid) => cid !== this.snap.last?.cid) || (named.length > 0 && POINTS_BACK.test(text))
  }

  private needsLlm(text: string, intent: Intent): boolean {
    const recent = this.snap.entries ?? []
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
    const recent = (this.snap.entries ?? []).slice(0, 12)
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
    // "udhaar clear" / "hisaab clear": settling the whole balance, before any reading as a question
    if (intent.type !== 'entries' && mentionsSettle(text)) {
      const settled = this.settle(text, snrDb, noisy, path)
      if (settled) return settled
    }
    switch (intent.type) {
      case 'entries': {
        // the same line twice in a row (said twice, or returned twice by the model) is one entry
        const drafts = intent.entries.map((e) => this.draftFrom(e, text, snrDb, noisy, path))
          .filter((d, i, a) => i === 0 || !(d.heardName && d.heardName.toLowerCase() === a[i - 1].heardName?.toLowerCase() &&
            d.paise === a[i - 1].paise && d.direction === a[i - 1].direction))
        if (drafts.length === 1) drafts[0].single = true
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
      case 'unknown': {
        // Part of an entry, said on its own: start the entry and ask for what is missing.
        // Only a name ("ಮಾಹಿ ಹೆಸರಿಂದ"): ask how much. Only an amount ("300"): ask whose.
        const part = this.partialDraft(text, snrDb, noisy, path)
        if (part) return this.processDrafts([part], { parts: [], ops: [] })
        // background talk to a customer is ignored; only speak up if it sounded like ledger talk
        if (mentionsMoney(text)) return { parts: [noisy ? R.noisyRepeat() : R.didNotCatch()], ops: [] }
        return null
      }
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
    const e = (this.snap.entries ?? [])[intent.ref - 1]
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
    const opens = ops.some((o) => o.op === 'add_customer') && this.turnSrc !== 'tap'
    if (intent.ref === 1 && !opens) {
      this.focusCid = focus
      return { parts: [done], ops }
    }
    this.pending = { kind: 'modify', ops, done, focus, view: { kind: 'modify', name, paise, direction: dir, newCustomer: opens || undefined } }
    return { parts: [opens ? R.confirmNew(name, paise / 100, dir) : M.changeAsk(name, paise / 100, dir)], ops: [] }
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
      spoken: this.turnSrc !== 'tap',
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
      // before opening a new account: does the heard name contain a customer we already have?
      // ("ಸುರೇಶ್ ಹೆಸರಿಂದ", "Sureshdu", "ಸುರೇಶ್ದು" -> Suresh). Then read it back instead of guessing.
      let found = this.candidates(d.heardName!)
      if (!found.length && d.single) found = this.candidates(d.transcript)
      const one = Session.clearWinner(found)
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
  private knownWithin(heard: string): SnapCustomer | null {
    return Session.clearWinner(this.candidates(heard))
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
  private candidates(heard: string): { c: SnapCustomer; score: number }[] {
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
  private label(c: SnapCustomer): string {
    const twin = this.snap.customers.some((x) => x.cid !== c.cid && x.name.toLowerCase() === c.name.toLowerCase())
    return twin ? `${c.name} · ₹${(c.balancePaise / 100).toLocaleString('en-IN')}` : c.name
  }

  /** A turn that is only a known customer's name ("ಸುರೇಶ್", then a pause, then "300 ರೂಪಾಯಿ ಸಾಲ"). */
  private loneName(text: string): boolean {
    if (text.trim().split(/\s+/).length > 4) return false // a name said on its own is short
    if (parseFast(text).type !== 'unknown') return false
    const n = nameAnswer(text)
    if (!n || n.split(' ').length > 3) return false
    // "ಮಾಹಿ ಹೆಸರಿಂದ" / "Mahi ke naam se": said as a name, even one not in the ledger yet
    if (hasNameWord(text)) return true
    if (this.knownWithin(n)) return true
    const best = matchName(n, this.snap.customers.map((c) => ({ id: c.cid, names: [c.name, ...c.aliases] })))[0]
    return !!best && best.score >= NAME_SURE
  }

  private customerName(d: Draft): string {
    return d.newName ?? this.snap.customers.find((c) => c.cid === d.cid)?.name ?? d.heardName ?? ''
  }

  /** Walk drafts in order: save the sure ones, stop at the first that needs a question. */
  private processDrafts(drafts: Draft[], acc: Reply): Reply {
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
        return this.quietUnlessShort(text)
      case 'name': {
        const n = nameAnswer(text)
        // an answer to "whose name?" is a name: a short reply, whatever numbers are in the room
        if (Session.offTopic(text) || text.trim().split(/\s+/).length > 5 || (n && n.split(' ').length > 2)) return null
        if (!n) return Session.askedEnough(d) ? null : { parts: [R.askName(d.paise / 100)], ops: [] }
        d.heardName = n
        this.fillDirection(d, text)
        return this.processDrafts([d, ...p.queue], acc)
      }
      case 'amount': {
        // the amount blank: read only the number (and a credit/paid word), whatever else was said
        // ("300 ಬರೀ" = "write 300": ಬರೀ is not a name here, the name is already known)
        const amounts = parseAmounts(text).filter((a) => a.value > 0)
        if (!amounts.length) return Session.offTopic(text) || Session.askedEnough(d) ? null : { parts: [R.askAmount(this.customerName(d))], ops: [] }
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
          // a stray word while the question is on screen: keep it, say nothing; otherwise ask it again
          if (intent.type !== 'yes' && (Session.offTopic(text) || Session.askedEnough(d))) return null
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
          return Session.offTopic(text) || Session.askedEnough(d) ? null : { parts: [R.askWhich(this.label(p.options[0]), this.label(p.options[1]))], ops: [] }
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

  /**
   * The same words heard in several languages (MultiStt): use the one that reads best as ledger
   * talk. A full entry beats a partial one, a known customer beats an unknown word, and ties go
   * to the session's language (listed first). "Ramesh teen sukha" (English stream) loses to
   * "रमेश का तीन सौ उधार" (Hindi stream).
   */
  pickHeard(heard: { text: string; locale: string }[]): number {
    const scores = heard.map((h) => this.readScore(h.text))
    let best = 0
    for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i
    this.lastHeard = heard
    if (best !== 0) this.log.info('heard_in_other_language', { chose: heard[best].locale, heard, scores })
    return best
  }

  /** How well a transcript reads as something said to the ledger (higher is better). */
  private readScore(text: string): number {
    const i = parseFast(text)
    const known = (n: string | null) => !!n && (!!this.lookup(n) || !!this.knownWithin(n))
    switch (i.type) {
      case 'entries':
        return 2 + (i.entries.every((e) => e.direction || e.promise) ? 1 : 0) + (i.entries.every((e) => known(e.name)) ? 1 : 0)
      case 'unknown':
        if (mentionsSettle(text) && this.candidates(text).length) return 2
        return this.knownWithin(text) ? 1 : mentionsMoney(text) ? 0.5 : 0
      case 'yes':
      case 'no':
        return this.pending ? 2 : 0.5
      default:
        return 2
    }
  }

  /** One word that answers nothing and has no money in it: recogniser noise, or a word to someone else. */
  static strayWord(text: string): boolean {
    return text.trim().split(/\s+/).filter(Boolean).length <= 1 && !mentionsMoney(text)
  }

  /**
   * Not an answer to the open question: one stray word, or longer talk with no money in it (the
   * shopkeeper turned to a customer). The question stays on screen; nothing is said.
   */
  static offTopic(text: string): boolean {
    return Session.strayWord(text) || (text.trim().split(/\s+/).length > 4 && !mentionsMoney(text))
  }

  /** True once the question about this line has been asked again; after that it waits on screen. */
  static askedEnough(d: Draft): boolean {
    d.reasked = (d.reasked ?? 0) + 1
    return d.reasked > 1
  }

  /** A credit/paid word in an answer to another question fills that blank too ("Mahi, udhaar"). */
  private fillDirection(d: Draft, text: string) {
    if (d.direction) return
    const dir = directionAnswer(text)
    if (dir) {
      d.direction = dir
      d.reasons = d.reasons.filter((r) => r !== 'no-direction-cue')
    }
  }

  /**
   * One part of an entry said on its own, as the start of an entry: a name alone (a customer we
   * know, or said as a name: "ಮಾಹಿ ಹೆಸರಿಂದ"), or an amount alone ("300", "300 rupees"). Anything
   * else is not ledger talk.
   */
  private partialDraft(text: string, snrDb: number | null, noisy: boolean, path: 'fast' | 'llm'): Draft | null {
    const amounts = parseAmounts(text).filter((a) => a.value > 0)
    const blank = (name: string | null, rupees: number, reasons: string[]): Draft => ({
      heardName: name, cid: null, newName: null, nameSure: false, paise: Math.round(rupees * 100), alt: null,
      direction: directionAnswer(text), dayOffset: 0, promise: false, confidence: 'low', reasons, path, transcript: text,
      snrDb, noisy, spoken: this.turnSrc !== 'tap',
    })
    if (!amounts.length) {
      const n = nameAnswer(text)
      const shortWithDir = !!directionAnswer(text) && !!n && n.split(' ').length <= 2 && text.trim().split(/\s+/).length <= 5
      if (!this.loneName(text) && !shortWithDir) return null
      return blank(n, 0, ['no-amount'])
    }
    // only the amount: every word is a number, currency or filler ("300", "300, 300", "300 rupees")
    const same = amounts.every((a) => a.value === amounts[0].value)
    if (same && mentionsMoney(text) && !hasUnplacedWords(text, [])) return blank(null, amounts[0].value, ['no-name'])
    return null
  }

  /**
   * "Ramesh ka udhaar clear" / "hisaab chukta" / just "clear": the customer paid off what they owe.
   * The customer is the one named, or the one just talked about when no name is said. Two customers
   * who both fit ("Ramesh" / "Rameshwar", two Sureshes) are asked about first. Always read back
   * with that customer's balance ("Ramesh, 200 rupees paid, correct?"); nothing is written without a yes.
   */
  private settle(text: string, snrDb: number | null, noisy: boolean, path: 'fast' | 'llm'): Reply | null {
    if (!mentionsSettle(text) || parseAmounts(text).some((a) => a.value > 0)) return null
    const found = this.candidates(text)
    const named = nameAnswer(text)
    const saysNoName = !named || named.split(' ').every((w) => mentionsSettle(w))
    const focus = saysNoName && this.focusCid ? this.snap.customers.find((c) => c.cid === this.focusCid) ?? null : null
    const one = Session.clearWinner(found) ?? (found.length ? null : focus)
    if (!one && found.length < 2) return null // nobody we know: not a settle
    const d: Draft = {
      heardName: one?.name ?? null, cid: one?.cid ?? null, newName: null, nameSure: true, paise: one?.balancePaise ?? 1, alt: null,
      direction: 'payment', dayOffset: 0, promise: false, confidence: 'low', reasons: ['settle-balance'], path, transcript: text,
      snrDb, noisy, spoken: this.turnSrc !== 'tap', single: true,
    }
    if (!one) {
      const options = found.slice(0, 3).map((x) => x.c)
      this.pending = { kind: 'which', draft: d, queue: [], options }
      return { parts: [say(this.lang).askWhich(this.label(options[0]), this.label(options[1]))], ops: [] }
    }
    return this.processDrafts([d], { parts: [], ops: [] })
  }

  /** Long talk with no answer in it is the shopkeeper talking to someone else: keep the question, stay quiet. */
  private quietUnlessShort(text: string): Reply | null {
    if (text.trim().split(/\s+/).length > 4 && !mentionsMoney(text)) return null
    if (Session.strayWord(text)) return null
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
      newCustomer: p.kind === 'confirm' && this.opensAccount(d) ? true : undefined,
      options: p.kind === 'which' ? p.options.map((c) => this.label(c)) : p.kind === 'confusable' ? [String(d.paise / 100), String(d.alt)] : undefined,
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
  private async speak(spoken: string): Promise<{ first: number | null; bytes: number; cached: boolean }> {
    this.bargeIn() // never talk over ourselves
    const ac = new AbortController()
    const start = this.now()
    let bytes = 0
    let cached = false
    const text = stripTags(spoken) // what the screen shows and what can echo back
    this.speaking = { ac, text, ducked: false, until: start + 60_000 }
    this.deps.send({ type: 'say', text })
    let first: number | null = null
    // a stalled TTS socket must not block every later turn
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        this.log.warn('tts_timeout', { text, afterMs: TTS_TIMEOUT_MS, firstAudio: first !== null, bytes })
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
      this.log.error('tts_failed', { text, error: e })
      this.deps.send({ type: 'error', message: `tts: ${String(e)}` })
    } finally {
      clearTimeout(timer)
    }
    if (ac.signal.aborted && first === null && this.speaking?.ac === ac) this.log.warn('tts_no_audio', { text, waitedMs: this.now() - start })
    this.log.debug('speak', {
      text, cached, bytes, firstAudioMs: first === null ? null : first - start,
      totalMs: this.now() - start, cut: ac.signal.aborted,
    })
    this.lastSaid = { text: this.speaking?.ac === ac ? this.speaking.text : text, until: (first ?? start) + (bytes / 32000) * 1000 + 1500 }
    if (!ac.signal.aborted) {
      this.deps.send({ type: 'audio_end' })
      // the phone plays in real time: we are "speaking" until that audio has played out
      if (this.speaking?.ac === ac) this.speaking.until = (first ?? start) + (bytes / 32000) * 1000 + 300
    }
    return { first, bytes, cached }
  }

  close() {
    if (this.unacked.size) this.log.warn('ops_unacked', { batches: this.unacked.size, ops: [...this.unacked.values()].reduce((a, b) => a + b, 0), seqs: [...this.unacked.keys()] })
    this.log.info('session_end', { turns: this.turnNo, lang: this.lang, durationMs: this.now() - this.startedAt, pendingLeft: this.pending?.kind ?? null })
    this.closed = true
    if (this.held) clearTimeout(this.held.timer)
    this.held = null
    this.speaking?.ac.abort()
    this.stt?.close()
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
