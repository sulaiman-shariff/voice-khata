import { describe, expect, it } from 'vitest'
import { alignFinal, scoreScene, textSim } from './score.js'
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

  it('counts an asked-back entry with the right name and amount separately from wrong', () => {
    const r = scoreScene(scene, [{ woke: false, calls: [] }, { woke: true, calls: [], asked: true }], 60_000)
    expect(r).toMatchObject({ askedCorrect: 1, wrong: 0, writtenCorrect: 0 })
  })

  it('keeps proposals apart from ledger writes for un-addressed lines', () => {
    const r = scoreScene(scene, [{ woke: true, calls: [], proposed: [entry(100)] }, { woke: true, calls: [entry(100)] }], 60_000)
    expect(r).toMatchObject({ unaddressedEntries: 0, proposedUnaddressed: 1 })
  })
})

describe('alignFinal', () => {
  const lines = [
    { text: 'चीनी चालीस रुपये किलो है', startMs: 1000, endMs: 3000 },
    { text: 'खाताभाई, रमेश के खाते में तीन सौ रुपये उधार लिखो', startMs: 4000, endMs: 7000 },
    { text: 'ठीक है भैया कल पैसे दे दूँगा', startMs: 8000, endMs: 10000 },
  ]
  it('matches text across scripts', () => {
    expect(textSim('Ramesh ke khate mein teen sau rupaye udhaar likho', lines[1]!.text)).toBeGreaterThan(0.4)
  })
  it('assigns by order and text even when the final lands after the next line began', () => {
    expect(alignFinal(lines, -1, 4300, 'chinee 40 rupaye kilo hai')).toBe(0)
    expect(alignFinal(lines, 0, 8200, 'Katha bhai Ramesh ke khate mein 300 rupaye udhaar likho')).toBe(1)
  })
  it('never goes back to an earlier line', () => {
    expect(alignFinal(lines, 1, 10500, 'thik hai bhaiya kal paise de dunga')).toBe(2)
  })
})
