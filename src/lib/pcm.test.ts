/**
 * Mic audio to 16 kHz s16le: the recogniser hears the right pitch, with no drift or dropped samples.
 */
import { describe, expect, it } from 'vitest'
import { createResampleState, floatToInt16, frameSplitter, resampleTo16k } from './pcm'

const sine = (freq: number, rate: number, n: number, offset = 0) =>
  Float32Array.from({ length: n }, (_, i) => 0.8 * Math.sin((2 * Math.PI * freq * (i + offset)) / rate))

describe('resampleTo16k', () => {
  it('48 kHz in 128-sample blocks keeps the frequency and length', () => {
    const st = createResampleState()
    const input = sine(440, 48000, 48000)
    const out: number[] = []
    for (let i = 0; i < input.length; i += 128) out.push(...resampleTo16k(input.subarray(i, i + 128), 48000, st))
    let crossings = 0
    for (let i = 1; i < out.length; i++) if (out[i - 1] < 0 !== out[i] < 0) crossings++
    expect(Math.abs(out.length - 16000)).toBeLessThanOrEqual(2)
    expect(Math.abs(crossings - 880)).toBeLessThanOrEqual(2)
  })

  it('44.1 kHz in odd-sized blocks matches one-shot output and does not drift', () => {
    const input = sine(500, 44100, 50000)
    const whole = resampleTo16k(input, 44100, createResampleState())
    const st = createResampleState()
    const parts: number[] = []
    const sizes = [1, 7, 113, 128, 301, 999, 2, 450]
    for (let i = 0, k = 0; i < input.length; k++) {
      const n = sizes[k % sizes.length]
      parts.push(...resampleTo16k(input.subarray(i, i + n), 44100, st))
      i += n
    }
    expect(Math.abs(parts.length - (input.length * 16000) / 44100)).toBeLessThanOrEqual(2)
    expect(parts.length).toBe(whole.length)
    for (let i = 0; i < whole.length; i += 97) expect(parts[i]).toBeCloseTo(whole[i], 5)
  })
})

it('floatToInt16 clips instead of wrapping around', () => {
  expect(Array.from(floatToInt16(new Float32Array([0, 1, -1, 2, -3, 0.5])))).toEqual([0, 32767, -32768, 32767, -32768, 16384])
})

it('frameSplitter emits exact 512-sample frames and carries the rest, in order', () => {
  const frames: Int16Array[] = []
  const sp = frameSplitter((f) => frames.push(f))
  let next = 0
  for (const n of [100, 500, 1, 600, 311]) sp.push(Int16Array.from({ length: n }, () => next++))
  expect(frames.map((f) => f.length)).toEqual([512, 512])
  expect(frames.flatMap((f) => Array.from(f))).toEqual(Array.from({ length: 1024 }, (_, i) => i))
  expect(sp.pending).toBe(1512 - 1024)
})
