import { describe, expect, it } from 'vitest'
import { createResampleState, floatToInt16, frameSplitter, resampleTo16k, rmsInt16 } from './pcm'

function sine(freq: number, rate: number, n: number, offset = 0) {
  const a = new Float32Array(n)
  for (let i = 0; i < n; i++) a[i] = 0.8 * Math.sin((2 * Math.PI * freq * (i + offset)) / rate)
  return a
}
function crossings(a: Float32Array) {
  let c = 0
  for (let i = 1; i < a.length; i++) if (a[i - 1] < 0 !== a[i] < 0) c++
  return c
}

describe('resampleTo16k', () => {
  it('48k -> 16k keeps frequency', () => {
    const st = createResampleState()
    const input = sine(440, 48000, 48000)
    const parts: Float32Array[] = []
    for (let i = 0; i < input.length; i += 128) parts.push(resampleTo16k(input.subarray(i, i + 128), 48000, st))
    const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0))
    let o = 0
    for (const p of parts) {
      out.set(p, o)
      o += p.length
    }
    expect(Math.abs(out.length - 16000)).toBeLessThanOrEqual(2)
    expect(Math.abs(crossings(out) - 880)).toBeLessThanOrEqual(2)
  })

  it('44.1k -> 16k count is right over many odd-size blocks (no drift)', () => {
    const st = createResampleState()
    const sizes = [1, 7, 113, 128, 301, 999, 2, 450]
    let total = 0
    let outTotal = 0
    for (let k = 0; k < 400; k++) {
      const n = sizes[k % sizes.length]
      const block = sine(300, 44100, n, total)
      total += n
      outTotal += resampleTo16k(block, 44100, st).length
    }
    expect(Math.abs(outTotal - (total * 16000) / 44100)).toBeLessThanOrEqual(2)
  })

  it('block-wise output equals one-shot output', () => {
    const input = sine(500, 44100, 5000)
    const whole = resampleTo16k(input, 44100, createResampleState())
    const st = createResampleState()
    const parts: number[] = []
    for (let i = 0; i < input.length; i += 173) parts.push(...resampleTo16k(input.subarray(i, i + 173), 44100, st))
    expect(parts.length).toBe(whole.length)
    for (let i = 0; i < whole.length; i++) expect(parts[i]).toBeCloseTo(whole[i], 5)
  })

  it('passes through at 16k', () => {
    const input = sine(200, 16000, 100)
    expect(resampleTo16k(input, 16000, createResampleState())).toBe(input)
  })
})

describe('floatToInt16', () => {
  it('clips and scales', () => {
    const out = floatToInt16(new Float32Array([0, 1, -1, 2, -3, 0.5]))
    expect(Array.from(out)).toEqual([0, 32767, -32768, 32767, -32768, 16384])
  })
})

describe('frameSplitter', () => {
  it('emits exact 512-sample frames with carry', () => {
    const frames: Int16Array[] = []
    const sp = frameSplitter((f) => frames.push(f))
    let next = 0
    for (const n of [100, 500, 1, 600, 311]) {
      const a = new Int16Array(n)
      for (let i = 0; i < n; i++) a[i] = next++
      sp.push(a)
    }
    expect(next).toBe(1512)
    expect(frames.length).toBe(2)
    expect(sp.pending).toBe(1512 - 1024)
    frames.forEach((f, k) => {
      expect(f.length).toBe(512)
      for (let i = 0; i < 512; i++) expect(f[i]).toBe(k * 512 + i)
    })
  })
})

describe('rmsInt16', () => {
  it('is 0 for silence and 0.5 for half-scale constant', () => {
    expect(rmsInt16(new Int16Array(512))).toBe(0)
    expect(rmsInt16(new Int16Array(512).fill(16384))).toBeCloseTo(0.5, 3)
  })
})
