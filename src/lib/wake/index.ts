// On-phone wake detector. Inference runs in a worker (worker.ts, onnxruntime-web WASM,
// single thread). Returns null when the model or WASM can't load, so the caller falls
// back to server-side wake-word spotting.

export interface WakeWorkerLike {
  postMessage(msg: unknown, transfer?: Transferable[]): void
  terminate(): void
  onmessage: ((e: MessageEvent) => void) | null
  onerror: ((e: ErrorEvent) => void) | null
}

export interface WakeDetector {
  feed(frame: ArrayBuffer): void
  pause(): void
  resume(): void
  onWake(cb: () => void): void
  /** Fires once if the worker fails after loading; the detector is then disposed. */
  onFail(cb: () => void): void
  dispose(): void
}

export interface WakeOptions {
  threshold: number
  modelUrl?: string
  createWorker?: () => WakeWorkerLike
  readyTimeoutMs?: number
}

export const WAKE_MODEL_URL = '/wakeword/khatabhai.onnx'
const REFRACTORY_MS = 2000

function defaultWorker(): WakeWorkerLike {
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
}

export async function createWakeDetector(opts: WakeOptions): Promise<WakeDetector | null> {
  let worker: WakeWorkerLike
  try {
    worker = (opts.createWorker ?? defaultWorker)()
  } catch {
    return null
  }

  const ready = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), opts.readyTimeoutMs ?? 15000)
    const done = (ok: boolean) => {
      clearTimeout(timer)
      resolve(ok)
    }
    worker.onmessage = (e) => {
      const t = (e.data as { type?: string } | null)?.type
      if (t === 'ready') done(true)
      else if (t === 'error') done(false)
    }
    worker.onerror = () => done(false)
    worker.postMessage({ type: 'init', modelUrl: opts.modelUrl ?? WAKE_MODEL_URL, threshold: opts.threshold })
  })
  if (!ready) {
    worker.terminate()
    return null
  }

  let paused = false
  let disposed = false
  let cb: (() => void) | null = null
  let lastWake = -Infinity

  let failCb: (() => void) | null = null
  const fail = () => {
    if (disposed) return
    disposed = true
    worker.terminate()
    failCb?.()
  }
  worker.onerror = fail
  worker.onmessage = (e) => {
    const type = (e.data as { type?: string } | null)?.type
    if (type === 'error') return fail()
    if (type !== 'wake' || disposed || paused) return
    const now = Date.now()
    if (now - lastWake < REFRACTORY_MS) return
    lastWake = now
    cb?.()
  }

  return {
    feed(frame) {
      if (paused || disposed) return
      // Copy: the caller keeps its frame (pre-roll buffer); the copy is transferred.
      const buf = frame.slice(0)
      worker.postMessage({ type: 'frame', buf }, [buf])
    },
    pause() {
      paused = true
    },
    resume() {
      if (paused && !disposed) worker.postMessage({ type: 'reset' }) // drop stale partial chunk
      paused = false
    },
    onWake(fn) {
      cb = fn
    },
    onFail(fn) {
      failCb = fn
    },
    dispose() {
      disposed = true
      worker.terminate()
    },
  }
}
