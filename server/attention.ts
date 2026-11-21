/**
 * Is the app listening? Asleep until the wake word / a tap / the phone's detector wakes it;
 * awake for 15 s after the last interaction. It never times out while a question is open
 * (and younger than 45 s): the shopkeeper may be thinking or looking something up.
 */
export type AttentionState = 'asleep' | 'awake'
export type WakeSource = 'word' | 'tap' | 'hold' | 'phone'

export const AWAKE_WINDOW_MS = 15_000
export const PENDING_GRACE_MS = 45_000

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

  /** Something happened: the window starts over. */
  touch(): void {
    this.clear()
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
