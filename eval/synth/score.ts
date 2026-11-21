/**
 * Scoring for the synthetic counter sessions.
 * Part 1: the pure scoring function. Part 2 (playback through a Session) is runScenes().
 */
import type { Scene, ToolCall } from './scenes.js'

/** What the system did for one line: did it wake, and which tool calls did it make. */
export type LineResult = { woke: boolean; calls: ToolCall[] }

export type SceneScore = {
  sceneId: string
  falseWakes: number
  falseWakesPerHour: number
  missedWakes: number
  unaddressedEntries: number
  wrong: number
  addressed: number
}

type Entry = { name?: unknown; amount?: unknown; direction?: unknown }
const entriesOf = (c: ToolCall): Entry[] =>
  c.name === 'add_entries' && Array.isArray(c.args.entries) ? (c.args.entries as Entry[]) : []

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase()

/** Same tool; for add_entries same name/amount/direction set; for others same name arg. */
export function callMatches(got: ToolCall, want: ToolCall): boolean {
  if (got.name !== want.name) return false
  if (want.name === 'add_entries') {
    const key = (e: Entry) => `${norm(e.name)}|${Number(e.amount)}|${norm(e.direction)}`
    const a = entriesOf(got).map(key).sort()
    const b = entriesOf(want).map(key).sort()
    return a.length === b.length && a.every((k, i) => k === b[i])
  }
  if ('name' in want.args) return norm(got.args.name) === norm(want.args.name)
  return true
}

export function scoreScene(scene: Scene, results: LineResult[], durationMs: number): SceneScore {
  let falseWakes = 0
  let missedWakes = 0
  let unaddressedEntries = 0
  let wrong = 0
  let addressed = 0
  scene.lines.forEach((line, i) => {
    const r = results[i] ?? { woke: false, calls: [] }
    if (!line.addressed) {
      if (r.woke) falseWakes++
      unaddressedEntries += r.calls.reduce((n, c) => n + entriesOf(c).length, 0)
      return
    }
    addressed++
    if (!r.woke) {
      missedWakes++
      return
    }
    const want = line.expect ?? []
    const ok = want.length === r.calls.length && want.every((w, j) => callMatches(r.calls[j]!, w))
    if (!ok) wrong++
  })
  return {
    sceneId: scene.id,
    falseWakes,
    falseWakesPerHour: durationMs > 0 ? falseWakes / (durationMs / 3_600_000) : 0,
    missedWakes,
    unaddressedEntries,
    wrong,
    addressed,
  }
}

export function sumScores(scores: SceneScore[], totalMs: number) {
  const t = { falseWakes: 0, missedWakes: 0, unaddressedEntries: 0, wrong: 0, addressed: 0 }
  for (const s of scores) for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += s[k]
  return { ...t, falseWakesPerHour: totalMs > 0 ? t.falseWakes / (totalMs / 3_600_000) : 0 }
}

/** Part 2: play eval/data/synth/*.pcm into a local Session like the phone does. Not yet wired. */
export async function runScenes(): Promise<never> {
  throw new Error('not yet wired (Task 12 part 2)')
}
