/**
 * A bad network between a voice client and the voice server: a local WebSocket proxy that can add
 * latency and jitter, stall the uplink (client -> server frames silently dropped), blackhole the
 * downlink, or kill a connection outright. Used by eval/net_chaos.ts.
 */
import { WebSocket, WebSocketServer } from 'ws'

export interface Link {
  /** ms added to every message in each direction, plus up to `jitter` random ms */
  latency: number
  jitter: number
  /** client -> server messages are silently dropped (a stalled uplink) */
  stallUp: boolean
  /** server -> client messages are silently dropped */
  stallDown: boolean
  /** every server -> client JSON message, before delivery: return 'drop' to swallow it */
  onDown?: (msg: { type?: string }) => void | 'drop'
}

export interface Proxy {
  url: string
  link: Link
  /** kill every open connection (both sides see an abnormal close) */
  killAll(): void
  open(): number
  close(): Promise<void>
}

export function startProxy(port: number, upstream: string): Promise<Proxy> {
  const link: Link = { latency: 0, jitter: 0, stallUp: false, stallDown: false }
  const pairs = new Set<{ client: WebSocket; server: WebSocket }>()
  const wss = new WebSocketServer({ port })
  const delay = () => link.latency + Math.random() * link.jitter
  // per-direction FIFO so jitter never reorders frames (TCP does not either)
  const lane = () => {
    let last = 0
    return (fn: () => void) => {
      const at = Math.max(Date.now() + delay(), last)
      last = at
      setTimeout(fn, Math.max(0, at - Date.now()))
    }
  }
  wss.on('connection', (client) => {
    const server = new WebSocket(upstream)
    const pair = { client, server }
    pairs.add(pair)
    const up = lane()
    const down = lane()
    const pendingUp: [Buffer, boolean][] = []
    server.on('open', () => {
      for (const [d, bin] of pendingUp) server.send(d, { binary: bin })
      pendingUp.length = 0
    })
    client.on('message', (d: Buffer, bin) => {
      if (link.stallUp) return
      up(() => {
        if (server.readyState === WebSocket.OPEN) server.send(d, { binary: bin })
        else if (server.readyState === WebSocket.CONNECTING) pendingUp.push([d, bin])
      })
    })
    server.on('message', (d: Buffer, bin) => {
      if (link.stallDown) return
      if (!bin && link.onDown) {
        try {
          if (link.onDown(JSON.parse(d.toString())) === 'drop') return
        } catch { /* not json */ }
      }
      down(() => client.readyState === WebSocket.OPEN && client.send(d, { binary: bin }))
    })
    const end = () => {
      pairs.delete(pair)
      client.terminate()
      server.terminate()
    }
    client.on('close', end)
    server.on('close', end)
    client.on('error', end)
    server.on('error', end)
  })
  return new Promise((resolve) => wss.on('listening', () => resolve({
    url: `ws://localhost:${port}`,
    link,
    killAll() {
      for (const p of [...pairs]) {
        pairs.delete(p)
        p.client.terminate()
        p.server.terminate()
      }
    },
    open: () => pairs.size,
    close: () => new Promise<void>((r) => wss.close(() => r())),
  })))
}
