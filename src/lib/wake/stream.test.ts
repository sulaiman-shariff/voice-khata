import { describe, expect, it } from 'vitest'
import { WakeStream, type InputMetaLike, type MakeTensor, type SessionLike, type TensorLike } from './stream'

const makeTensor: MakeTensor = (_type, data, dims) => ({ data, dims })

/**
 * Fake streaming model: state `acc` [1] accumulates the chunk's first sample, `step` (int64)
 * counts calls; score = acc. Records every feed so the test can check the feedback.
 */
class FakeSession implements SessionLike {
  readonly inputMetadata: InputMetaLike[] = [
    { name: 'chunk', isTensor: true, type: 'float32', shape: [1, 1280] },
    { name: 'acc', isTensor: true, type: 'float32', shape: [1] },
    { name: 'step', isTensor: true, type: 'int64', shape: [1] },
  ]
  readonly outputNames = ['score', 'acc_out', 'step_out']
  feeds: Record<string, TensorLike>[] = []
  hold: Promise<void> | null = null
  async run(feeds: Record<string, TensorLike>) {
    this.feeds.push(feeds)
    if (this.hold) await this.hold
    const acc = (feeds.acc.data as Float32Array)[0] + (feeds.chunk.data as Float32Array)[0]
    const step = (feeds.step.data as BigInt64Array)[0] + 1n
    return {
      score: { data: new Float32Array([acc]), dims: [1] },
      acc_out: { data: new Float32Array([acc]), dims: [1] },
      step_out: { data: new BigInt64Array([step]), dims: [1] },
    }
  }
}

const chunk = (v: number) => new Float32Array(1280).fill(v)
const stepOf = (f: Record<string, TensorLike>) => (f.step.data as BigInt64Array)[0]

describe('WakeStream', () => {
  it('starts from zero state of the right types, warms up on silence, feeds outputs back', async () => {
    const s = new FakeSession()
    const w = await WakeStream.open(s, makeTensor, { warmupChunks: 25 })
    expect(s.feeds).toHaveLength(25)
    expect(s.feeds[0].acc.data).toBeInstanceOf(Float32Array)
    expect(s.feeds[0].step.data).toBeInstanceOf(BigInt64Array)
    expect(stepOf(s.feeds[0])).toBe(0n)
    expect(s.feeds[0].chunk.dims).toEqual([1, 1280])
    expect(stepOf(s.feeds[24])).toBe(24n) // each step_out came back as step
    expect(await w.score(chunk(0.1))).toBeCloseTo(0.1)
    expect(await w.score(chunk(0.1))).toBeCloseTo(0.2)
    expect(stepOf(s.feeds[26])).toBe(26n)
  })

  it('wakes at the threshold, then resets state and debounces for 2 s of audio', async () => {
    const s = new FakeSession()
    const w = await WakeStream.open(s, makeTensor, { threshold: 0.5, warmupChunks: 2 })
    expect((await w.step(chunk(0.3))).wake).toBe(false)
    const hit = await w.step(chunk(0.3))
    expect(hit.wake).toBe(true)
    expect(hit.score).toBeCloseTo(0.6)
    // state went back to the warm state (step counter = warm-up count)
    await w.step(chunk(0))
    expect(stepOf(s.feeds.at(-1)!)).toBe(2n)
    // above threshold again within 2 s (25 chunks of 80 ms): no second wake
    let wakes = 0
    for (let i = 0; i < 23; i++) if ((await w.step(chunk(0.6))).wake) wakes++
    expect(wakes).toBe(0)
    expect((await w.step(chunk(0.6))).wake).toBe(true) // 25 chunks after the first
  })

  it('reset restores the warm state, clears the debounce and drops a step in flight', async () => {
    const s = new FakeSession()
    const w = await WakeStream.open(s, makeTensor, { threshold: 0.5, warmupChunks: 3 })
    expect((await w.step(chunk(0.6))).wake).toBe(true)
    w.reset()
    expect((await w.step(chunk(0.6))).wake).toBe(true) // no debounce after a reset
    expect(stepOf(s.feeds.at(-1)!)).toBe(3n)

    let release!: () => void
    s.hold = new Promise((r) => (release = r))
    const inflight = w.step(chunk(0.4))
    w.reset()
    s.hold = null
    release()
    expect(await inflight).toEqual({ score: 0, wake: false })
    await w.score(chunk(0))
    expect(stepOf(s.feeds.at(-1)!)).toBe(3n) // the stale step did not write its state
  })

  it('rejects a model without the streaming contract', async () => {
    const s = new FakeSession()
    ;(s as { outputNames: string[] }).outputNames = ['score', 'acc_out']
    await expect(WakeStream.open(s, makeTensor)).rejects.toThrow(/step_out/)
  })
})
