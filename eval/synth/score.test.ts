import { describe, expect, it } from 'vitest'
import { scoreScene } from './score.js'
import type { Scene } from './scenes.js'

const scene: Scene = {
  id: 't',
  lines: [
    { text: 'chatter', lang: 'en-IN', addressed: false },
    { text: 'KhataBhai add 100 for Ramesh', lang: 'en-IN', addressed: true,
      expect: [{ name: 'add_entries', args: { entries: [{ name: 'Ramesh', amount: 100, direction: 'credit' }] } }] },
  ],
}
const entry = (amount: number) => ({ name: 'add_entries', args: { entries: [{ name: 'Ramesh', amount, direction: 'credit' }] } })

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

import { assignToLines } from './score.js'

describe('assignToLines', () => {
  const lines = [{ startMs: 1000, endMs: 3000 }, { startMs: 4000, endMs: 6000 }]
  it('maps an event to the line that ended most recently, within the tail', () => {
    expect(assignToLines(lines, 3500, 3000)).toBe(0) // a final lands after its line ended, even once the next began
    expect(assignToLines(lines, 4200, 3000)).toBe(0)
    expect(assignToLines(lines, 6400, 3000)).toBe(1)
  })
  it('drops events before any line ended or past the tail', () => {
    expect(assignToLines(lines, 2500, 3000)).toBe(-1)
    expect(assignToLines(lines, 12000, 3000)).toBe(-1)
  })
})
