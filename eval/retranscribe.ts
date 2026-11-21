/**
 * Read recorded local runs again with Prisma REST in several languages, next to what the live
 * session heard and did. Shows whether a miss came from the recogniser (wrong words / wrong
 * language) or from our reading of correct words.
 *
 *   npx tsx --env-file=.env eval/retranscribe.ts [eval/recordings/<session>] [--langs en-IN,hi-IN,kn-IN]
 *
 * With no session given, reads the newest one. Writes retranscribed.jsonl next to turns.jsonl.
 */
import fs from 'node:fs'
import path from 'node:path'
import { transcribeRest } from '../server/gnani/rest.js'

const args = process.argv.slice(2)
const root = 'eval/recordings'
const dir = args.find((a) => !a.startsWith('--')) ?? path.join(root, fs.readdirSync(root).sort().at(-1)!)
const langs = (args.includes('--langs') ? args[args.indexOf('--langs') + 1] : 'en-IN,hi-IN,kn-IN').split(',')
const key = process.env.GNANI_API_KEY ?? ''
if (!key) throw new Error('GNANI_API_KEY missing (run with --env-file=.env)')

const turns = fs.readFileSync(path.join(dir, 'turns.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const out: unknown[] = []
for (const t of turns) {
  if (!t.audio) {
    console.log(`T${t.turn} ${t.src}: "${t.text}" -> ${t.reply ?? '(no reply)'}`)
    continue
  }
  const pcm = fs.readFileSync(path.join(dir, t.audio)).subarray(44)
  const reads: Record<string, string> = {}
  // Prisma REST allows one request at a time per key: read the languages one after another
  for (const l of langs) {
    try {
      reads[l] = (await transcribeRest(key, pcm, l)).text
    } catch (e) {
      reads[l] = `ERROR ${(e as Error).message.slice(0, 80)}`
    }
  }
  console.log(`T${t.turn} live: "${t.text}" (${(pcm.length / 32000).toFixed(1)} s)`)
  for (const l of langs) console.log(`      ${l}: "${reads[l]}"`)
  console.log(`      -> ${t.reply ?? '(no reply)'}${t.ops?.length ? `  [${t.ops.map((o: { op: string }) => o.op).join(', ')}]` : ''}`)
  out.push({ turn: t.turn, live: t.text, reads, reply: t.reply })
}
fs.writeFileSync(path.join(dir, 'retranscribed.jsonl'), out.map((o) => JSON.stringify(o)).join('\n') + '\n')
