/**
 * Speech-to-text comparison on recorded turns: Gnani Prisma (REST, per language) vs Sarvam
 * (saaras:v4, language auto-detect). Shows what each heard, what our parser makes of it, and the
 * time per call. Sarvam is for comparison only; nothing in the app uses it.
 *
 *   SARVAM_API_KEY=... npx tsx --env-file=.env eval/stt_compare.ts [eval/recordings/<session>] [--langs en-IN,hi-IN,kn-IN]
 */
import fs from 'node:fs'
import path from 'node:path'
import { parseFast } from '../shared/intent.js'
import { transcribeRest } from '../server/gnani/rest.js'

const args = process.argv.slice(2)
const root = 'eval/recordings'
const dir = args.find((a) => a.startsWith('eval/')) ??
  path.join(root, fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, 'turns.jsonl'))).sort().at(-1)!)
const langs = (args.includes('--langs') ? args[args.indexOf('--langs') + 1] : 'en-IN,hi-IN,kn-IN').split(',')
const gnaniKey = process.env.GNANI_API_KEY ?? ''
const sarvamKey = process.env.SARVAM_API_KEY ?? ''
if (!gnaniKey || !sarvamKey) throw new Error('GNANI_API_KEY and SARVAM_API_KEY are both needed')
const TERMS = ['Ramesh', 'Suresh', 'Mahi', 'credit', 'paid', 'udhaar', 'jama', 'rupees', 'clear', 'khata']

async function sarvam(wav: Buffer): Promise<{ text: string; lang: string | null; ms: number }> {
  const fd = new FormData()
  fd.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'turn.wav')
  fd.append('model', 'saaras:v4')
  fd.append('mode', 'transcribe')
  fd.append('language_code', 'unknown')
  fd.append('keyterms', JSON.stringify(TERMS))
  const t0 = performance.now()
  const r = await fetch('https://api.sarvam.ai/speech-to-text', { method: 'POST', headers: { 'api-subscription-key': sarvamKey }, body: fd, signal: AbortSignal.timeout(20000) })
  const ms = performance.now() - t0
  const j = (await r.json()) as { transcript?: string; language_code?: string | null; error?: unknown }
  if (!r.ok) return { text: `ERROR ${r.status} ${JSON.stringify(j).slice(0, 120)}`, lang: null, ms }
  return { text: j.transcript ?? '', lang: j.language_code ?? null, ms }
}

const read = (t: string) => {
  const i = parseFast(t)
  return i.type === 'entries' ? i.entries.map((e) => `${e.name ?? '?'} ₹${e.amount.value} ${e.direction ?? '?'}`).join('; ') : i.type
}

const turns = fs.readFileSync(path.join(dir, 'turns.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const rows: unknown[] = []
for (const t of turns) {
  if (!t.audio) continue
  const wav = fs.readFileSync(path.join(dir, t.audio))
  const pcm = wav.subarray(44)
  console.log(`\nT${t.turn} (${(pcm.length / 32000).toFixed(1)} s)  live: ${JSON.stringify(t.text)}`)
  const s = await sarvam(wav)
  console.log(`   sarvam [${s.lang ?? '?'}] ${Math.round(s.ms)} ms  ${JSON.stringify(s.text)}  -> ${read(s.text)}`)
  const g: Record<string, { text: string; ms: number }> = {}
  for (const l of langs) { // Prisma REST allows one request at a time per key
    const t0 = performance.now()
    try {
      g[l] = { text: (await transcribeRest(gnaniKey, pcm, l, TERMS)).text, ms: performance.now() - t0 }
    } catch (e) {
      g[l] = { text: `ERROR ${(e as Error).message.slice(0, 80)}`, ms: performance.now() - t0 }
    }
    console.log(`   gnani  [${l}] ${Math.round(g[l].ms)} ms  ${JSON.stringify(g[l].text)}  -> ${read(g[l].text)}`)
  }
  rows.push({ turn: t.turn, live: t.text, sarvam: s, gnani: g })
}
fs.writeFileSync(path.join(dir, 'stt_compare.json'), JSON.stringify(rows, null, 1))
