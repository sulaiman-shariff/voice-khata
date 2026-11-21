/// <reference lib="webworker" />
// Wake-word inference worker: onnxruntime-web WASM backend, single thread.
// In:  { type:'init', modelUrl, threshold } | { type:'frame', buf: ArrayBuffer (Int16 PCM) } | { type:'reset' }
// Out: { type:'ready' } | { type:'error', message } | { type:'wake', score }
import * as ort from 'onnxruntime-web/wasm'
import { Chunker, MODEL_CONTRACT, toModelInput } from './features'

ort.env.wasm.numThreads = 1
ort.env.wasm.proxy = false

let session: ort.InferenceSession | null = null
let threshold: number = MODEL_CONTRACT.threshold
let busy = false
const chunker = new Chunker()
const queue: Int16Array[] = []

async function init(modelUrl: string, thr: number) {
  try {
    threshold = thr
    const res = await fetch(modelUrl)
    const type = res.headers.get('content-type') ?? ''
    // Vite's dev/preview server answers a missing file with index.html (200).
    if (!res.ok || type.includes('text/html')) throw new Error(`model not available (${res.status})`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] })
    postMessage({ type: 'ready' })
  } catch (e) {
    postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}

async function drain() {
  if (busy || !session) return
  busy = true
  try {
    while (queue.length) {
      // If inference falls behind, keep only the newest chunks.
      if (queue.length > 8) queue.splice(0, queue.length - 8)
      const { data, dims } = toModelInput(queue.shift()!)
      const name = MODEL_CONTRACT.inputName ?? session.inputNames[0]
      const out = await session.run({ [name]: new ort.Tensor('float32', data, dims) })
      const outName = MODEL_CONTRACT.outputName ?? session.outputNames[0]
      const score = Number((out[outName].data as Float32Array)[0])
      if (score >= threshold) postMessage({ type: 'wake', score })
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
  } else if (m.type === 'frame' && m.buf) {
    chunker.push(new Int16Array(m.buf), (c) => queue.push(c))
    void drain()
  }
}
