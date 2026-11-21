/**
 * Is the app listening? Asleep until the wake word / a tap / the phone's detector wakes it;
 * awake for 15 s after the last interaction: a wake, a tap, or a turn the app answered (a reply
 * or a question). It never times out while a question is open (and younger than 45 s): the
 * shopkeeper may be thinking or looking something up.
 *
 * Speech alone never restarts the window (talk to customers would keep the app awake forever):
 * an utterance in progress only postpones the expiry until its final has been handled, and a
 * turn that said nothing (talk to someone else) does not extend it.
 */
export type AttentionState = 'asleep' | 'awake'
export type WakeSource = 'word' | 'tap' | 'hold' | 'phone'

export const AWAKE_WINDOW_MS = 15_000
export const PENDING_GRACE_MS = 45_000
/** expiry is re-checked this often while an utterance is in progress */
const SPEECH_POLL_MS = 500
/** speech with no partial or final for this long is over (a lost final must not keep the app awake) */
const SPEECH_STALE_MS = 10_000

export interface AttentionOpts {
  hasPending?: () => boolean
  /** how long the open question has been waiting, ms */
  pendingAgeMs?: () => number
  windowMs?: number
}

export class Attention {
  state: AttentionState = 'asleep'
  private held = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private cbs: ((state: AttentionState) => void)[] = []
  private hasPending: () => boolean
  private pendingAgeMs: () => number
  private windowMs: number
  /** an utterance is in progress: speech started, its final not yet in */
  private inSpeech = false
  private speechPolls = 0
  /** turns being handled (a final arrived, the reply is not out yet) */
  private turns = 0
  /** the window ran out while a turn was being handled: decided when it ends */
  private due = false

  constructor(opts: AttentionOpts = {}) {
    this.hasPending = opts.hasPending ?? (() => false)
    this.pendingAgeMs = opts.pendingAgeMs ?? (() => 0)
    this.windowMs = opts.windowMs ?? AWAKE_WINDOW_MS
  }

  onChange(cb: (state: AttentionState) => void): void {
    this.cbs.push(cb)
  }

  wake(source: WakeSource): void {
    if (source === 'hold') this.held = true
    this.set('awake')
    this.touch()
  }

  /** Speech start or a partial: postpones the expiry until the utterance ends (never restarts the window). */
  heard(): void {
    this.inSpeech = true
    this.speechPolls = 0
  }

  /** A final arrived and its turn is being handled: the utterance is over. */
  turnStart(): void {
    this.inSpeech = false
    this.turns++
  }

  /** A final that is not handled (empty, echo, dropped): the utterance is over. */
  speechDone(): void {
    this.inSpeech = false
  }

  /** The turn is done. `engaged`: it replied or left a question open, so the window starts over. */
  turnEnd(engaged: boolean): void {
    this.turns = Math.max(0, this.turns - 1)
    if (engaged) return this.touch()
    if (this.due && !this.turns) {
      this.due = false
      this.expire()
    }
  }

  /** Something happened: the window starts over. */
  touch(): void {
    this.clear()
    this.due = false
    if (this.state !== 'awake' || this.held) return
    this.arm(this.windowMs)
  }

  holdStart(): void {
    this.wake('hold')
  }

  holdEnd(): void {
    this.held = false
    this.touch()
  }

  sleep(): void {
    this.held = false
    this.due = false
    this.clear()
    this.set('asleep')
  }

  /** Stop timers (the session ended). */
  close(): void {
    this.clear()
  }

  private arm(ms: number): void {
    this.timer = setTimeout(() => this.expire(), ms)
    this.timer.unref?.()
  }

  private expire(): void {
    this.timer = null
    if (this.state !== 'awake' || this.held) return
    // an utterance in progress is heard out (unless it went quiet with no final)
    if (this.inSpeech && ++this.speechPolls * SPEECH_POLL_MS <= SPEECH_STALE_MS) return this.arm(SPEECH_POLL_MS)
    this.inSpeech = false
    if (this.turns) {
      this.due = true
      return
    }
    if (this.hasPending()) {
      const left = PENDING_GRACE_MS - this.pendingAgeMs()
      if (left > 0) return this.arm(Math.min(left, this.windowMs))
    }
    this.sleep()
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private set(state: AttentionState): void {
    if (this.state === state) return
    this.state = state
    for (const cb of this.cbs) cb(state)
  }
}
