import { describe, expect, it } from 'vitest'
import { scoreScene } from './score.js'
import type { Scene } from './scenes.js'

const scene: Scene = {
  id: 't',
  lines: [
    { text: 'chatter', lang: 'en-IN', addressed: false },
    { text: 'KhataBhai add 100 for Ramesh', lang: 'en-IN', addressed: true,
      expect: [{ name: 'add_entries', args: { entries: [{ name: 'Ramesh', amount: 100, direction: 'gave' }] } }] },
  ],
}
const entry = (amount: number) => ({ name: 'add_entries', args: { entries: [{ name: 'Ramesh', amount, direction: 'gave' }] } })

describe('score', () => {
  it('score counts an entry from an un-addressed line as a failure', () => {
    const r = scoreScene(scene, [
      { woke: true, calls: [entry(100)] },
      { woke: true, calls: [entry(100)] },
    ], 60_000)
    expect(r.unaddressedEntries).toBe(1)
    expect(r.falseWakes).toBe(1)
    expect(r.missedWakes).toBe(0)
    expect(r.wrong).toBe(0)
  })

  it('counts missed wakes and wrong amounts or tools', () => {
    const missed = scoreScene(scene, [{ woke: false, calls: [] }, { woke: false, calls: [] }], 60_000)
    expect(missed.missedWakes).toBe(1)
    const wrongAmt = scoreScene(scene, [{ woke: false, calls: [] }, { woke: true, calls: [entry(10)] }], 60_000)
    expect(wrongAmt.wrong).toBe(1)
    const wrongTool = scoreScene(scene, [{ woke: false, calls: [] }, { woke: true, calls: [{ name: 'settle', args: { name: 'Ramesh' } }] }], 60_000)
    expect(wrongTool.wrong).toBe(1)
    const ok = scoreScene(scene, [{ woke: false, calls: [] }, { woke: true, calls: [entry(100)] }], 60_000)
    expect(ok).toMatchObject({ unaddressedEntries: 0, falseWakes: 0, missedWakes: 0, wrong: 0 })
  })
})
