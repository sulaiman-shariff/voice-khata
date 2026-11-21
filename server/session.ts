/**
 * One voice session: mic audio in, ledger ops + spoken replies out.
 *
 *   audio -> energy tracker (pause, SNR)  ─┐
 *        -> Prisma STT (partials, final) ──┼─> end of turn: text complete + 300 ms pause -> commit
 *                                          └─> final -> fast parser (or Haiku) -> dialogue -> ops + reply -> Timbre
 *
 * Dependencies are injected so the dialogue can be tested without the network.
 */
import { type Intent, mentionsSettle, mentionsMoney, parseFast, refersBack, turnComplete } from '../shared/intent.js'
import { parseAmounts } from '../shared/numbers.js'
import type { ClientMsg, ServerMsg, SettingMsg, SnapEntry, Snapshot, TurnMetrics } from '../shared/protocol.js'
import { type Lang, LOCALE, eraseWord, guardReply, langFromLocale, say, stripTags } from '../shared/replies.js'
import { FRAME_SAMPLES, newEnergyState, pushFrame, resetUtterance, tooNoisy, utteranceSnrDb } from './turn/energy.js'
import { isSleepWord, spotWake } from '../shared/wake.js'
import { Attention } from './attention.js'
import { type Logger, nullLogger } from './log.js'
import { type AgentContext, type ToolCall } from './agent/agent.js'
import { attachTools, runTool } from './agent/tools.js'
import { LedgerCore, PENDING_TTL_MS, type Pending, type Reply, type TurnMeta } from './ledger/core.js'

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
  /** The understanding model: reads every transcript (and the audio) and answers with tool calls. */
  agent?: (ctx: AgentContext, audio?: Buffer) => Promise<{ calls: ToolCall[]; ms: number }>
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
type TurnTiming = { speechEnd: number; commitAt: number | null; finalAt: number; early: boolean; snrDb: number | null; noisy: boolean; pcm?: Buffer; lang?: string; heardAt?: number | null; heard?: { text: string; locale: string }[] }
/** Audio kept for the turn (16 kHz s16le): the last 20 s at most. */
const UTT_AUDIO_MAX = 20 * 16000 * 2
/** Reopen the STT stream after this long, at a quiet moment (Prisma's cap is 15 min). */
const STT_REFRESH_MS = 14 * 60_000

export class Session {
  lang: Lang = 'hi'
  readonly ledger: LedgerCore
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
  /** the last utterance as heard in each language (MultiStt), for the turn record */
  private lastHeard: { text: string; locale: string }[] | null = null
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
  /** asleep / awake: only spoken finals are gated by it (typed text and card taps always count) */
  private attention!: Attention
  /** the phone's own detector woke us: the first transcript must carry the wake word, else back to sleep */
  private phoneUnconfirmed = false
  /** no `attention` message for changes made while handling hello (hello sends the state itself) */
  private attnQuiet = false

  constructor(private deps: SessionDeps) {
    this.log = deps.log ?? nullLogger
    this.now = deps.now ?? (() => performance.now())
    this.startedAt = this.now()
    this.newId = deps.newId ?? (() => crypto.randomUUID())
    this.ledger = new LedgerCore({
      lang: () => this.lang, now: this.now, newId: this.newId, log: this.log,
      onCustomerAdded: () => this.stt?.setKeyterms(this.keyterms()),
    })
    attachTools(this.ledger) // a tapped "which one" answer finishes the original tool
    this.ledger.sayBalance = true // a save says the customer's new balance
    this.ledger.dispatch = (intent, text, meta) => this.dispatch(intent, text, meta)
    this.attention = new Attention({
      hasPending: () => !!this.pending,
      pendingAgeMs: () => this.now() - this.ledger.pendingAt,
    })
    this.attention.onChange((state) => {
      this.log.info('attention', { state })
      if (state === 'asleep') this.phoneUnconfirmed = false
      if (!this.attnQuiet) this.deps.send({ type: 'attention', state })
    })
  }

