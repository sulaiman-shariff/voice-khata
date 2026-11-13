import { describe, expect, it } from 'vitest'
import type { LedgerOp, ServerMsg, SnapCustomer, Snapshot } from '../shared/protocol.js'
import type { LlmReading } from './parse/llm.js'
import { type SttCallbacks, Session } from './session.js'

const cust = (cid: string, name: string, balanceRs = 0, extra: Partial<SnapCustomer> = {}): SnapCustomer => ({
  cid, name, aliases: [], householdId: null, remindersOptIn: false, adult: false, balancePaise: balanceRs * 100, typicalPaise: null, ...extra,
})

function snap(customers: SnapCustomer[] = []): Snapshot {
  return {
    shopName: 'Sharma Kirana', customers, last: null,
    today: { creditPaise: 0, paymentPaise: 0, entries: 0 }, month: { creditPaise: 0, paymentPaise: 0, entries: 0 },
  }
}

function harness(customers: SnapCustomer[] = [], opts: { llm?: (t: string) => Partial<LlmReading>; speakMs?: number } = {}) {
  const out: ServerMsg[] = []
  const said: string[] = []
  let audio = 0
  let commits = 0
  let cb: SttCallbacks = {}
  let clock = 0
  let ids = 0
  const aborted: boolean[] = []
  const s = new Session({
    openStt: (_l, _k, c) => {
      cb = c
      return { send: () => {}, commit: () => commits++, setKeyterms: () => {}, close: () => {} }
    },
    speak: async (text, _l, onAudio, signal) => {
      said.push(text)
      onAudio(Buffer.alloc(3200))
      if (opts.speakMs) await new Promise((r) => setTimeout(r, opts.speakMs))
      aborted.push(signal.aborted)
      if (!signal.aborted) onAudio(Buffer.alloc(32000))
      return { firstAudioMs: 10, bytes: 35200 }
    },
    llm: async (t) => {
      if (!opts.llm) throw new Error('no llm in this test')
      return opts.llm(t)
    },
    send: (m) => out.push(m),
    sendAudio: (b) => (audio += b.length),
    now: () => clock,
    newId: () => `id${++ids}`,
  })
  s.onClient({ type: 'hello', lang: 'hi', snapshot: snap(customers), firstRun: false, ptt: false })
  const turn = async (text: string, noisy = false) => {
    said.length = 0
    await s.handleText(text, { speechEnd: 0, commitAt: null, finalAt: 0, early: false, snrDb: noisy ? 3 : 25, noisy }, 'voice')
    await s.idle()
  }
  const ops = () => out.filter((m): m is Extract<ServerMsg, { type: 'ops' }> => m.type === 'ops').flatMap((m) => m.ops)
  const entries = () => ops().filter((o): o is Extract<LedgerOp, { op: 'entry' }> => o.op === 'entry')
  return {
    s, out, said, ops, entries, turn, aborted,
    get commits() { return commits }, get audio() { return audio }, get cb() { return cb },
    tick: (ms: number) => (clock += ms),
  }
}

