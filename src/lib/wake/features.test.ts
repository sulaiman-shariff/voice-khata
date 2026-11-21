import { describe, expect, it } from 'vitest'
import { Chunker, toModelInput } from './features'

describe('Chunker', () => {
  it('buffers 512-sample frames into fixed chunks', () => {
    const c = new Chunker(1280)
    const out: Int16Array[] = []
    for (let i = 0; i < 5; i++) c.push(new Int16Array(512).fill(i + 1), (x) => out.push(x))
    expect(out).toHaveLength(2) // 2560 of 2560 samples
    expect(out[0]).toHaveLength(1280)
    expect(out[0][0]).toBe(1)
    expect(out[0][1279]).toBe(3)
  })
  it('reset drops a partial chunk', () => {
    const c = new Chunker(1280)
    const out: Int16Array[] = []
    c.push(new Int16Array(512), (x) => out.push(x))
    c.reset()
    c.push(new Int16Array(1280), (x) => out.push(x))
    expect(out).toHaveLength(1)
  })
  it('toModelInput normalizes to float', () => {
    const { data, dims } = toModelInput(new Int16Array([16384, -32768]))
    expect(Array.from(data)).toEqual([0.5, -1])
    expect(dims).toEqual([1, 2])
  })
})
