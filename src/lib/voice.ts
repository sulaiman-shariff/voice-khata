/**
 * Browser voice client: mic -> 16 kHz PCM over WebSocket, reply PCM -> speaker.
 * Implements VoiceClient from contracts.ts. See shared/protocol.ts for the wire messages.
 */
import type { ClientMsg, ServerMsg, Snapshot, TurnMetrics } from '../../shared/protocol.js'
import type { Lang } from '../../shared/replies.js'
import type { VoiceClient, VoiceEvents, VoiceStatus } from './contracts'

export function defaultVoiceUrl(): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/voice`
}

const PTT_TAIL_MS = 200
const RECONNECT_AFTER_MS = 270_000
const BACKOFF_MS = [500, 1000, 2000, 5000]
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

  let pttHeld = false
  let pttTailTimer: ReturnType<typeof setTimeout> | null = null

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
    sendTo(sock, { type: 'hello', lang: opts.lang, snapshot: opts.snapshot(), firstRun: opts.firstRun, ptt: !handsFree })
    opts.firstRun = false // the disclosure plays once, not on every reconnect
  }

  // ------------------------------------------------------------ audio graph
  async function buildGraph(rate: number | undefined): Promise<void> {
    const c = rate ? new AudioContext({ sampleRate: rate }) : new AudioContext()
    try {
      await c.audioWorklet.addModule('/worklets/mic.js')
      await c.audioWorklet.addModule('/worklets/player.js')
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

  function onMicFrame(e: MessageEvent<{ buf: ArrayBuffer; level: number }>) {
    const { buf, level } = e.data
    micLevel = level
    const now = performance.now()
    if (now - lastLevelAt >= LEVEL_INTERVAL_MS) {
      lastLevelAt = now
      ev.level(level)
    }
    if (micDead || !ws || ws.readyState !== WebSocket.OPEN || swapping) return // dropped while disconnected
    if (handsFree || pttHeld) ws.send(buf)
  }

  function onPlayerMsg(e: MessageEvent<{ type: string }>) {
    const t = e.data.type
    if (t === 'started') {
      playerStartedAt = performance.now()
      flushMetrics()
    } else if (t === 'drained') {
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
    ev.metrics({ ...turn, clientFirstAudioMs: ms })
  }

  // ------------------------------------------------------------ socket
  function handleMessage(sock: WebSocket, e: MessageEvent) {
    const isOld = sock !== ws
    if (isOld && !oldSockets.has(sock)) return
    if (e.data instanceof ArrayBuffer) {
      if (!isOld) toPlayer({ type: 'pcm', buf: e.data })
      return // audio from a retired socket would overlap the new one
    }
    if (typeof e.data !== 'string') return
    let m: ServerMsg
    try {
      m = JSON.parse(e.data) as ServerMsg
    } catch {
      return
    }
    if (isOld) {
      // in-flight turn on the retired socket: keep its text results, never its audio/state control
      switch (m.type) {
        case 'final':
          ev.final(m.text)
          break
        case 'ops':
          ev.ops(m.ops)
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
          settleIfSilent()
          break
      }
      return
    }
    switch (m.type) {
      case 'ready':
        if (status === 'connecting' || status === 'offline') setStatus('listening')
        break
      case 'partial':
        partialAt = performance.now()
        ev.partial(m.text)
        break
      case 'final':
        partialAt = null
        turnSaid = false
        finalAt = performance.now()
        playerStartedAt = null
        ev.final(m.text)
        setStatus('thinking')
        break
      case 'ops':
        ev.ops(m.ops)
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

  /** Open a socket; resolves once open (hello is sent by the caller). */
  function openSocket(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const sock = new WebSocket(url)
      sock.binaryType = 'arraybuffer'
      sock.onopen = () => resolve(sock)
      sock.onerror = () => reject(new Error('socket error'))
      sock.onclose = () => reject(new Error('socket closed'))
    })
  }

  function adopt(sock: WebSocket) {
    sock.onmessage = (e) => handleMessage(sock, e)
    sock.onerror = null
    sock.onclose = () => onClosed(sock)
    ws = sock
    backoffIdx = 0
    adoptedAt = Date.now()
    // a new socket is a new server Session: no open question, no half-heard turn, no held key
    if (pendingOpen) {
      pendingOpen = false
      ev.pending(null)
    }
    partialAt = null
    releasePtt()
    scheduleRefresh()
  }

  function releasePtt() {
    pttHeld = false
    if (pttTailTimer) clearTimeout(pttTailTimer)
    pttTailTimer = null
  }

  function onClosed(sock: WebSocket) {
    if (sock !== ws || !running) return
    ws = null
    clearRefresh()
    releasePtt()
    partialAt = null
    setStatus('offline')
    scheduleReconnect()
  }

  function scheduleReconnect() {
    if (!running || reconnectTimer) return
    const delay = BACKOFF_MS[Math.min(backoffIdx, BACKOFF_MS.length - 1)]
    backoffIdx++
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
        setStatus('listening')
      } catch {
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
      scheduleRefresh(Math.max(250, Math.min(2000, HARD_SWAP_MS - age)))
      return
    }
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
    } catch {
      swapping = false
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
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      try {
        await buildGraph(16000)
      } catch {
        await buildGraph(undefined) // browser refused 16 kHz context or a cross-rate mic connection
      }
      await resumeCtx()
      watchMic()
      document.addEventListener('visibilitychange', onVisibility)
      const sock = await openSocket()
      if (!running) {
        sock.close()
        return
      }
      hello(sock)
      adopt(sock)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
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
        releasePtt()
        ev.error('Microphone stopped (unplugged, or permission taken away). Please reconnect it and restart.')
        setStatus('offline')
      }
    }
  }

  function teardown() {
    running = false
    document.removeEventListener('visibilitychange', onVisibility)
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
    send({ type: 'ptt_start' })
  }

  function pttUp() {
    if (!running || !pttHeld) return
    if (pttTailTimer) clearTimeout(pttTailTimer)
    // keep streaming for the tail, then end the turn
    pttTailTimer = setTimeout(() => {
      pttTailTimer = null
      pttHeld = false
      send({ type: 'ptt_end' })
    }, PTT_TAIL_MS)
  }

  function setHandsFree(on: boolean) {
    if (handsFree === on) return
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
    bargeIn() {
      if (!running) return
      send({ type: 'barge' })
      toPlayer({ type: 'stop' }) // silence now, do not wait for the server
      if (status === 'speaking' || status === 'thinking') setStatus('listening')
    },
  }
}