describe('session dialogue', () => {
  it('first run speaks the AI disclosure', async () => {
    const h = harness()
    h.s.onClient({ type: 'hello', lang: 'kn', snapshot: snap(), firstRun: true, ptt: false })
    await h.s.idle()
    expect(h.out.find((m) => m.type === 'say')).toMatchObject({ text: expect.stringContaining('AI') })
  })

  it('clear entry for a known customer saves at once', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('Ramesh ka 340 udhaar')
    expect(h.entries()).toEqual([expect.objectContaining({ cid: 'r', paise: 34000, direction: 'credit', promise: false })])
    expect(h.said[0]).toContain('340')
    expect(h.s.pending).toBeNull()
  })

  it('cross-script name matches the stored customer', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('रमेश ने 200 रुपये जमा किए')
    expect(h.entries()[0]).toMatchObject({ cid: 'r', paise: 20000, direction: 'payment' })
  })

  it('new customer is created and announced', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('Pinky ka 200 udhaar')
    expect(h.ops()[0]).toEqual({ op: 'add_customer', cid: 'id1', name: 'Pinky' })
    expect(h.entries()[0]).toMatchObject({ cid: 'id1', paise: 20000 })
    expect(h.said[0]).toMatch(/खाता खोला/)
  })

  it('missing direction is asked, then saved from a one-word answer', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('Ramesh 340')
    expect(h.entries()).toHaveLength(0)
    expect(h.s.pending?.kind).toBe('direction')
    await h.turn('udhaar')
    expect(h.entries()[0]).toMatchObject({ cid: 'r', paise: 34000, direction: 'credit' })
  })

  it('confusable number asks 60 or 7, and the answer decides', async () => {
    const h = harness([cust('d', 'Deepak')])
    await h.turn('Deepak ne saath rupaye diye')
    expect(h.s.pending?.kind).toBe('confusable')
    expect(h.said[0]).toMatch(/60.*7|7.*60/)
    await h.turn('7')
    expect(h.entries()[0]).toMatchObject({ cid: 'd', paise: 700, direction: 'payment' })
  })

  it('two similar customers: asks which, answer picks one', async () => {
    const h = harness([cust('a', 'Ramesh'), cust('b', 'Ramesh Kumar')])
    await h.turn('Ramesh ka 500 udhaar')
    expect(h.s.pending?.kind).toBe('which')
    await h.turn('Ramesh Kumar')
    expect(h.entries()[0]).toMatchObject({ cid: 'b', paise: 50000 })
  })

  it('noisy room reads back first; haan saves, nahi drops', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('Ramesh ka 340 udhaar', true)
    expect(h.s.pending?.kind).toBe('confirm')
    expect(h.said[0]).toMatch(/शोर/)
    await h.turn('haan')
    expect(h.entries()).toHaveLength(1)

    await h.turn('Ramesh ka 900 udhaar', true)
    await h.turn('nahi')
    expect(h.entries()).toHaveLength(1)
  })

  it('confirm answered with a corrected amount saves the corrected value', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('Ramesh ka 340 udhaar', true)
    await h.turn('nahi, 430')
    expect(h.entries()[0]).toMatchObject({ paise: 43000 })
  })

  it('correction after saving amends the last entry; undo voids it', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('Ramesh ka 340 udhaar')
    const eid = h.entries()[0].eid
    await h.turn('nahi, 430')
    expect(h.ops()).toContainEqual({ op: 'amend', eid, paise: 43000 })
    expect(h.said[0]).toContain('430')
    await h.turn('galat hai, hata do')
    expect(h.ops()).toContainEqual({ op: 'void', eid, reason: 'spoken undo' })
  })

  it('correction can move the entry to another customer', async () => {
    const h = harness([cust('r', 'Ramesh'), cust('s', 'Suresh')])
    await h.turn('Ramesh ka 340 udhaar')
    await h.turn('nahi, Suresh')
    expect(h.ops()).toContainEqual(expect.objectContaining({ op: 'amend', cid: 's' }))
  })

  it('balance query answers with the running total', async () => {
    const h = harness([cust('r', 'Ramesh', 1870)])
    await h.turn('Ramesh ka total kitna hai')
    expect(h.said[0]).toContain('1,870')
    await h.turn('Ramesh ka 130 udhaar')
    await h.turn('Ramesh ka total kitna hai')
    expect(h.said[0]).toContain('2,000')
  })

  it('reminders only for opted-in adults, polite text', async () => {
    const h = harness([cust('r', 'Ramesh', 500), cust('g', 'Geeta', 300, { remindersOptIn: true, adult: true })])
    await h.turn('Ramesh ko yaad dilao')
    expect(h.out.some((m) => m.type === 'remind')).toBe(false)
    expect(h.said[0]).toMatch(/अनुमति/)
    await h.turn('Geeta ko yaad dilao')
    const r = h.out.find((m) => m.type === 'remind') as Extract<ServerMsg, { type: 'remind' }>
    expect(r.cid).toBe('g')
    expect(r.text).toContain('300')
    expect(r.text).toContain('Sharma Kirana')
  })

  it('talk to a customer is ignored silently', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('bhaiya do kilo cheeni dena')
    expect(h.said).toHaveLength(0)
    expect(h.ops()).toHaveLength(0)
  })

  it('delete all needs a spoken yes', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('sab data mita do')
    expect(h.ops()).toHaveLength(0)
    await h.turn('haan')
    expect(h.ops()).toContainEqual({ op: 'delete_all' })
  })

  it('promise is recorded as a promise, not a payment', async () => {
    const h = harness([cust('a', 'Anil')])
    await h.turn('Anil kal sawa sau de jayega')
    expect(h.entries()[0]).toMatchObject({ cid: 'a', paise: 12500, promise: true, dayOffset: 1 })
  })

  it('two entries in one breath: saves the sure one, asks about the unsure one', async () => {
    const h = harness([cust('a', 'Anil'), cust('r', 'Ravi')])
    await h.turn('Anil ka dedh sau udhaar aur Ravi 1200')
    expect(h.entries()).toHaveLength(1)
    expect(h.entries()[0]).toMatchObject({ cid: 'a', paise: 15000 })
    expect(h.s.pending?.kind).toBe('direction')
    await h.turn('jama')
    expect(h.entries()[1]).toMatchObject({ cid: 'r', paise: 120000, direction: 'payment' })
  })

  it('LLM path is used for hard turns, but an invented amount is never saved', async () => {
    const h = harness([cust('r', 'Ramesh')], {
      llm: () => ({ intent: 'entries', sure: true, entries: [{ name: 'Ramesh', amount: 999, direction: 'credit', day_offset: 0, promise: false }] }),
    })
    await h.turn('Ramesh wale 340')
    expect(h.entries().some((e) => e.paise === 99900)).toBe(false)
  })

  it('LLM reading of a relationship name saves after confirming', async () => {
    const h = harness([], {
      llm: () => ({ intent: 'entries', sure: false, unsure_reason: 'name is a relation', entries: [{ name: 'Pinky ki mummy', amount: 500, direction: 'payment', day_offset: 0, promise: false }] }),
    })
    await h.turn('wo jo Pinky ki mummy hai na, unka paanch sau')
    expect(h.s.pending?.kind).toBe('confirm')
    await h.turn('haan')
    expect(h.entries()[0]).toMatchObject({ paise: 50000, direction: 'payment', source: expect.objectContaining({ path: 'llm' }) })
  })

  it('unusually large amount for a customer is read back first', async () => {
    const h = harness([cust('r', 'Ramesh', 0, { typicalPaise: 20000 })])
    await h.turn('Ramesh ka 3400 udhaar')
    expect(h.s.pending?.kind).toBe('confirm')
  })
})

