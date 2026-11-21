/// <reference lib="webworker" />
// Wake-word inference worker: onnxruntime-web WASM backend, single thread.
// In:  { type:'init', modelUrl, threshold } | { type:'frame', buf: ArrayBuffer (Int16 PCM) } | { type:'reset' }
// Out: { type:'ready' } | { type:'error', message } | { type:'wake', score }
// The per-chunk inference (state feedback, warm-up, threshold, debounce) lives in stream.ts.
import * as ort from 'onnxruntime-web/wasm'
import { Chunker, MODEL_CONTRACT, toModelInput } from './features'
import { WakeStream, dropBacklog, type MakeTensor, type SessionLike } from './stream'

ort.env.wasm.numThreads = 1
ort.env.wasm.proxy = false

let stream: WakeStream | null = null
let busy = false
const chunker = new Chunker()
const queue: Int16Array[] = []

const makeTensor: MakeTensor = (type, data, dims) =>
  type === 'int64' ? new ort.Tensor('int64', data as BigInt64Array, dims) : new ort.Tensor('float32', data as Float32Array, dims)

async function init(modelUrl: string, thr: number) {
  try {
    const res = await fetch(modelUrl)
    const type = res.headers.get('content-type') ?? ''
    // Vite's dev/preview server answers a missing file with index.html (200).
    if (!res.ok || type.includes('text/html')) throw new Error(`model not available (${res.status})`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] })
    stream = await WakeStream.open(session as unknown as SessionLike, makeTensor, { threshold: thr })
    postMessage({ type: 'ready' })
  } catch (e) {
    postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}

async function drain() {
  if (busy || !stream) return
  busy = true
  try {
    while (queue.length) {
      // If inference falls behind, keep only the newest chunks; the state no longer matches the
      // audio (a gap), so start again from the warmed-up state
      if (dropBacklog(queue, 8)) stream.reset()
      const { data } = toModelInput(queue.shift()!)
      const { score, wake } = await stream.step(data)
      if (wake) postMessage({ type: 'wake', score })
    }
  } catch (e) {
    postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) })
  } finally {
    busy = false
  }
}

self.onmessage = (e: MessageEvent) => {
  const m = e.data as { type: string; modelUrl?: string; threshold?: number; buf?: ArrayBuffer }
  if (m.type === 'init') void init(m.modelUrl!, m.threshold ?? MODEL_CONTRACT.threshold)
  else if (m.type === 'reset') {
    chunker.reset()
    queue.length = 0
    stream?.reset()
  } else if (m.type === 'frame' && m.buf) {
    chunker.push(new Int16Array(m.buf), (c) => queue.push(c))
    void drain()
  }
}
