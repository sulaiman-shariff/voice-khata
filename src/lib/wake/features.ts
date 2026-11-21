// Model-specific glue, isolated so the model task only edits this file.
// PLACEHOLDER contract: raw 16 kHz audio in 80 ms (1280-sample) chunks, float32 in [-1, 1],
// shape [1, chunkSamples], one score out. If the trained model needs mel/embedding features,
// implement them in toModelInput() and update MODEL_CONTRACT.

export const MODEL_CONTRACT = {
  sampleRate: 16000,
  /** Samples consumed per inference step (hop). */
  chunkSamples: 1280,
  /** null = use the model's first input / first output. */
  inputName: null as string | null,
  outputName: null as string | null,
  /** Default detection threshold; callers may override. */
  threshold: 0.5,
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