// ------------------------------------------------------------------ audio-level behaviour
function pcm(seconds: number, amp: number, seed = 1) {
  let s = seed
  const n = Math.round(seconds * 16000)
  const b = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0
    const noise = ((s / 2 ** 32) * 2 - 1) * 300
    const tone = amp * Math.sin((2 * Math.PI * 200 * i) / 16000)
    b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(noise + tone))), i * 2)
  }
  return b
}
function feed(h: ReturnType<typeof harness>, buf: Buffer) {
  for (let o = 0; o < buf.length; o += 1024) {
    h.s.onAudio(buf.subarray(o, o + 1024))
    h.tick(32)
  }
}

describe('end of turn', () => {
  it('commits early when the words are complete and the speaker pauses', () => {
    const h = harness([cust('r', 'Ramesh')])
    feed(h, pcm(1, 0)) // shop noise
    feed(h, pcm(1.5, 8000)) // speech
    h.cb.onPartial?.('Ramesh ka 340 udhaar')
    feed(h, pcm(0.4, 0)) // pause
    expect(h.commits).toBe(1)
  })

  it('does not commit early on an unfinished sentence', () => {
    const h = harness([cust('r', 'Ramesh')])
    feed(h, pcm(1, 0))
    feed(h, pcm(1.5, 8000))
    h.cb.onPartial?.('Ramesh ka 340')
    feed(h, pcm(0.4, 0))
    expect(h.commits).toBe(0)
  })

  it('push-to-talk release commits', () => {
    const h = harness()
    h.s.onClient({ type: 'ptt_start' })
    feed(h, pcm(1, 8000))
    h.s.onClient({ type: 'ptt_end' })
    expect(h.commits).toBe(1)
  })
})

