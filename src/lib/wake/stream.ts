// Per-chunk wake-word inference, independent of onnxruntime's package flavour (web/node) so the
// worker and the Node eval (eval/wake_detector.ts) run exactly the same code.
import { MODEL_CONTRACT } from './features.js'

export type StateType = 'float32' | 'int64'

export interface TensorLike {
  readonly data: unknown
  readonly dims: readonly number[]
}

export interface InputMetaLike {
  readonly name: string
  readonly isTensor: boolean
  readonly type?: string
  readonly shape?: readonly (number | string)[]
}

/** The parts of an onnxruntime InferenceSession used here. */
export interface SessionLike {
  readonly inputMetadata: readonly InputMetaLike[]
  readonly outputNames: readonly string[]
  run(feeds: Record<string, TensorLike>): Promise<Record<string, TensorLike>>
}

export type MakeTensor = (type: StateType, data: Float32Array | BigInt64Array, dims: number[]) => TensorLike

export interface StreamOptions {
  threshold?: number
  warmupChunks?: number
  debounceMs?: number
}

export interface StepResult {
  score: number
  wake: boolean
}

const CHUNK_MS = (MODEL_CONTRACT.chunkSamples / MODEL_CONTRACT.sampleRate) * 1000

/**
 * One stateful stream over a LiveKit WakeWord model: zero state from the input metadata, 25
 * silent warm-up chunks, each `<x>_out` fed back as `<x>`, threshold + debounce counted in audio
 * time. After a wake the state goes back to the warmed-up one (as the reference listener does).
 */
export class WakeStream {
  readonly threshold: number
  private readonly session: SessionLike
  private readonly makeTensor: MakeTensor
  private readonly chunkSamples: number
  private readonly debounceChunks: number
  private readonly stateOut: string[]
  private state: Record<string, TensorLike>
  private warm: Record<string, TensorLike>
  /** Bumped by reset(): a step in flight when it happens must not write its state back. */
  private gen = 0
  private chunkIndex = 0
  private lastWake = -Infinity

  private constructor(session: SessionLike, makeTensor: MakeTensor, opts: StreamOptions) {
    this.session = session
    this.makeTensor = makeTensor
    this.threshold = opts.threshold ?? MODEL_CONTRACT.threshold
    this.debounceChunks = Math.ceil((opts.debounceMs ?? MODEL_CONTRACT.debounceMs) / CHUNK_MS)
    this.chunkSamples = MODEL_CONTRACT.chunkSamples

    const { chunkInput, scoreOutput, stateOutSuffix } = MODEL_CONTRACT
    const inputs = session.inputMetadata
    const chunk = inputs.find((i) => i.name === chunkInput)
    if (!chunk) throw new Error(`model has no '${chunkInput}' input (not a streaming wake word model)`)
    if (!session.outputNames.includes(scoreOutput)) throw new Error(`model has no '${scoreOutput}' output`)

    const state: Record<string, TensorLike> = {}
    for (const input of inputs) {
      if (input.name === chunkInput) continue
      const shape = input.shape ?? []
      if (!input.isTensor || !shape.every((d) => typeof d === 'number' && d > 0)) {
        throw new Error(`state input '${input.name}' needs a fixed shape`)
      }
      if (!session.outputNames.includes(input.name + stateOutSuffix)) {
        throw new Error(`state input '${input.name}' has no '${input.name}${stateOutSuffix}' output`)
      }
      const dims = shape as number[]
      const size = dims.reduce((a, b) => a * b, 1)
      state[input.name] =
        input.type === 'int64'
          ? makeTensor('int64', new BigInt64Array(size), dims)
          : makeTensor('float32', new Float32Array(size), dims)
    }
    this.state = state
    this.warm = state
    this.stateOut = Object.keys(state).map((n) => n + stateOutSuffix)
  }

  static async open(session: SessionLike, makeTensor: MakeTensor, opts: StreamOptions = {}): Promise<WakeStream> {
    const s = new WakeStream(session, makeTensor, opts)
    const silence = new Float32Array(s.chunkSamples)
    for (let i = 0; i < (opts.warmupChunks ?? MODEL_CONTRACT.warmupChunks); i++) await s.score(silence)
    s.warm = s.state
    s.chunkIndex = 0
    return s
  }

  /** Runs one chunk through the model, feeds the state back; resolves to the raw score. */
  async score(chunk: Float32Array): Promise<number> {
    if (chunk.length !== this.chunkSamples) throw new Error(`chunk must be ${this.chunkSamples} samples`)
    const gen = this.gen
    const out = await this.session.run({
      ...this.state,
      [MODEL_CONTRACT.chunkInput]: this.makeTensor('float32', chunk, [1, this.chunkSamples]),
    })
    const score = Number((out[MODEL_CONTRACT.scoreOutput].data as Float32Array)[0])
    if (gen !== this.gen) return 0 // reset() ran meanwhile: this chunk belongs to stale audio
    const next: Record<string, TensorLike> = {}
    for (const name of this.stateOut) {
      const t = out[name]
      if (!t) throw new Error(`model output '${name}' missing`)
      next[name.slice(0, -MODEL_CONTRACT.stateOutSuffix.length)] = t
    }
    this.state = next
    return score
  }

  /** score() plus the threshold/debounce gate. */
  async step(chunk: Float32Array): Promise<StepResult> {
    const gen = this.gen
    const score = await this.score(chunk)
    if (gen !== this.gen) return { score: 0, wake: false }
    const i = this.chunkIndex++
    if (score < this.threshold || i - this.lastWake < this.debounceChunks) return { score, wake: false }
    this.lastWake = i
    this.state = this.warm // forget the wake word itself so it cannot fire twice
    return { score, wake: true }
  }

  /** Back to the warmed-up state (on resume: the audio in between was never heard). */
  reset() {
    this.gen++
    this.state = this.warm
    this.chunkIndex = 0
    this.lastWake = -Infinity
  }
}
