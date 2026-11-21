/**
 * Play recorded turns into the multi-language listener (real Prisma streams) and show what each
 * language heard and which one the session picks.
 *   npx tsx --env-file=.env eval/multi_listen.ts [eval/recordings/<session>] [--customers Ramesh,Suresh]
 */
import fs from 'node:fs'
import path from 'node:path'
import { MultiStt } from '../server/gnani/multi.js'
import { SttStream } from '../server/gnani/stt.js'
import { Session } from '../server/session.js'

const args = process.argv.slice(2)
const root = 'eval/recordings'
const dir = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--')) ??
  path.join(root, fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, 'turns.jsonl'))).sort().at(-1)!)
const names = (args.includes('--customers') ? args[args.indexOf('--customers') + 1] : 'Ramesh,Suresh,Mahi').split(',')
const locales = (process.env.LISTEN_LANGS ?? 'en-IN,hi-IN,kn-IN').split(',')
const key = process.env.GNANI_API_KEY!

const s = new Session({
  openStt: () => ({ send() {}, commit() {}, setKeyterms() {}, close() {} }),
  speak: async () => ({ firstAudioMs: 0, bytes: 0 }), send() {}, sendAudio() {},
})
s.onClient({ type: 'hello', lang: 'en', firstRun: false, ptt: false, snapshot: { shopName: 'S', last: null, entries: [],
  customers: names.map((n, i) => ({ cid: `c${i}`, name: n, aliases: [], householdId: null, remindersOptIn: false, adult: false, balancePaise: 20000, typicalPaise: null })),
  today: { creditPaise: 0, paymentPaise: 0, entries: 0 }, month: { creditPaise: 0, paymentPaise: 0, entries: 0 } } })
const terms = [...names, 'credit', 'paid', 'udhaar', 'jama', 'rupees', 'clear', 'उधार', 'जमा', 'ಸಾಲ', 'ಜಮಾ']

for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.wav')).sort()) {
  const pcm = fs.readFileSync(path.join(dir, f)).subarray(44)
  const got = await new Promise<string>((done) => {
    let opened = 0
    const m: MultiStt = new MultiStt(locales, (l, ev) => new SttStream(key, l, terms, {
      ...ev, onOpen: () => { ev.onOpen?.(); if (++opened === locales.length) void play() },
    }), {
      pick: (heard) => {
        const i = s.pickHeard(heard)
        console.log(`${f}\n${heard.map((h, k) => `   ${k === i ? '>' : ' '} ${h.locale} ${JSON.stringify(h.text)}`).join('\n')}`)
        return i
      },
      onFinal: (t) => { m.close(); done(t) },
    })
    const play = async () => {
      for (let i = 0; i < pcm.length; i += 3200) { m.send(pcm.subarray(i, i + 3200)); await new Promise((r) => setTimeout(r, 100)) }
      m.send(Buffer.alloc(32000))
      m.commit()
    }
    setTimeout(() => { m.close(); done('(timeout)') }, 30000)
  })
  if (got === '(timeout)') console.log(`${f} (timeout)`)
}
process.exit(0)
