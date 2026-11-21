/**
 * Browser voice client: mic -> 16 kHz PCM over WebSocket, reply PCM -> speaker.
 * Implements VoiceClient from contracts.ts. See shared/protocol.ts for the wire messages.
 */
import type { ClientMsg, ServerMsg, Snapshot, TurnMetrics } from '../../shared/protocol.js'
import type { Lang } from '../../shared/replies.js'
import type { VoiceClient, VoiceEvents, VoiceStatus } from './contracts'
import { clientLog as log } from './log'
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

interface StartOpts {
  lang: Lang
  snapshot: () => Snapshot
  firstRun: boolean
  handsFree: boolean
  fastSpeech?: boolean
  readBackAll?: boolean
}

export function createVoiceClient(url: string, ev: VoiceEvents): VoiceClient {
  let opts: StartOpts | null = null
  let handsFree = false
  let running = false
  let status: VoiceStatus = 'idle'

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
  let pttTailTimer: ReturnType<typeof setTimeout> | null = null

  // bad-network handling (src/lib/link.ts)
  const turns = new TurnTracker()
  const speech = new SpeechBuffer()
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

  const isBusy = () => status === 'speaking' || status === 'thinking'

  function setStatus(s: VoiceStatus) {
    if (thinkTimer) clearTimeout(thinkTimer)
    thinkTimer = null
    if (s === 'thinking') {
      // never stay busy forever if the server never answers this turn
      thinkTimer = setTimeout(() => {
        thinkTimer = null
        if (status === 'thinking') setStatus('listening')
      }, THINK_TIMEOUT_MS)
    }
    if (status === s) return
    status = s
    ev.status(s)
  }

  /** The turn produced no spoken reply: stop showing "thinking". */
  const settleIfSilent = () => {
    if (status === 'thinking') setStatus('listening')
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
      speed: opts.fastSpeech ? 1.2 : 1, readBack: !!opts.readBackAll, resume, ...(again ? { resend: again } : {}),
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
      const src = c.createMediaStreamSource(stream as MediaStream)
      src.connect(mic) // mic is never connected to the destination
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

  /** muted: the mic is not sent, the connection and any open question stay */
  let muted = false

  function onMicFrame(e: MessageEvent<{ buf: ArrayBuffer; level: number }>) {
    const { buf, level } = e.data
    micLevel = level
    const now = performance.now()
    if (now - lastLevelAt >= LEVEL_INTERVAL_MS) {
      lastLevelAt = now
      ev.level(level)
    }
    if (micDead || muted || !(handsFree || pttHeld)) return
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
      if (status === 'speaking') setStatus('listening')
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
        case 'remind':
          ev.remind(m.cid, m.text)
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
      case 'ready':
        // the socket can be up before the mic is (it opens in parallel with the permission prompt)
        if ((status === 'connecting' || status === 'offline') && micNode) setStatus('listening')
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
        if (status === 'speaking') setStatus('listening')
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
        settleIfSilent()
        break
      case 'show':
        ev.show(m)
        break
      case 'remind':
        ev.remind(m.cid, m.text)
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
        setStatus('listening')
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
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      log.info('mic_ready', { ms: ms() })
      try {
        await buildGraph(16000)
      } catch (e) {
        log.warn('audio_16k_refused', { error: String(e) })
        await buildGraph(undefined) // browser refused 16 kHz context or a cross-rate mic connection
      }
      log.info('audio_ready', { ms: ms(), sampleRate: ctx?.sampleRate })
      await resumeCtx()
      watchMic()
      document.addEventListener('visibilitychange', onVisibility)
      window.addEventListener('online', onOnline)
      window.addEventListener('offline', onOffline)
      connection()?.addEventListener('change', onConnChange)
      tick ??= setInterval(onTick, 1000)
      const sock = await sockP
      if (!sock || !running) return
      if (!early) hello(sock)
      log.info('started', { ms: ms(), audioState: ctx?.state })
      if (status === 'connecting') setStatus('listening')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      log.error('start_failed', { ms: ms(), error: msg })
      teardown()
      ev.error(msg)
      setStatus('idle')
      throw e
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
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    connection()?.removeEventListener('change', onConnChange)
    if (tick) clearInterval(tick)
    tick = null
    speech.clear()
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
    sendSnapshot: () => {
      if (opts) send({ type: 'snapshot', snapshot: opts.snapshot() })
    },
    setHandsFree,
    setMuted(on: boolean) {
      if (muted === on) return
      log.info('setting', { muted: on })
      muted = on
    },
    setReadBackAll(on: boolean) {
      log.info('setting', { readBackAll: on })
      if (opts) opts.readBackAll = on
      send({ type: 'readback', on })
    },
    setFastSpeech(on: boolean) {
      log.info('setting', { fastSpeech: on })
      if (opts) opts.fastSpeech = on
      send({ type: 'speed', speed: on ? 1.2 : 1 })
    },
    bargeIn() {
      if (!running) return
      log.info('barge_in', { status })
      send({ type: 'barge' })
      toPlayer({ type: 'stop' }) // silence now, do not wait for the server
      if (status === 'speaking' || status === 'thinking') setStatus('listening')
    },
  }
}
