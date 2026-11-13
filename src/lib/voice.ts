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

  let pttHeld = false
  let pttTailTimer: ReturnType<typeof setTimeout> | null = null

  let lastLevelAt = 0
  let finalAt: number | null = null
  let playerStartedAt: number | null = null
  let pendingMetrics: TurnMetrics | null = null
  let metricsTimer: ReturnType<typeof setTimeout> | null = null

  const isBusy = () => status === 'speaking' || status === 'thinking'

  function setStatus(s: VoiceStatus) {
    if (status === s) return
    status = s
    ev.status(s)
  }

  function sendTo(sock: WebSocket | null, msg: ClientMsg) {
    if (sock && sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify(msg))
  }
  const send = (msg: ClientMsg) => sendTo(ws, msg)

  function hello(sock: WebSocket) {
    if (!opts) return
    sendTo(sock, { type: 'hello', lang: opts.lang, snapshot: opts.snapshot(), firstRun: opts.firstRun, ptt: !handsFree })
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
    const now = performance.now()
    if (now - lastLevelAt >= LEVEL_INTERVAL_MS) {
      lastLevelAt = now
      ev.level(level)
    }
    if (!ws || ws.readyState !== WebSocket.OPEN || swapping) return // dropped while disconnected
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
    if (sock !== ws) return
    if (e.data instanceof ArrayBuffer) {
      toPlayer({ type: 'pcm', buf: e.data })
      return
    }
    if (typeof e.data !== 'string') return
    let m: ServerMsg
    try {
      m = JSON.parse(e.data) as ServerMsg
    } catch {
      return
    }
    switch (m.type) {
      case 'ready':
        if (status === 'connecting' || status === 'offline') setStatus('listening')
        break
      case 'partial':
        ev.partial(m.text)
        break
      case 'final':
        finalAt = performance.now()
        playerStartedAt = null
        ev.final(m.text)
        setStatus('thinking')
        break
      case 'ops':
        ev.ops(m.ops)
        break
      case 'say':
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
        ev.pending(m.pending)
        break
      case 'show':
        ev.show(m)
        break
      case 'remind':
        ev.remind(m.cid, m.text)
        break
      case 'metrics':
        pendingMetrics = m.turn
        flushMetrics()
        if (pendingMetrics) {
          if (metricsTimer) clearTimeout(metricsTimer)
          metricsTimer = setTimeout(() => flushMetrics(true), METRICS_WAIT_MS)
        }
        break
      case 'error':
        ev.error(m.message)
        if (status === 'thinking') setStatus('listening')
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
    scheduleRefresh()
  }

  function onClosed(sock: WebSocket) {
    if (sock !== ws || !running) return
    ws = null
    clearRefresh()
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

  /** Swap to a fresh socket (Vercel caps functions at 300 s). Only when idle. */
  async function proactiveReconnect() {
    refreshTimer = null
    if (!running || !ws) return
    if (isBusy() || pttHeld) {
      scheduleRefresh(2000)
      return
    }
    try {
      const sock = await openSocket()
      if (!running) {
        sock.close()
        return
      }
      if (isBusy()) {
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
        old.onmessage = null
      }
      adopt(sock)
      swapping = false
      old?.close()
    } catch {
      swapping = false
      scheduleRefresh(5000) // old socket still alive (or its close handler will reconnect)
    }
  }

  // ------------------------------------------------------------ public API
  async function start(o: StartOpts): Promise<void> {
    if (running) return
    opts = o
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
      await ctx?.resume()
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

  function teardown() {
    running = false
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = null
    clearRefresh()
    if (pttTailTimer) clearTimeout(pttTailTimer)
    pttTailTimer = null
    if (metricsTimer) clearTimeout(metricsTimer)
    metricsTimer = null
    pendingMetrics = null
    pttHeld = false
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
      void proactiveReconnect()
    }
  }

  return {
    start,
    stop,
    pttDown,
    pttUp,
    tap: (action) => send({ type: 'tap', action }),
    answer: (text) => send({ type: 'answer', text }),
    sendSnapshot: () => {
      if (opts) send({ type: 'snapshot', snapshot: opts.snapshot() })
    },
    setHandsFree,
  }
}