  /** Spoken final while asleep or awake: the text to handle, or null when it is not for us. */
  private gate(text: string): string | null {
    const asleep = this.attention.state === 'asleep'
    if (asleep && this.isSpeaking()) return null // never wake on what we are saying ourselves
    const wake = spotWake(text, this.phoneUnconfirmed)
    if (asleep && !wake.found) {
      this.log.debug('asleep_dropped', { text })
      return null
    }
    if (!asleep && this.phoneUnconfirmed) {
      this.phoneUnconfirmed = false
      if (!wake.found) {
        this.log.info('phone_wake_unconfirmed', { text })
        this.sleepNow()
        return null
      }
    }
    const rest = wake.found ? wake.rest : text
    if (isSleepWord(rest)) {
      this.log.info('sleep_word', { text })
      if (!asleep) {
        this.sleepNow()
      }
      return null
    }
    if (wake.found) {
      this.attention.wake('word')
      if (!rest) {
        this.attention.touch()
        this.enqueue(async () => {
          await this.speak(say(this.lang).awakeHello())
          this.attention.touch()
        })
        return null
      }
    }
    return rest
  }

  /** A typed or tapped turn: the window restarts after the reply; an open question keeps us awake for the spoken answer. */
  private async typedTurn(text: string) {
    await this.handleText(text, null, 'tap')
    if (this.pending) this.attention.wake('tap')
    else this.attention.touch()
  }

  private sleepNow() {
    this.bargeIn()
    this.attention.sleep()
  }

