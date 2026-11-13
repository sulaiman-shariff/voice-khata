/** Real-noise check of the server SNR estimator. Usage: npx tsx eval/snr_check.ts */
import { readFileSync } from 'node:fs'
import { FRAME_SAMPLES, newEnergyState, pushFrame, utteranceSnrDb } from '../server/turn/energy.js'
const meta: { tag: string; noise: string; snr: number }[] = JSON.parse(readFileSync('eval/data/snr/meta.json', 'utf-8'))
const by = new Map<string, number[]>()
for (const m of meta) {
  const b = readFileSync(`eval/data/snr/${m.tag}.pcm`)
  const pcm = new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
  const st = newEnergyState()
  for (let o = 0; o + FRAME_SAMPLES <= pcm.length; o += FRAME_SAMPLES) pushFrame(st, pcm.subarray(o, o + FRAME_SAMPLES))
  const k = `${m.noise}@${m.snr}`
  by.set(k, [...(by.get(k) ?? []), utteranceSnrDb(st) ?? NaN])
}
for (const [k, v] of by) {
  const s = v.filter((x) => !Number.isNaN(x)).sort((a, b) => a - b)
  console.log(k.padEnd(14), 'median est', s[Math.floor(s.length / 2)]?.toFixed(1), 'range', s[0]?.toFixed(1), '..', s.at(-1)?.toFixed(1), `n=${v.length} missing=${v.length - s.length}`)
}
