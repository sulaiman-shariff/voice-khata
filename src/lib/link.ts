/**
 * Bad-network logic for the voice client, free of browser APIs so it is unit-tested and shared
 * with the node chaos harness (eval/net_chaos.ts). voice.ts wires it to the real socket and mic.
 *
 * - TurnTracker: a turn whose result never arrived (connection dropped after the transcript but
 *   before the ledger ops) is handed back so the next session handles it again.
 * - SpeechBuffer: the last seconds of mic frames, so speech during a drop is replayed.
 * - NetMonitor: heartbeat bookkeeping -> 'good' | 'slow' | 'offline', and when a link is dead.
 */

export const PING_EVERY_MS = 4000
/** No message at all from the server for this long while "open" means the link is dead. */
export const DEAD_AFTER_MS = 9000
/** After a network change, a pong must come back this fast or we reconnect. */
export const PROBE_TIMEOUT_MS = 3000
export const RECONNECT_BACKOFF_MS = [250, 500, 1000, 2000, 4000, 5000]
export const SLOW_RTT_MS = 1200
/** ~2 s of 16 kHz s16le audio waiting in the socket buffer */
export const SLOW_BUFFERED_BYTES = 64 * 1024
export const SLOW_FOR_MS = 2000
export const BUFFER_KEEP_MS = 12_000
export const REPLAY_MAX_MS = 10_000

export type NetState = 'good' | 'slow' | 'offline'

/** Tracks the turn in flight between the transcript and turn_done. */
export class TurnTracker {
  private inFlight: { text: string; opsReceived: boolean; finalAt: number } | null = null
  lastFinalAt = 0
  lastTurnDoneAt = 0

  onFinal(text: string, at: number) {
    this.inFlight = { text, opsReceived: false, finalAt: at }
    this.lastFinalAt = at
  }

  onOps() {
    if (this.inFlight) this.inFlight.opsReceived = true
  }

  onTurnDone(at: number) {
    this.inFlight = null
    this.lastTurnDoneAt = at
  }

  /**
   * The connection dropped: the text to handle again, if a turn was heard but its result (the
   * ledger ops) never arrived. A turn whose ops did arrive is saved; nothing to redo.
   */
  onDrop(): string | null {
    const t = this.inFlight
    this.inFlight = null
    return t && !t.opsReceived && t.text.trim() ? t.text : null
  }
}

export interface Frame {
  at: number
  level: number
  buf: ArrayBuffer
}

/** Ring buffer of recent mic frames (timestamps in ms, same clock as TurnTracker). */
export class SpeechBuffer {
  private frames: Frame[] = []
  private keepMs: number
  constructor(keepMs = BUFFER_KEEP_MS) {
    this.keepMs = keepMs
  }

  push(buf: ArrayBuffer, level: number, at: number) {
    this.frames.push({ at, level, buf })
    while (this.frames.length && this.frames[0].at < at - this.keepMs) this.frames.shift()
  }

  /**
   * Frames to replay into a new session: everything after `since` (the last transcript or
   * turn end, so finished turns are never replayed), at most REPLAY_MAX_MS, and only if the
   * window holds speech at all.
   */
  replayWindow(since: number, now: number, speechLevel: number): ArrayBuffer[] {
    const from = Math.max(since, now - REPLAY_MAX_MS)
    const win = this.frames.filter((f) => f.at > from)
    if (!win.some((f) => f.level >= speechLevel)) return []
    return win.map((f) => f.buf)
  }

  clear() {
    this.frames = []
  }
}

/** Heartbeat bookkeeping: RTT, socket backlog, last time the server said anything. */
export class NetMonitor {
  private lastMsgAt = 0
  private rtt: number | null = null
  private slowSince: number | null = null
  private connected = false
  state: NetState = 'offline'

  onOpen(now: number) {
    this.connected = true
    this.lastMsgAt = now
    this.slowSince = null
    this.rtt = null
  }

  onClose() {
    this.connected = false
  }

  /** Any message from the server proves the link is alive. */
  onMessage(now: number) {
    this.lastMsgAt = now
  }

  onPong(sentAt: number, now: number) {
    this.lastMsgAt = now
    this.rtt = now - sentAt
  }

  /** The link is open but nothing has come back for too long: treat it as dead. */
  isDead(now: number): boolean {
    return this.connected && now - this.lastMsgAt > DEAD_AFTER_MS
  }

  /** Recompute the state; returns it (callers emit only on change). */
  evaluate(now: number, bufferedBytes: number): NetState {
    if (!this.connected) return (this.state = 'offline')
    const slowNow = (this.rtt !== null && this.rtt > SLOW_RTT_MS) || bufferedBytes > SLOW_BUFFERED_BYTES || now - this.lastMsgAt > PING_EVERY_MS * 1.5
    if (slowNow) this.slowSince ??= now
    else this.slowSince = null
    return (this.state = this.slowSince !== null && now - this.slowSince >= SLOW_FOR_MS ? 'slow' : 'good')
  }

  get lastRtt() {
    return this.rtt
  }

  /** When the server was last heard from: speech after this may never have reached it. */
  get lastMessageAt() {
    return this.lastMsgAt
  }
}

export const backoffMs = (attempt: number) => RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)]