  /** the server's copy of the ledger snapshot, and the open question: held by the ledger core */
  get snap(): Snapshot { return this.ledger.snap }
  set snap(s: Snapshot) { this.ledger.snap = s }
  get pending(): Pending | null { return this.ledger.pending }
  set pending(p: Pending | null) { this.ledger.pending = p }

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
        if (msg.resume) this.ledger.importState(msg.resume)
        // a new socket starts asleep, unless the resumed state had a question waiting for its answer
        this.attnQuiet = true
        this.attention.sleep()
        if (this.pending) this.attention.wake('tap')
        this.attnQuiet = false
        this.openStt()
        this.warmPhrases()
        this.deps.send({ type: 'attention', state: this.attention.state })
        // always: the phone keeps showing its last question until told otherwise
        this.deps.send({ type: 'pending', pending: this.ledger.pendingView() })
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
        this.attention.holdStart() // push-to-talk is deliberate: awake while the button is down
        break
      case 'wake':
        this.log.info('wake', { source: msg.source })
        if (msg.source === 'hold') this.attention.holdStart()
        else {
          if (msg.source === 'phone' && this.attention.state === 'asleep') this.phoneUnconfirmed = true
          this.attention.wake(msg.source)
        }
        break
      case 'hold_end':
        this.attention.holdEnd()
        break
      case 'sleep':
        this.log.info('sleep', { by: 'tap' })
        this.sleepNow()
        break
      case 'ptt_end':
        this.log.debug('ptt_end', { partial: this.lastPartial })
        this.sendHeard()
        this.commit(false)
        this.attention.holdEnd()
        break
      case 'tap':
        this.log.info('input', { kind: 'tap', action: msg.action })
        this.enqueue(() => this.typedTurn(msg.action === 'yes' ? 'haan' : msg.action === 'no' ? 'nahi' : 'undo'))
        break
      case 'text':
        this.log.info('input', { kind: 'typed', text: msg.text })
        // typed lists: one line per entry reads like a spoken list with pauses
        if (msg.text.trim() && msg.text.length <= 2000)
          this.enqueue(() => this.typedTurn(msg.text.replace(/\s*[\r\n]+\s*/g, ', ').trim()))
        break
      case 'answer':
        this.log.info('input', { kind: 'answer', text: msg.text })
        if (msg.text.length <= 60) this.enqueue(() => this.typedTurn(msg.text))
        break
      case 'force':
        // "Save anyway" on a not-an-entry line: addressed to the app, never dropped as talk to someone else
        this.log.info('input', { kind: 'force', text: msg.text })
        if (msg.text.trim() && msg.text.length <= 2000) this.enqueue(() => this.handleText(msg.text.trim(), null, 'tap', true))
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
        this.attention.touch() // speaking keeps the window open
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
    if (this.energy.inUtterance || this.committed || this.lastPartial) return
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
    this.attention.touch()
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
    const gated = this.gate(text)
    if (gated === null) return // asleep and not addressed to us, or a wake / sleep word on its own
    text = gated
    const heard = this.lastHeard ?? undefined
    this.lastHeard = null
    const t: TurnTiming = { speechEnd, commitAt, finalAt, early, snrDb, noisy, pcm, lang: detectedLang, heardAt, heard }
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
    this.attention.touch()
    this.enqueue(async () => {
      await this.handleText(text, t, 'voice')
      this.attention.touch() // the window runs from the end of our reply
    })
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
  /**
   * One turn. Always treated as addressed (attention is decided before this). Three ways in:
   *  - the open question, when the fast parse can answer it;
   *  - the instant path, for a plain entry about a known customer (no model, no wait);
   *  - the agent: it reads every transcript and the audio and answers with tool calls, each of
   *    which runs through the ledger safety layer.
   */
  async handleText(
    text: string,
    t: TurnTiming | null,
    _src: 'voice' | 'tap' | 'resend',
    /** "Save anyway": handled as addressed to the app; the model may not answer not_for_me */
    forced = false,
  ): Promise<void> {
    const t0 = this.now()
    this.ledger.turnSrc = _src
    const heard = t?.heard?.length ? t.heard : [{ locale: LOCALE[this.lang], text }]
    // "Save anyway" is a new instruction to the app, never the answer to a question left open
    if (forced) this.pending = null
    // a question left hanging (shopkeeper turned to a customer) expires instead of catching a later "haan"
    if (this.pending && this.now() - this.ledger.pendingAt > PENDING_TTL_MS) {
      this.log.info('pending_expired', { kind: this.pending.kind, ageMs: this.now() - this.ledger.pendingAt })
      this.pending = null
    }
    const before = this.pending
    const turn = ++this.turnNo
    const intent: Intent = parseFast(text)
    const snrDb = t?.snrDb ?? null
    const noisy = t?.noisy ?? false
    let path: 'fast' | 'llm' | 'none' = 'fast'
    let llmMs: number | undefined
    let notForMe = false
    let applied = false
    let extra: ServerMsg[] = []
    this.ledger.heardAmounts = this.streamAmounts(heard)
    const meta: TurnMeta = { snrDb, noisy, path: 'fast' }
    let reply: Reply | null = null
    try {
      if (this.pending) {
        if (this.ledger.canAnswerFast(text, intent)) reply = this.ledger.answerPending(text, intent, meta)
        else ({ reply, notForMe, ms: llmMs, extra } = await this.askAgent(text, heard, t, meta))
      } else if (forced) ({ reply, notForMe, ms: llmMs, extra } = await this.askAgent(text, heard, t, meta))
      else if (intent.type === 'entries' && this.isInstant(intent)) reply = this.dispatch(intent, text, meta)
      // "Suresh wali entry hata do" names an older entry: only the agent can pick it
      else if (intent.type === 'undo' && !this.ledger.candidates(text).length) reply = this.dispatch(intent, text, meta)
      else if (intent.type === 'yes' || intent.type === 'no') reply = null // nothing pending: a stray haan/nahi
      else ({ reply, notForMe, ms: llmMs, extra } = await this.askAgent(text, heard, t, meta))
      if (llmMs !== undefined) { path = 'llm'; applied = true }
    } finally {
      this.ledger.heardAmounts = []
    }
    // forced: the shopkeeper said this is for the app, so it is never answered with silence
    if (forced && (notForMe || !reply)) { notForMe = false; reply = { parts: [say(this.lang).didNotCatch()], ops: [] } }
    if (!this.pending) this.followDetectedLang(t?.lang, intent)
    const parseMs = this.now() - t0
    // a turn lost to a dropped connection, handled again: say so, then the full read-back
    if (reply && _src === 'resend') reply.parts.unshift(say(this.lang).resent())
    if (this.pending && this.pending !== before) this.ledger.pendingAt = this.now()
    if (!reply || notForMe) path = path === 'llm' ? 'llm' : 'none'
    this.remember(`Shopkeeper: ${text}`)
    if (reply?.parts.length) this.remember(`Agent: ${reply.parts.join(' ')}`)

    if (reply?.ops.length) {
      if (!applied) for (const op of reply.ops) this.ledger.applyLocal(op)
      const seq = ++this.opsSeq
      this.unacked.set(seq, reply.ops.length)
      this.deps.send({ type: 'ops', ops: reply.ops, seq })
    }
    if (reply?.show && path !== 'llm') extra.push(reply.show)
    if (reply?.setting && path !== 'llm') {
      this.applySetting(reply.setting)
      extra.push(reply.setting)
    }
    if (reply?.ready?.kind === 'whatsapp' && reply.ready.cid && reply.ready.text) extra.push({ type: 'remind', cid: reply.ready.cid, text: reply.ready.text })
    else if (reply?.ready) extra.push({ type: 'ready', ...reply.ready })
    for (const m of extra) this.deps.send(m)
    this.deps.send({ type: 'pending', pending: this.ledger.pendingView() })

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
      turn, src: _src, text, lang: this.lang, intent: notForMe ? 'not_for_me' : intent.type, path,
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
    const heardAll = _src === 'voice' ? t?.heard ?? null : null
    this.deps.record?.({
      turn, src: _src, text, lang: this.lang, detectedLang: t?.lang ?? null, heardAll, intent: notForMe ? 'not_for_me' : intent.type, path,
      reply: reply?.parts.join(' ') ?? null, pending: this.pending?.kind ?? null,
      ops: reply?.ops ?? [], snrDb: t?.snrDb ?? null, noisy: t?.noisy ?? null,
      finalAfterSpeechMs: t ? t.finalAt - t.speechEnd : null, parseMs, llmMs: llmMs ?? null,
    }, t?.pcm)
    // heard and left alone (talk to a customer): the phone shows it dimmed, so it is clear it was heard
    if (_src === 'voice' && (notForMe || (!reply && !this.pending))) this.deps.send({ type: 'not_entry', text })
    this.deps.send({ type: 'turn_done', resume: this.ledger.exportState() })
  }