describe('barge-in', () => {
  it('speech over the agent ducks, real words stop it', async () => {
    const h = harness([cust('r', 'Ramesh', 500)], { speakMs: 50 })
    const p = h.turn('Ramesh ka total kitna hai')
    await new Promise((r) => setTimeout(r, 5))
    h.cb.onSpeechStart?.()
    expect(h.out.at(-1)).toEqual({ type: 'duck' })
    h.cb.onPartial?.('nahi ruko')
    expect(h.out.some((m) => m.type === 'stop_audio')).toBe(true)
    await p
    expect(h.aborted.at(-1)).toBe(true)
  })

  it('a cough (speech start, no words) only ducks and then restores', async () => {
    const h = harness([cust('r', 'Ramesh', 500)], { speakMs: 50 })
    const p = h.turn('Ramesh ka total kitna hai')
    await new Promise((r) => setTimeout(r, 5))
    h.cb.onSpeechStart?.()
    h.cb.onSpeechEnd?.()
    expect(h.out.slice(-2)).toEqual([{ type: 'duck' }, { type: 'unduck' }])
    await p
    expect(h.aborted.at(-1)).toBe(false)
  })

  it('our own words echoed back do not stop the reply', async () => {
    const h = harness([cust('r', 'Ramesh', 500)], { speakMs: 50 })
    const p = h.turn('Ramesh ka total kitna hai')
    await new Promise((r) => setTimeout(r, 5))
    h.cb.onPartial?.('Ramesh का कुल')
    await p
    expect(h.out.some((m) => m.type === 'stop_audio')).toBe(false)
  })
})

describe('LLM economy', () => {
  it('name + amount only: asks the direction without calling the LLM', async () => {
    let calls = 0
    const h = harness([cust('r', 'Ramesh')], { llm: () => { calls++; return { intent: 'unclear', sure: false } } })
    await h.turn('रमेश, 300।')
    expect(calls).toBe(0)
    expect(h.s.pending?.kind).toBe('direction')
  })
  it('a direction answer after an LLM reading saves without a second question', async () => {
    const h = harness([cust('r', 'Ramesh')], {
      llm: () => ({ intent: 'entries', sure: false, unsure_reason: 'direction unclear', entries: [{ name: 'Ramesh', amount: 300, direction: null, day_offset: 0, promise: false }] }),
    })
    await h.turn('wo Ramesh wale 300 ka scene')
    expect(h.s.pending?.kind).toBe('direction')
    await h.turn('उधार')
    expect(h.entries()[0]).toMatchObject({ cid: 'r', paise: 30000, direction: 'credit' })
  })
})

describe('English answers to open questions', () => {
  it('"Correct, correct." to credit-or-paid re-asks the question, then "paid" saves', async () => {
    const h = harness([cust('s', 'Suresh')])
    h.s.lang = 'en'
    await h.turn('Suresh, 500 rupees.')
    expect(h.s.pending?.kind).toBe('direction')
    await h.turn('Correct, correct.')
    expect(h.said[0]).toMatch(/Credit, or paid\?/)
    expect(h.s.pending?.kind).toBe('direction')
    await h.turn('paid')
    expect(h.entries()[0]).toMatchObject({ cid: 's', paise: 50000, direction: 'payment' })
  })
  it('English entries save directly', async () => {
    const h = harness([cust('s', 'Suresh')])
    h.s.lang = 'en'
    await h.turn("add 500 to Suresh's account")
    await h.turn('received 200 from Suresh')
    expect(h.entries().map((e) => [e.cid, e.paise, e.direction])).toEqual([['s', 50000, 'credit'], ['s', 20000, 'payment']])
  })
})
