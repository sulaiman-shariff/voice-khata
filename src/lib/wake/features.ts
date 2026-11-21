// Model-specific glue for public/wakeword/khatabhai.onnx (LiveKit WakeWord, streaming).
// Contract (matches livekit-wakeword client/js/src/model.ts):
//  - 16 kHz mono float32 in [-1, 1] (int16 / 32768), fed in 1280-sample (80 ms) chunks; the
//    model does its own feature extraction.
//  - Stateful: inputs `chunk` [1,1280] + state tensors; every output `<name>_out` is fed back as
//    input `<name>` on the next call. Initial state is zeros (shapes from the model's input
//    metadata), then 25 silent chunks of warm-up; the warmed-up state is what reset() restores.
//  - Read `score` [1]; wake at >= threshold (0.6, below), at most once per 2 s (and the state is reset after a wake).

export const MODEL_CONTRACT = {
  sampleRate: 16000,
  /** Samples consumed per inference step (hop). */
  chunkSamples: 1280,
  /** Audio input name; every other input is a state tensor. */
  chunkInput: 'chunk',
  /** Score output name; every other output is `<state>_out`. */
  scoreOutput: 'score',
  stateOutSuffix: '_out',
  /** State inputs of the shipped model (informational: shapes are read from the model itself). */
  stateInputs: {
    audio: { type: 'float32', shape: [1, 352] },
    sub0: { type: 'float32', shape: [1, 1, 40, 1] },
    sub1: { type: 'float32', shape: [1, 64, 20, 1] },
    sub2: { type: 'float32', shape: [1, 64, 10, 1] },
    k: { type: 'float32', shape: [4, 1, 4, 32, 36] },
    v: { type: 'float32', shape: [4, 1, 4, 32, 36] },
    conv: { type: 'float32', shape: [4, 1, 144, 14] },
    ctx: { type: 'float32', shape: [1, 15, 96] },
    step: { type: 'int64', shape: [1] },
  },
  /** Silent chunks run once after loading (2 s); their end state is the reset state. */
  warmupChunks: 25,
  /** Default detection threshold; callers may override. 0.6: a bare "khata" scored 0.66-0.70 on TTS, positives 0.59-0.86 — false phone wakes are cheap (the server confirms the word), missed ones need a tap. */
  threshold: 0.6,
  /** At most one wake per this much audio. */
  debounceMs: 2000,
}

export interface ModelInput {
  data: Float32Array
  dims: number[]
}

export function toModelInput(chunk: Int16Array): ModelInput {
  const data = new Float32Array(chunk.length)
  for (let i = 0; i < chunk.length; i++) data[i] = chunk[i] / 32768
  return { data, dims: [1, chunk.length] }
}

/** Collects incoming frames (any size) into fixed-size chunks. */
export class Chunker {
  private buf: Int16Array
  private len = 0
  private readonly size: number
  constructor(size: number = MODEL_CONTRACT.chunkSamples) {
    this.size = size
    this.buf = new Int16Array(size)
  }
  push(frame: Int16Array, onChunk: (chunk: Int16Array) => void) {
    let off = 0
    while (off < frame.length) {
      const n = Math.min(this.size - this.len, frame.length - off)
      this.buf.set(frame.subarray(off, off + n), this.len)
      this.len += n
      off += n
      if (this.len === this.size) {
        onChunk(this.buf.slice())
        this.len = 0
      }
    }
  }
  reset() {
    this.len = 0
  }
}
