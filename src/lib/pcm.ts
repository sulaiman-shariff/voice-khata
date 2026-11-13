/**
 * Pure PCM helpers. The same logic is duplicated (kept identical) in public/worklets/mic.js,
 * because AudioWorklet modules cannot import from the app bundle. Edit both together.
 */

export const TARGET_RATE = 16000
export const FRAME_SAMPLES = 512

export interface ResampleState {
  /** Read position in the next block's input samples; may be in [-1, 0) meaning between prev and block[0]. */
  pos: number
  /** Last input sample of the previous block. */
  prev: number
}

export function createResampleState(): ResampleState {
  return { pos: 0, prev: 0 }
}

/** Linear-interpolation resample to 16 kHz, keeping fractional phase across blocks via `state`. */
export function resampleTo16k(input: Float32Array, inRate: number, state: ResampleState): Float32Array {
  if (inRate === TARGET_RATE) return input
  const n = input.length
  if (n === 0) return new Float32Array(0)
  const ratio = inRate / TARGET_RATE
  const out = new Float32Array(Math.max(0, Math.ceil((n - state.pos) / ratio) + 1))
  let o = 0
  let pos = state.pos
  while (pos < n - 1) {
    const idx = Math.floor(pos)
    const frac = pos - idx
    const a = idx < 0 ? state.prev : input[idx]
    const b = input[idx + 1]
    out[o++] = a + (b - a) * frac
    pos += ratio
  }
  state.pos = pos - n
  state.prev = input[n - 1]
  return o === out.length ? out : out.subarray(0, o)
}

export function floatToInt16(input: Float32Array, out?: Int16Array): Int16Array {
  const res = out ?? new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    let s = input[i]
    if (s > 1) s = 1
    else if (s < -1) s = -1
    res[i] = Math.round(s < 0 ? s * 32768 : s * 32767)
  }
  return res
}

/** Accumulates Int16 samples and emits exact `frameSize`-sample frames (fresh arrays), carrying the remainder. */
export function frameSplitter(onFrame: (frame: Int16Array) => void, frameSize = FRAME_SAMPLES) {
  let buf = new Int16Array(frameSize)
  let fill = 0
  return {
    push(samples: Int16Array) {
      let i = 0
      while (i < samples.length) {
        const take = Math.min(frameSize - fill, samples.length - i)
        buf.set(samples.subarray(i, i + take), fill)
        fill += take
        i += take
        if (fill === frameSize) {
          const frame = buf
          buf = new Int16Array(frameSize)
          fill = 0
          onFrame(frame)
        }
      }
    },
    get pending() {
      return fill
    },
  }
}

/** RMS level of an Int16 frame, 0..1. */
export function rmsInt16(frame: Int16Array): number {
  if (frame.length === 0) return 0
  let sum = 0
  for (let i = 0; i < frame.length; i++) {
    const v = frame[i] / 32768
    sum += v * v
  }
  return Math.min(1, Math.sqrt(sum / frame.length))
}