  // ------------------------------------------------------------------ continuity across reconnects
  private remember(line: string) {
    this.ledger.history.push(line.slice(0, 300))
    if (this.ledger.history.length > 8) this.ledger.history.splice(0, this.ledger.history.length - 8)
  }

  /** Instant path: every line names a known customer, says the direction and was read with full confidence. */
  private isInstant(intent: Extract<Intent, { type: 'entries' }>): boolean {
    return intent.entries.every((e) => !!e.name && !!this.ledger.lookup(e.name) && (!!e.direction || e.promise) && e.confidence === 'high')
  }

  /** The one amount each language stream heard (streams with several amounts are left out). */
  private streamAmounts(heard: { text: string }[]): number[] {
    const out: number[] = []
    for (const h of heard) {
      const vals = [...new Set(parseAmounts(h.text).map((a) => a.value).filter((v) => v > 0))]
      if (vals.length === 1) out.push(vals[0])
    }
    return out
  }

  private agentContext(heard: { text: string; locale: string }[]): AgentContext {
    // numbered newest first, in the order the tools index entries (`ref`: 1 = newest)
    const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10) // shops are in IST
    const when = (e: SnapEntry) => {
      const d = e.day ? Math.round((Date.parse(e.day) - Date.parse(today)) / 86_400_000) : 0
      return d === 0 ? 'today' : d === -1 ? 'yesterday' : d === 1 ? 'tomorrow' : e.day
    }
    const recent = (this.snap.entries ?? []).slice(0, 12)
      .map((e, i) => `#${i + 1} ${this.ledger.nameOf(e.cid)} ${e.promise ? 'promise' : e.direction} ${e.paise / 100} ${when(e)}`)
    return {
      lang: this.lang,
      heard,
      history: this.ledger.history.slice(-6),
      screen: 'home',
      customers: this.snap.customers.map((c) => c.name),
      recent,
      pending: this.ledger.pendingView(),
    }
  }

  /**
   * Hand the turn to the agent and run its tool calls in order, each through the safety layer,
   * merged into one reply. Ops are applied locally after each call so a later call sees them.
   * Failure (no agent, timeout, error): the shopkeeper hears didNotCatch in the turn language.
   */
  private async askAgent(
    text: string, heard: { text: string; locale: string }[], t: TurnTiming | null, meta: TurnMeta,
  ): Promise<{ reply: Reply | null; notForMe: boolean; ms: number | undefined; extra: ServerMsg[] }> {
    const R = say(this.lang)
    const fail = (): { reply: Reply | null; notForMe: boolean; ms: number | undefined; extra: ServerMsg[] } =>
      ({ reply: { parts: [meta.noisy ? R.noisyRepeat() : R.didNotCatch()], ops: [] }, notForMe: false, ms: undefined, extra: [] })
    const l0 = this.now()
    let calls: ToolCall[]
    try {
      if (!this.deps.agent) throw new Error('no agent')
      const r = await this.deps.agent(this.agentContext(heard), t?.pcm)
      calls = r.calls
      this.log.info('agent', { text, ms: r.ms, calls: calls.map((c) => c.name) })
    } catch (e) {
      this.log.error('agent_failed', { text, ms: this.now() - l0, error: e })
      return fail()
    }
    if (!calls.length) return fail()
    // the sentence, and every language stream's reading of it: an amount heard in any may be written
    const spoken = heard.map((h) => h.text).filter((x) => x !== text)
    const merged: Reply = { parts: [], ops: [] }
    const extra: ServerMsg[] = []
    for (const call of calls) {
      const r = runTool(this.ledger, call, { ...meta, transcript: text, heard: spoken })
      merged.parts.push(...r.parts)
      for (const op of r.ops) this.ledger.applyLocal(op)
      merged.ops.push(...r.ops)
      if (r.saved) merged.saved = (merged.saved ?? 0) + r.saved
      if (r.show) extra.push(r.show)
      if (r.setting) {
        this.applySetting(r.setting)
        extra.push(r.setting)
      }
      if (r.ready) merged.ready = r.ready
      if (this.pending) break // a question is open: nothing after it runs until it is answered
    }
    const notForMe = calls.every((c) => c.name === 'not_for_me')
    return { reply: notForMe ? null : merged, notForMe, ms: this.now() - l0, extra }
  }

  private applySetting(m: SettingMsg) {
    if (m.key === 'lang' && typeof m.value === 'string') this.switchLang(m.value as Lang)
    else if (m.key === 'readBack') this.readBackAll = m.value === true
    else if (m.key === 'fastSpeech') {
      this.speed = m.value === true ? 1.2 : 1
      this.warmPhrases()
    }
  }

  // ------------------------------------------------------------------ dialogue
  private dispatch(intent: Intent, text: string, meta: TurnMeta): Reply | null {
    const R = say(this.lang)
    // "udhaar clear" / "hisaab clear": settling the whole balance, before any reading as a question
    if (intent.type !== 'entries' && mentionsSettle(text)) {
      const settled = this.ledger.settle(text, meta)
      if (settled) return settled
    }
    switch (intent.type) {
      case 'entries':
        return this.ledger.addEntries(intent, text, meta)
      case 'modify':
        return this.ledger.modifyEntry(intent)
      case 'correct':
        return this.ledger.correctLast(intent)
      case 'undo': {
        const last = this.snap.last
        if (!last) return { parts: [R.nothingToUndo()], ops: [] }
        return { parts: [R.undone()], ops: [{ op: 'void', eid: last.eid, reason: 'spoken undo' }] }
      }
      case 'yes':
      case 'no':
        return null // nothing pending: ignore stray haan/nahi
      case 'query': {
        if ((!intent.name || !this.ledger.lookup(intent.name)) && this.ledger.focusCid && refersBack(text)) {
          const c = this.snap.customers.find((x) => x.cid === this.ledger.focusCid)
          if (c) {
            this.deps.send({ type: 'show', view: 'customer', cid: c.cid })
            return { parts: [R.balance(c.name, c.balancePaise / 100)], ops: [] }
          }
        }
        if (intent.scope === 'customer' && intent.name) {
          const c = this.ledger.lookup(intent.name)
          if (!c) return { parts: [R.notFound(intent.name)], ops: [] }
          this.ledger.focusCid = c.cid
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
        const c = this.ledger.lookup(intent.name)
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
        this.pending = { kind: 'delete', requireType: eraseWord(this.lang) }
        return { parts: [R.eraseType(eraseWord(this.lang))], ops: [] }
      case 'unknown':
        return null // the agent reads anything the fast parse cannot
    }
  }

  private duesReply(): Reply {
    const R = say(this.lang)
    const owing = this.snap.customers.filter((c) => c.balancePaise > 0)
    this.deps.send({ type: 'show', view: 'dues' })
    if (!owing.length) return { parts: [R.noDues()], ops: [] }
    return { parts: [R.dues(owing.length, owing.reduce((s, c) => s + c.balancePaise, 0) / 100)], ops: [] }
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
    const known = (n: string | null) => !!n && (!!this.ledger.lookup(n) || !!this.ledger.knownWithin(n))
    switch (i.type) {
      case 'entries':
        return 2 + (i.entries.every((e) => e.direction || e.promise) ? 1 : 0) + (i.entries.every((e) => known(e.name)) ? 1 : 0)
      case 'unknown':
        if (mentionsSettle(text) && this.ledger.candidates(text).length) return 2
        return this.ledger.knownWithin(text) ? 1 : mentionsMoney(text) ? 0.5 : 0
      case 'yes':
      case 'no':
        return this.pending ? 2 : 0.5
      default:
        return 2
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
    this.attention.close()
    this.speaking?.ac.abort()
    this.stt?.close()
  }
}
