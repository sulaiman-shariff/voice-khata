/**
 * Browser voice client: mic -> 16 kHz PCM over WebSocket, reply PCM -> speaker.
 * Implements VoiceClient from contracts.ts. See shared/protocol.ts for the wire messages.
 */
import type { ClientMsg, ServerMsg, Snapshot, TurnMetrics } from '../../shared/protocol.js'
import type { Lang } from '../../shared/replies.js'
import type { VoiceClient, VoiceEvents, VoiceStatus } from './contracts'
import { clientLog as log } from './log'
import { createWakeDetector, WAKE_MODEL_URL, type WakeDetector } from './wake'
import { MODEL_CONTRACT } from './wake/features'
import { NetMonitor, PING_EVERY_MS, PROBE_TIMEOUT_MS, SpeechBuffer, TurnTracker, backoffMs } from './link'

export function defaultVoiceUrl(): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/voice`
}

const PTT_TAIL_MS = 200
const RECONNECT_AFTER_MS = 270_000
const LEVEL_INTERVAL_MS = 33
const METRICS_WAIT_MS = 2000
const HARD_SWAP_MS = 290_000 // swap no later than this (server cap is 300 s), whatever is open
const OLD_SOCKET_GRACE_MS = 3000
const SPEECH_LEVEL = 0.02
const PARTIAL_STALE_MS = 4000
const THINK_TIMEOUT_MS = 25_000
const RESUME_TIMEOUT_MS = 1000
const MIC_CONSTRAINTS: MediaStreamConstraints = { audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }

interface StartOpts {
  lang: Lang
  auto?: boolean
  snapshot: () => Snapshot
  firstRun: boolean
  handsFree: boolean
  speed?: 0.8 | 1 | 1.2
  /** false: socket only (typed text); the mic opens on the first wake */
  mic?: boolean
}

const PREROLL_MS = 2000
/** A reply that never drains must not leave the detector paused (the app deaf) for ever. */
const SPEAKING_WATCHDOG_MS = 30_000

/**
 * The real detector, only when the trained model file is reachable (a dev server answers a missing
 * file with index.html, so a web page is not a model). createWakeDetector itself returns null when
 * the worker or WASM cannot load.
 */
async function defaultCreateDetector(): Promise<WakeDetector | null> {
  try {
    const r = await fetch(WAKE_MODEL_URL, { method: 'HEAD' })
    if (!r.ok || (r.headers.get('content-type') ?? '').includes('text/html')) return null
    return await createWakeDetector({ threshold: MODEL_CONTRACT.threshold })
  } catch {
    return null
  }
}

export interface VoiceDeps {
  createDetector?: () => Promise<WakeDetector | null>
}

export function createVoiceClient(url: string, ev: VoiceEvents, deps: VoiceDeps = {}): VoiceClient {
  let opts: StartOpts | null = null
  let handsFree = false
  let running = false
  let status: VoiceStatus = 'idle'
  /** awake = 'listening'; asleep waits for the wake word or a tap */
  let awake = false

  let stream: MediaStream | null = null
  let ctx: AudioContext | null = null
  let micNode: AudioWorkletNode | null = null
  let playerNode: AudioWorkletNode | null = null

  let ws: WebSocket | null = null
  let backoffIdx = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let swapping = false
  let swapInFlight = false
  let adoptedAt = 0
  const oldSockets = new Set<WebSocket>()

  let pendingOpen = false // last 'pending' msg was non-null: the server holds a question
  let partialAt: number | null = null // a 'partial' arrived and its 'final' has not
  let micLevel = 0
  let turnSaid = false
  let thinkTimer: ReturnType<typeof setTimeout> | null = null
  let micDead = false
  /** reply audio received for the current turn (logged, not otherwise used) */
  let turnAudioBytes = 0

  let pttHeld = false
  /** a 'wake' with source 'hold' was sent and its hold_end has not been */
  let holdActive = false
  let pttTailTimer: ReturnType<typeof setTimeout> | null = null

  // bad-network handling (src/lib/link.ts)
  const turns = new TurnTracker()
  const speech = new SpeechBuffer()
  /** the last ~2 s while asleep behind a detector; never replayed after a reconnect */
  const preroll = new SpeechBuffer(PREROLL_MS + 500)
  let speakingTimer: ReturnType<typeof setTimeout> | null = null
  const net = new NetMonitor()
  let netShown: 'good' | 'slow' | 'offline' | null = null
  /** the server's latest session state, handed back in the next hello */
  let resume: string | undefined
  /** a turn lost to a drop, to be handled again by the next session */
  let resend: string | null = null
  /** speech captured since this time may not have reached the server: replay it after reconnect */
  let droppedSince: number | null = null
  let tick: ReturnType<typeof setInterval> | null = null
  let lastPingAt = 0
  let probeDeadline: number | null = null

  let lastLevelAt = 0
  let finalAt: number | null = null
  let playerStartedAt: number | null = null
  let pendingMetrics: TurnMetrics | null = null
  let metricsTimer: ReturnType<typeof setTimeout> | null = null

  /** On-phone wake detector; null = none (or it failed): audio streams to the server as before. */
  let detector: WakeDetector | null = null
  let detectorLoading = false
  /** asleep with a live detector: no audio leaves the phone */
  const gated = () => detector !== null && !awake

  /** The detector listens only while asleep and while the app is not speaking (its own voice must not wake it). */
  function syncDetector() {
    if (!detector) return
    if (awake || status === 'speaking') detector.pause()
    else detector.resume()
  }

  function dropDetector() {
    const d = detector
    detector = null
    d?.dispose()
  }

  async function initDetector() {
    if (detector || detectorLoading || !running) return
    detectorLoading = true
    try {
      const d = await (deps.createDetector ?? defaultCreateDetector)()
      if (!d) return
      if (!running) { d.dispose(); return }
      d.onWake(onDetectorWake)
      d.onFail(() => {
        log.warn('wake_detector_failed')
        if (detector === d) detector = null // stream to the server again: it spots the wake word
      })
      detector = d
      syncDetector()
      log.info('wake_detector_ready')
    } catch (e) {
      log.warn('wake_detector_unavailable', { error: String(e) })
    } finally {
      detectorLoading = false
    }
  }

  /** The phone heard the wake word: tell the server, give it the last 2 s, then live frames follow. */
  function onDetectorWake() {
    if (!running || awake || !detector) return
    // Socket closed or swapping: the wake could not reach the server (and the pre-roll would be lost),
    // so stay asleep and keep listening; the shopkeeper says it again once the link is back.
    if (!ws || ws.readyState !== WebSocket.OPEN || swapping) {
      log.warn('wake_dropped', { reason: 'no_socket' })
      return
    }
    log.info('wake', { source: 'phone' })
    send({ type: 'wake', source: 'phone' })
    setAwake(true)
    const now = performance.now()
    for (const f of preroll.replayWindow(now - PREROLL_MS, now, 0)) ws.send(f)
    preroll.clear()
  }

  const idleStatus = (): VoiceStatus => (awake ? 'listening' : 'asleep')
  const isBusy = () => status === 'speaking' || status === 'thinking'

  function setStatus(s: VoiceStatus) {
    if (thinkTimer) clearTimeout(thinkTimer)
    thinkTimer = null
    if (s === 'thinking') {
      // never stay busy forever if the server never answers this turn
      thinkTimer = setTimeout(() => {
        thinkTimer = null
        if (status === 'thinking') setStatus(idleStatus())
      }, THINK_TIMEOUT_MS)
    }
    if (speakingTimer) clearTimeout(speakingTimer)
    speakingTimer = null
    if (s === 'speaking') {
      speakingTimer = setTimeout(() => {
        speakingTimer = null
        if (status === 'speaking') {
          log.warn('speaking_watchdog')
          setStatus(idleStatus())
        }
      }, SPEAKING_WATCHDOG_MS)
    }
    if (status === s) return
    status = s
    syncDetector()
    ev.status(s)
  }

  /** The turn produced no spoken reply: stop showing "thinking". */
  const settleIfSilent = () => {
    if (status === 'thinking') setStatus(idleStatus())
  }

  /** Awake/asleep changed (server answer or optimistic local change after a tap). */
  function setAwake(a: boolean, quiet = false) {
    if (awake === a) return
    awake = a
    if (!quiet) ev.attention?.(a ? 'awake' : 'asleep') // quiet: a reconnect reset, not worth a chime
    syncDetector()
    if (a && status === 'asleep') setStatus('listening')
    else if (!a && status === 'listening') setStatus('asleep')
  }

  function sendTo(sock: WebSocket | null, msg: ClientMsg) {
    if (sock && sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify(msg))
  }
  const send = (msg: ClientMsg) => sendTo(ws, msg)

  function hello(sock: WebSocket) {
    if (!opts) return
    const again = resend
    resend = null
    sendTo(sock, {
      type: 'hello', lang: opts.lang, snapshot: opts.snapshot(), firstRun: opts.firstRun, ptt: !handsFree,
      speed: opts.speed ?? 1, resume, ...(again ? { resend: again } : {}),
    })
    opts.firstRun = false // the disclosure plays once, not on every reconnect
    if (again) {
      log.warn('resend', { text: again })
      ev.resent?.(again)
      // in flight again until its result arrives: a second drop re-sends it once more
      turns.onFinal(again, performance.now())
    }
    // speech from the gap: replayed (paced by the server) right after hello
    if (droppedSince !== null) {
      const since = Math.max(droppedSince - 1500, turns.lastFinalAt, turns.lastTurnDoneAt)
      const frames = speech.replayWindow(since, performance.now(), SPEECH_LEVEL)
      droppedSince = null
      if (frames.length) {
        log.info('replay', { frames: frames.length, audioMs: frames.length * 32 })
        sendTo(sock, { type: 'replay_start' })
        for (const f of frames) if (sock.readyState === WebSocket.OPEN) sock.send(f)
        sendTo(sock, { type: 'replay_end' })
      }
    }
  }

  // ------------------------------------------------------------ audio graph
  async function buildGraph(rate: number | undefined): Promise<void> {
    const c = rate ? new AudioContext({ sampleRate: rate }) : new AudioContext()
    try {
      await Promise.all([c.audioWorklet.addModule('/worklets/mic.js'), c.audioWorklet.addModule('/worklets/player.js')])
      const mic = new AudioWorkletNode(c, 'mic', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: 'explicit' })
      const player = new AudioWorkletNode(c, 'player', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] })
      if (stream) c.createMediaStreamSource(stream).connect(mic) // mic is never connected to the destination
      player.connect(c.destination)
      mic.port.onmessage = onMicFrame
      player.port.onmessage = onPlayerMsg
      ctx = c
      micNode = mic
      playerNode = player
    } catch (e) {
      void c.close().catch(() => {})
      throw e
    }
  }

  function onMicFrame(e: MessageEvent<{ buf: ArrayBuffer; level: number }>) {
    const { buf, level } = e.data
    micLevel = level
    const now = performance.now()
    if (now - lastLevelAt >= LEVEL_INTERVAL_MS) {
      lastLevelAt = now
      ev.level(level)
    }
    if (micDead || !(handsFree || pttHeld)) return
    if (gated() && !pttHeld) {
      // Asleep behind a detector: nothing may reach the server, so this audio stays out of the
      // reconnect-replay buffer and only the short pre-roll ring keeps it. While the app speaks the
      // detector is paused and feed() drops the frame by its own paused check.
      preroll.push(buf, level, now)
      detector?.feed(buf)
      return
    }
    speech.push(buf, level, now) // kept a few seconds so speech during a drop can be replayed
    if (!ws || ws.readyState !== WebSocket.OPEN || swapping) return // not sent now; replayed after reconnect
    ws.send(buf)
  }

  function onPlayerMsg(e: MessageEvent<{ type: string }>) {
    const t = e.data.type
    if (t === 'started') {
      playerStartedAt = performance.now()
      log.info('playback_start', { msAfterFinal: finalAt === null ? null : Math.round(playerStartedAt - finalAt) })
      flushMetrics()
    } else if (t === 'drained') {
      log.debug('playback_done', { audioBytes: turnAudioBytes })
      send({ type: 'playback_done' })
      if (status === 'speaking') setStatus(idleStatus())
    }
  }

  const toPlayer = (m: { type: string; buf?: ArrayBuffer }) => {
    if (m.buf) playerNode?.port.postMessage(m, [m.buf])
    else playerNode?.port.postMessage(m)
  }

  // ------------------------------------------------------------ metrics
  function flushMetrics(forceNull = false) {
    if (!pendingMetrics) return
    const turn = pendingMetrics
    let ms: number | null = null
    if (finalAt !== null && playerStartedAt !== null && playerStartedAt >= finalAt) ms = Math.round(playerStartedAt - finalAt)
    else if (!forceNull && turn.firstAudioAt !== null) return // audio is expected: wait for 'started'
    pendingMetrics = null
    if (metricsTimer) clearTimeout(metricsTimer)
    metricsTimer = null
    log.info('turn_metrics', { ...turn, clientFirstAudioMs: ms })
    ev.metrics({ ...turn, clientFirstAudioMs: ms })
  }

  // ------------------------------------------------------------ socket
  function handleMessage(sock: WebSocket, e: MessageEvent) {
    const isOld = sock !== ws
    if (isOld && !oldSockets.has(sock)) return
    if (!isOld) net.onMessage(performance.now())
    if (e.data instanceof ArrayBuffer) {
      if (!isOld) {
        turnAudioBytes += e.data.byteLength
        toPlayer({ type: 'pcm', buf: e.data })
      }
      return // audio from a retired socket would overlap the new one
    }
    if (typeof e.data !== 'string') return
    let m: ServerMsg
    try {
      m = JSON.parse(e.data) as ServerMsg
    } catch {
      log.warn('bad_server_message', { bytes: e.data.length })
      return
    }
    logServerMsg(m, isOld)
    if (isOld) {
      // in-flight turn on the retired socket: keep its text results, never its audio/state control
      switch (m.type) {
        case 'final':
          ev.final(m.text)
          break
        case 'ops':
          turns.onOps()
          applyAndAck(sock, m.ops, m.seq)
          break
        case 'say':
          turnSaid = true
          ev.say(m.text)
          break
        case 'show':
          ev.show(m)
          break
        case 'error':
          ev.error(m.message)
          settleIfSilent()
          break
        case 'turn_done':
          turns.onTurnDone(performance.now())
          if (m.resume) resume = m.resume
          settleIfSilent()
          break
      }
      return
    }
    switch (m.type) {
      case 'setting':
        if (m.key === 'lang' && typeof m.value === 'string') {
          // spoken language change: continue in it on this socket (no reconnect, the mic stays on)
          if (opts) opts.lang = m.value as Lang
          ev.lang?.(m.value as Lang)
        } else ev.setting?.(m)
        break
      case 'ready':
        if ('kind' in m) { ev.ready?.(m); break } // the one-tap card, not the connection greeting
        // the socket can be up before the mic is (it opens in parallel with the permission prompt)
        if (status === 'connecting' || status === 'offline') setStatus(idleStatus())
        break
      case 'attention':
        setAwake(m.state === 'awake')
        break
      case 'heard':
        ev.heard?.()
        if (status === 'listening') setStatus('thinking')
        break
      case 'lang':
        if (opts) opts.lang = m.lang // reconnects keep the new language
        ev.lang?.(m.lang)
        break
      case 'partial':
        partialAt = performance.now()
        ev.partial(m.text)
        break
      case 'pong':
        net.onPong(m.t, performance.now())
        probeDeadline = null
        break
      case 'not_entry':
        ev.notEntry?.(m.text)
        break
      case 'final':
        turns.onFinal(m.text, performance.now())
        partialAt = null
        turnSaid = false
        finalAt = performance.now()
        playerStartedAt = null
        ev.final(m.text)
        setStatus('thinking')
        break
      case 'ops':
        turns.onOps()
        applyAndAck(sock, m.ops, m.seq)
        break
      case 'say':
        turnSaid = true
        ev.say(m.text)
        setStatus('speaking')
        break
      case 'audio_end':
        toPlayer({ type: 'end' })
        break
      case 'duck':
        toPlayer({ type: 'duck' })
        break
      case 'unduck':
        toPlayer({ type: 'unduck' })
        break
      case 'stop_audio':
        toPlayer({ type: 'stop' })
        if (status === 'speaking') setStatus(idleStatus())
        break
      case 'pending':
        pendingOpen = m.pending !== null
        ev.pending(m.pending)
        if (!turnSaid) settleIfSilent()
        break
      case 'turn_done':
        turns.onTurnDone(performance.now())
        if (m.resume) resume = m.resume
        partialAt = null
        ev.turnDone?.()
        settleIfSilent()
        break
      case 'show':
        ev.show(m)
        break
      case 'metrics':
        if (!turnSaid) settleIfSilent()
        pendingMetrics = m.turn
        flushMetrics()
        if (pendingMetrics) {
          if (metricsTimer) clearTimeout(metricsTimer)
          metricsTimer = setTimeout(() => flushMetrics(true), METRICS_WAIT_MS)
        }
        break
      case 'error':
        ev.error(m.message)
        settleIfSilent()
        break
    }
  }

  /** Write the ops on the phone, then tell the server they arrived. */
  function applyAndAck(sock: WebSocket, ops: Parameters<VoiceEvents['ops']>[0], seq?: number) {
    Promise.resolve(ev.ops(ops))
      .then(() => {
        if (seq !== undefined) sendTo(sock.readyState === WebSocket.OPEN ? sock : ws, { type: 'ack', seq })
      })
      .catch((e) => log.error('ops_apply_failed', { error: String(e), seq }))
  }

  function emitNet() {
    const s = net.evaluate(performance.now(), ws?.bufferedAmount ?? 0)
    if (s === netShown) return
    netShown = s
    log.info('network', { state: s, rttMs: net.lastRtt })
    ev.network?.(s)
  }

  /** Heartbeat, dead-link watchdog and network state: once a second while running. */
  function onTick() {
    if (!running) return
    const now = performance.now()
    if (ws && ws.readyState === WebSocket.OPEN && !swapping) {
      if (now - lastPingAt >= PING_EVERY_MS) {
        lastPingAt = now
        send({ type: 'ping', t: now })
      }
      if (net.isDead(now)) dropSocket('no_reply')
      else if (probeDeadline !== null && now > probeDeadline) dropSocket('probe_timeout')
    }
    emitNet()
  }

  /** The link is dead (or the network changed under it): stop using it now and reconnect. */
  function dropSocket(reason: string) {
    const s = ws
    if (!s) return
    log.warn('link_dead', { reason, rttMs: net.lastRtt, bufferedBytes: s.bufferedAmount })
    s.onclose = null
    s.onmessage = null
    try {
      s.close(4000, reason)
    } catch { /* already closing */ }
    onClosed(s, 4000, reason)
  }

  /** Network came back or changed: check the link at once instead of waiting for the watchdog. */
  function onNetworkChange(kind: string) {
    if (!running) return
    log.info('network_event', { kind, online: navigator.onLine })
    if (kind === 'offline') {
      dropSocket('offline')
      return
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reconnectNow()
      return
    }
    probeDeadline = performance.now() + PROBE_TIMEOUT_MS
    lastPingAt = performance.now()
    send({ type: 'ping', t: lastPingAt })
  }
  const onOnline = () => onNetworkChange('online')
  const onOffline = () => onNetworkChange('offline')
  const onConnChange = () => onNetworkChange('change')
  const connection = () => (navigator as unknown as { connection?: EventTarget }).connection

  function reconnectNow() {
    if (!running) return
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = null
    backoffIdx = 0
    scheduleReconnect(0)
  }

  /** Open a socket; resolves once open (hello is sent by the caller). */
  function openSocket(): Promise<WebSocket> {
    const t0 = performance.now()
    log.debug('socket_opening', { url })
    return new Promise((resolve, reject) => {
      const sock = new WebSocket(url)
      sock.binaryType = 'arraybuffer'
      sock.onopen = () => {
        log.info('socket_open', { ms: Math.round(performance.now() - t0) })
        resolve(sock)
      }
      sock.onerror = () => {
        log.warn('socket_error', { ms: Math.round(performance.now() - t0) })
        reject(new Error('socket error'))
      }
      sock.onclose = (e) => {
        log.warn('socket_closed_before_open', { code: e.code, reason: e.reason })
        reject(new Error('socket closed'))
      }
    })
  }

  /** One console line per server message (audio is counted per turn instead). */
  function logServerMsg(m: ServerMsg, old: boolean) {
    const tag = old ? { oldSocket: true } : {}
    switch (m.type) {
      case 'partial':
        log.debug('partial', { text: m.text, ...tag })
        break
      case 'final':
        turnAudioBytes = 0
        log.info('final', { text: m.text, ...tag })
        break
      case 'say':
        log.info('say', { text: m.text, ...tag })
        break
      case 'ops':
        log.info('ops', { ops: m.ops.map((o) => o.op), ...tag })
        break
      case 'pending':
        log.debug('pending', { kind: m.pending?.kind ?? null, ...tag })
        break
      case 'audio_end':
        log.debug('audio_end', { audioBytes: turnAudioBytes, audioMs: Math.round(turnAudioBytes / 32), ...tag })
        break
      case 'error':
        log.warn('server_error', { message: m.message, ...tag })
        break
      case 'metrics':
        break // logged with the client's own first-audio time in flushMetrics
      default:
        log.debug(m.type, { ...(m as object), ...tag })
    }
  }

  function adopt(sock: WebSocket) {
    sock.onmessage = (e) => handleMessage(sock, e)
    sock.onerror = null
    sock.onclose = (e) => onClosed(sock, e.code, e.reason)
    ws = sock
    backoffIdx = 0
    adoptedAt = Date.now()
    net.onOpen(performance.now())
    probeDeadline = null
    emitNet()
    // a new socket is a new server Session: the open question comes back with the resumed state
    // (the server re-sends 'pending' after hello); no half-heard turn, no held key
    partialAt = null
    releasePtt()
    scheduleRefresh()
  }

  function releasePtt() {
    pttHeld = false
    if (pttTailTimer) clearTimeout(pttTailTimer)
    pttTailTimer = null
  }

  function onClosed(sock: WebSocket, code?: number, reason?: string) {
    if (sock !== ws || !running) return
    log.warn('socket_closed', { code, reason, ageS: Math.round((Date.now() - adoptedAt) / 1000) })
    ws = null
    net.onClose()
    resend = turns.onDrop() ?? resend
    // the server last proved it was receiving at its last message: replay speech from about then
    droppedSince ??= net.lastMessageAt
    emitNet()
    clearRefresh()
    releasePtt()
    partialAt = null
    setStatus('offline')
    scheduleReconnect()
  }

  function scheduleReconnect(delayOverride?: number) {
    if (!running || reconnectTimer) return
    const delay = delayOverride ?? backoffMs(backoffIdx)
    backoffIdx++
    log.info('reconnect_scheduled', { delayMs: delay, attempt: backoffIdx })
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null
      if (!running) return
      try {
        const sock = await openSocket()
        if (!running) {
          sock.close()
          return
        }
        hello(sock)
        adopt(sock)
        log.info('reconnected', { attempt: backoffIdx })
        setAwake(false, true) // a new server session starts asleep; it says so if it is awake
        setStatus(idleStatus())
      } catch (e) {
        log.warn('reconnect_failed', { error: String(e) })
        scheduleReconnect()
      }
    }, delay)
  }

  function clearRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = null
  }

  function scheduleRefresh(delay = RECONNECT_AFTER_MS) {
    clearRefresh()
    refreshTimer = setTimeout(() => void proactiveReconnect(), delay)
  }

  /**
   * Swap to a fresh socket (Vercel caps functions at 300 s). Only when idle: not busy, no key held,
   * no open question and nobody mid-sentence - but never later than HARD_SWAP_MS.
   * `urgent` (mode change) skips the question/speech checks.
   */
  async function proactiveReconnect(urgent = false) {
    refreshTimer = null
    if (!running || !ws || swapInFlight) return
    const age = Date.now() - adoptedAt
    const hard = age >= HARD_SWAP_MS
    const partialActive = partialAt !== null && performance.now() - partialAt < PARTIAL_STALE_MS
    const quiet = urgent || (!pendingOpen && !partialActive && micLevel < SPEECH_LEVEL)
    if (!hard && (isBusy() || pttHeld || !quiet)) {
      log.debug('swap_postponed', { ageS: Math.round(age / 1000), busy: isBusy(), ptt: pttHeld, quiet })
      scheduleRefresh(Math.max(250, Math.min(2000, HARD_SWAP_MS - age)))
      return
    }
    log.info('swap_start', { ageS: Math.round(age / 1000), hard, urgent })
    const swapT0 = performance.now()
    swapInFlight = true
    try {
      const sock = await openSocket()
      if (!running) {
        sock.close()
        return
      }
      const nowHard = Date.now() - adoptedAt >= HARD_SWAP_MS
      if (!nowHard && (isBusy() || pttHeld)) {
        // got busy while connecting: keep the old socket and try later
        log.info('swap_aborted', { reason: 'busy' })
        sock.close()
        scheduleRefresh(2000)
        return
      }
      const old = ws
      swapping = true
      hello(sock)
      if (old) {
        old.onclose = null
        // keep its handler a few seconds so the final/ops/say of an in-flight turn still arrive
        oldSockets.add(old)
        setTimeout(() => {
          oldSockets.delete(old)
          old.onmessage = null
          try {
            old.close()
          } catch {
            /* already closed */
          }
        }, OLD_SOCKET_GRACE_MS)
      }
      adopt(sock)
      setAwake(false, true) // the new session starts asleep; its 'attention' (sent after hello) says otherwise
      swapping = false
      log.info('swap_done', { ms: Math.round(performance.now() - swapT0) })
    } catch (e) {
      swapping = false
      log.warn('swap_failed', { error: String(e) })
      scheduleRefresh(5000) // old socket still alive (or its close handler will reconnect)
    } finally {
      swapInFlight = false
    }
  }

  // ------------------------------------------------------------ public API
  async function start(o: StartOpts): Promise<void> {
    if (running) return
    opts = { ...o }
    handsFree = o.handsFree
    running = true
    awake = false
    setStatus('connecting')
    // connect in parallel with the mic permission prompt and audio setup: the server opens the
    // Gnani streams meanwhile. On the very first run the AI disclosure is spoken right after
    // hello, so that hello waits for the audio graph (else its audio would have nowhere to play).
    const early = !o.firstRun
    const sockP = openSocket().then((sock) => {
      if (!running) {
        sock.close()
        return null
      }
      if (early) hello(sock)
      adopt(sock)
      return sock
    })
    sockP.catch(() => {})
    const t0 = performance.now()
    const ms = () => Math.round(performance.now() - t0)
    log.info('start', { lang: o.lang, handsFree: o.handsFree, firstRun: o.firstRun, early })
    try {
      if (o.mic !== false) {
        stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS)
        log.info('mic_ready', { ms: ms() })
      }
      await setupAudio(ms)
      if (stream) { watchMic(); void initDetector() }
      document.addEventListener('visibilitychange', onVisibility)
      window.addEventListener('online', onOnline)
      window.addEventListener('offline', onOffline)
      connection()?.addEventListener('change', onConnChange)
      tick ??= setInterval(onTick, 1000)
      const sock = await sockP
      if (!sock || !running) return
      if (!early) hello(sock)
      log.info('started', { ms: ms(), audioState: ctx?.state })
      if (status === 'connecting') setStatus(idleStatus())
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      log.error('start_failed', { ms: ms(), error: msg })
      teardown()
      ev.error(msg)
      setStatus('idle')
      throw e
    }
  }

  /** The audio graph (speaker always; mic input when the stream is open). Text-only sessions survive without audio. */
  async function setupAudio(ms: () => number): Promise<void> {
    try {
      try {
        await buildGraph(16000)
      } catch (e) {
        log.warn('audio_16k_refused', { error: String(e) })
        await buildGraph(undefined) // browser refused 16 kHz context or a cross-rate mic connection
      }
    } catch (e) {
      if (stream) throw e
      log.warn('audio_unavailable', { error: String(e) }) // typed text still works, just silently
      return
    }
    log.info('audio_ready', { ms: ms(), sampleRate: ctx?.sampleRate })
    await resumeCtx()
  }

  /** Open the mic on a socket-only session (first wake). */
  async function attachMic(): Promise<void> {
    if (stream || !running) return
    try {
      const s = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS)
      if (!running) { s.getTracks().forEach((t) => t.stop()); return }
      stream = s
      if (!ctx) await setupAudio(() => 0)
      else if (micNode) ctx.createMediaStreamSource(s).connect(micNode)
      watchMic()
      void initDetector()
      void resumeCtx()
      log.info('mic_attached')
    } catch (e) {
      log.error('mic_attach_failed', { error: String(e) })
      ev.error(e instanceof Error ? e.message : String(e))
      holdActive = false
      send({ type: 'sleep' }) // the wake we sent has nothing to listen with
      setAwake(false)
      ev.micError?.()
    }
  }

  /** Resume the AudioContext without ever hanging on a promise the browser may not settle. */
  async function resumeCtx(): Promise<void> {
    const c = ctx
    if (!c || c.state === 'running') return
    await Promise.race([c.resume().catch(() => {}), new Promise<void>((r) => setTimeout(r, RESUME_TIMEOUT_MS))])
  }

  function onVisibility() {
    if (!running) return
    if (document.visibilityState === 'visible') void resumeCtx()
    else if (pttHeld) pttUp() // the key-up may never arrive once the page is hidden
  }

  function watchMic() {
    micDead = false
    if (ctx) {
      ctx.onstatechange = () => {
        if (running && ctx && ctx.state !== 'running' && ctx.state !== 'closed') void resumeCtx()
      }
    }
    for (const t of stream?.getTracks() ?? []) {
      t.onended = () => {
        if (!running || micDead) return
        micDead = true
        log.error('mic_ended')
        releasePtt()
        ev.error('Microphone stopped (unplugged, or permission taken away). Please reconnect it and restart.')
        setStatus('offline')
      }
    }
  }

  function teardown() {
    running = false
    dropDetector()
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    connection()?.removeEventListener('change', onConnChange)
    if (tick) clearInterval(tick)
    tick = null
    speech.clear()
    preroll.clear()
    if (speakingTimer) clearTimeout(speakingTimer)
    speakingTimer = null
    resend = null
    droppedSince = null
    probeDeadline = null
    net.onClose()
    if (thinkTimer) clearTimeout(thinkTimer)
    thinkTimer = null
    pendingOpen = false
    partialAt = null
    micDead = false
    for (const o of oldSockets) {
      o.onmessage = null
      o.onclose = null
      o.close()
    }
    oldSockets.clear()
    if (ctx) ctx.onstatechange = null
    for (const t of stream?.getTracks() ?? []) t.onended = null
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = null
    clearRefresh()
    if (pttTailTimer) clearTimeout(pttTailTimer)
    pttTailTimer = null
    if (metricsTimer) clearTimeout(metricsTimer)
    metricsTimer = null
    pendingMetrics = null
    pttHeld = false
    holdActive = false
    swapInFlight = false
    swapping = false
    if (ws) {
      ws.onclose = null
      ws.onmessage = null
      ws.close()
      ws = null
    }
    if (micNode) micNode.port.onmessage = null
    if (playerNode) playerNode.port.onmessage = null
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
    void ctx?.close().catch(() => {})
    ctx = null
    micNode = null
    playerNode = null
  }

  function stop() {
    log.info('stop')
    teardown()
    setStatus('idle')
  }

  function pttDown() {
    if (!running) return
    if (pttTailTimer) {
      clearTimeout(pttTailTimer)
      pttTailTimer = null
      send({ type: 'ptt_end' })
    }
    pttHeld = true
    log.debug('ptt_down')
    send({ type: 'ptt_start' })
  }

  function pttUp() {
    if (!running || !pttHeld) return
    if (pttTailTimer) clearTimeout(pttTailTimer)
    // keep streaming for the tail, then end the turn
    pttTailTimer = setTimeout(() => {
      pttTailTimer = null
      pttHeld = false
      log.debug('ptt_up')
      send({ type: 'ptt_end' })
    }, PTT_TAIL_MS)
  }

  function setHandsFree(on: boolean) {
    if (handsFree === on) return
    log.info('setting', { handsFree: on })
    handsFree = on
    // the protocol only carries the mode in hello, so re-hello on a fresh socket
    if (running && ws && !swapping) {
      clearRefresh()
      void proactiveReconnect(true)
    }
  }

  return {
    start,
    stop,
    pttDown,
    pttUp,
    tap: (action) => send({ type: 'tap', action }),
    answer: (text) => send({ type: 'answer', text }),
    sendText: (text) => send({ type: 'text', text }),
    force: (text) => send({ type: 'force', text }),
    sendSnapshot: () => {
      if (opts) send({ type: 'snapshot', snapshot: opts.snapshot() })
    },
    setHandsFree,
    setSpeed(speed: 0.8 | 1 | 1.2) {
      log.info('setting', { speed })
      if (opts) opts.speed = speed
      send({ type: 'speed', speed })
    },
    bargeIn() {
      if (!running) return
      log.info('barge_in', { status })
      send({ type: 'barge' })
      toPlayer({ type: 'stop' }) // silence now, do not wait for the server
      if (status === 'speaking' || status === 'thinking') setStatus(idleStatus())
    },
    wake(source) {
      if (!running) return
      log.info('wake', { source })
      if (source === 'hold') {
        if (holdActive) return // never two hold wakes for one press
        holdActive = true
      }
      send({ type: 'wake', source })
      setAwake(true) // optimistic: the server's 'attention' confirms (or says asleep)
      if (!stream) void attachMic()
    },
    holdEnd() {
      if (!running || !holdActive) return // no hold started: nothing to end
      holdActive = false
      log.debug('hold_end')
      send({ type: 'hold_end' })
    },
    sleep() {
      if (!running) return
      log.info('sleep')
      send({ type: 'sleep' })
      setAwake(false)
    },
    setLang(l) {
      if (opts) opts.lang = l
      // the protocol only carries the language in hello: re-hello on a fresh socket, mic stays on
      if (running && ws && !swapping) {
        clearRefresh()
        void proactiveReconnect(true)
      }
    },
  }
}
