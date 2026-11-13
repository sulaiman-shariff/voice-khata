import { describe, expect, it } from 'vitest'
import { FRAME_MS, FRAME_SAMPLES, newEnergyState, pushFrame, utteranceSnrDb } from './energy.js'

// deterministic PRNG so tests are stable
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 32
  }
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r())

/** Noise at `noiseRms`, plus syllable-like bursts (modulated harmonic tone) at a target SNR. */
function scene(seconds: number, noiseRms: number, snrDb: number | null, speechFrom: number, speechTo: number) {
  const r = rng(7)
  const n = Math.round(seconds * 16000)
  const x = new Float64Array(n)
  const speechRms = snrDb === null ? 0 : noiseRms * 10 ** (snrDb / 20)
  for (let i = 0; i < n; i++) {
    const t = i / 16000
    let v = noiseRms * gauss(r)
    if (t >= speechFrom && t < speechTo) {
      const env = 0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t) // 4 Hz syllable rhythm
      const tone = Math.sin(2 * Math.PI * 180 * t) + 0.5 * Math.sin(2 * Math.PI * 360 * t)
      v += speechRms * (env / 0.62) * (tone / 0.79)
    }
    x[i] = v
  }
  return x
}

function run(x: Float64Array) {
  const st = newEnergyState()
  const frames: boolean[] = []
  for (let off = 0; off + FRAME_SAMPLES <= x.length; off += FRAME_SAMPLES) {
    const f = new Int16Array(FRAME_SAMPLES)
    for (let i = 0; i < FRAME_SAMPLES; i++) f[i] = Math.max(-32768, Math.min(32767, Math.round(x[off + i] * 32768)))
    frames.push(pushFrame(st, f))
  }
  return { st, frames }
}

describe('energy tracker', () => {
  it.each([20, 10, 5])('estimates utterance SNR at %i dB within 3 dB', (snr) => {
    const { st } = run(scene(4, 0.01, snr, 1.0, 3.0))
    expect(Math.abs(utteranceSnrDb(st)! - snr)).toBeLessThan(3)
  })

  it('steady loud noise alone is not speech once the floor adapts', () => {
    const { frames } = run(scene(4, 0.05, null, 0, 0))
    const lateSpeech = frames.slice(Math.round(1000 / FRAME_MS)).filter(Boolean).length
    expect(lateSpeech).toBe(0)
  })

  it('reports silence after the speech stops', () => {
    const { st } = run(scene(3.5, 0.005, 15, 1.0, 3.0))
    expect(st.inUtterance).toBe(true)
    expect(st.silentMs).toBeGreaterThanOrEqual(400)
    expect(st.silentMs).toBeLessThanOrEqual(560)
  })

  it('detects speech start within 100 ms', () => {
    const { frames } = run(scene(3, 0.005, 10, 1.0, 2.5))
    const first = frames.indexOf(true) * FRAME_MS
    expect(first).toBeGreaterThanOrEqual(900)
    expect(first).toBeLessThan(1100)
  })
})
