/**
 * Replays every real Prisma transcript from the noise runs through the fast-path parser and
 * counts outcomes. The number that matters is "silent wrong": a wrong amount the agent would
 * have saved with high confidence and no question asked.
 *
 * Usage: npx tsx eval/fastpath_on_noise.ts
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseFast } from '../shared/intent.js'

interface Row { id: string; noise: string; snr: number | null; expected: number[]; text: string }

const dir = join(import.meta.dirname, 'results')
const rows: Row[] = readdirSync(dir)
  .filter((f) => f.startsWith('noise_') && f.endsWith('.json'))
  .flatMap((f) => JSON.parse(readFileSync(join(dir, f), 'utf-8')) as Row[])

const tally = { savedRight: 0, silentWrong: 0, askedRight: 0, askedWrong: 0, ignored: 0 }
const silent: string[] = []
for (const r of rows) {
  const intent = parseFast(r.text)
  if (intent.type !== 'entries' || !intent.entries.length) {
    tally.ignored++
    continue
  }
  const e = intent.entries[0]
  const right = r.expected.includes(e.amount.value)
  if (e.confidence === 'high') {
    if (right) tally.savedRight++
    else {
      tally.silentWrong++
      silent.push(`${r.noise}@${r.snr} expected ${r.expected} saved ${e.amount.value}: ${r.text}`)
    }
  } else if (right) tally.askedRight++
  else tally.askedWrong++
}
console.log(`${rows.length} real transcripts`)
console.log(tally)
console.log('silent wrong saves:\n ' + (silent.join('\n ') || '(none)'))
