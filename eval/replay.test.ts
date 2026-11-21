/**
 * The 28 real conversations from the production logs (eval/corpus/prod.json, hand-labelled),
 * replayed through the Session by eval/replay.ts and scored there. CI holds the line on the two
 * outcomes a shopkeeper can never be shown: an entry they did not mean, and an account opened
 * under a name that is not a customer. Missed entries may only go down.
 */
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const MISSED_NOW = 2 // 9l8xtcf6: "ಮಾಹಿ ಹೆಸರಿಂದ" / "ಸುಲೇಮಾನ್" said alone, then "300 ಬರೀ": a new name is read back even on a tap, and the log has no yes for it

describe('production conversations replayed', () => {
  it('write 0 wrong entries and open 0 junk accounts', () => {
    const report = execFileSync(process.execPath, ['--import', 'tsx', 'eval/replay.ts', 'eval/corpus/prod.json'], { encoding: 'utf8', timeout: 60_000 })
    const m = report.match(/wrong (\d+) \| junk accounts (\d+) \| missed (\d+)/)
    expect(m, report).not.toBeNull()
    const [wrong, junk, missed] = m!.slice(1).map(Number)
    expect({ wrong, junk }, report).toEqual({ wrong: 0, junk: 0 })
    expect(missed, report).toBeLessThanOrEqual(MISSED_NOW)
  }, 60_000)
})
