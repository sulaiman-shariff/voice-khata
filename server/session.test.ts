import { describe, expect, it } from 'vitest'
import type { LedgerOp, ServerMsg, SnapCustomer, Snapshot } from '../shared/protocol.js'
import type { LlmReading } from './parse/llm.js'
import { MID_LIST_HOLD_MS, type SttCallbacks, Session } from './session.js'

const cust = (cid: string, name: string, balanceRs = 0, extra: Partial<SnapCustomer> = {}): SnapCustomer => ({
  cid, name, aliases: [], householdId: null, remindersOptIn: false, adult: false, balancePaise: balanceRs * 100, typicalPaise: null, ...extra,
})

function snap(customers: SnapCustomer[] = []): Snapshot {
  return {
    shopName: 'Sharma Kirana', customers, last: null,
    today: { creditPaise: 0, paymentPaise: 0, entries: 0 }, month: { creditPaise: 0, paymentPaise: 0, entries: 0 },
  }
}

function harness(customers: SnapCustomer[] = [], opts: { llm?: (t: string) => Partial<LlmReading>; llmMs?: number; speakMs?: number; transcribe2?: (pcm: Buffer) => Promise<{ text: string; lang?: string }>; readBack?: boolean; auto?: boolean; lang?: 'hi' | 'kn' | 'mr' } = {}) {
  const locales: string[] = []
  const warmed: string[][] = []
  const out: ServerMsg[] = []
  const said: string[] = []
  let audio = 0
  let commits = 0
  let cb: SttCallbacks = {}
  let clock = 0
  let ids = 0
  const aborted: boolean[] = []
  const s = new Session({
    openStt: (l, _k, c) => {
      cb = c
      locales.push(l)
      return { send: () => {}, commit: () => commits++, setKeyterms: () => {}, close: () => {}, setLanguage: (x: string) => locales.push(`set:${x}`) }
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
      if (opts.llmMs) await new Promise((r) => setTimeout(r, opts.llmMs))
      return opts.llm(t)
    },
    warm: (texts) => warmed.push(texts),
    transcribe2: opts.transcribe2,
    secondReading: true,
    send: (m) => out.push(m),
    sendAudio: (b) => (audio += b.length),
    now: () => clock,
    newId: () => `id${++ids}`,
  })
  s.onClient({ type: 'hello', lang: opts.lang ?? 'hi', snapshot: snap(customers), firstRun: false, ptt: false, readBack: opts.readBack, auto: opts.auto })
  const turn = async (text: string, noisy = false, lang?: string) => {
    said.length = 0
    await s.handleText(text, { speechEnd: 0, commitAt: null, finalAt: 0, early: false, snrDb: noisy ? 3 : 25, noisy, pcm: Buffer.alloc(32000), lang }, 'voice')
    await s.idle()
  }
  const ops = () => out.filter((m): m is Extract<ServerMsg, { type: 'ops' }> => m.type === 'ops').flatMap((m) => m.ops)
  const entries = () => ops().filter((o): o is Extract<LedgerOp, { op: 'entry' }> => o.op === 'entry')
  return {
    s, out, said, ops, entries, turn, aborted, warmed, locales,
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
    expect(h.said[0]).toBe('लिख दिया।') // confident save: short ack, name and amount are on screen
    expect(h.s.pending).toBeNull()
  })

  it('cross-script name matches the stored customer', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('रमेश ने 200 रुपये जमा किए')
    expect(h.entries()[0]).toMatchObject({ cid: 'r', paise: 20000, direction: 'payment' })
  })

  it('a heard new name is read back as a new customer before any account is opened', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('Pinky ka 200 udhaar')
    expect(h.ops()).toHaveLength(0)
    expect(h.s.pending?.kind).toBe('confirm')
    expect(h.said.join(' ')).toMatch(/नया ग्राहक Pinky/)
    const view = h.out.filter((m) => m.type === 'pending').at(-1) as { pending: { newCustomer?: boolean } }
    expect(view.pending.newCustomer).toBe(true)
    await h.turn('haan')
    expect(h.ops()[0]).toEqual({ op: 'add_customer', cid: 'id1', name: 'Pinky' })
    expect(h.entries()[0]).toMatchObject({ cid: 'id1', paise: 20000 })
    expect(h.said.join(' ')).toMatch(/खाता खोला/)
  })

  it('"no" to a new customer opens nothing and writes nothing', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('Pinky ka 200 udhaar')
    await h.turn('nahi')
    expect(h.ops()).toHaveLength(0)
    expect(h.s.pending).toBeNull()
  })

  it('a typed new name is taken as written', async () => {
    const h = harness([cust('r', 'Ramesh')])
    h.s.onClient({ type: 'text', text: 'Pinky ka 200 udhaar' })
    await h.s.idle()
    expect(h.ops()[0]).toMatchObject({ op: 'add_customer', name: 'Pinky' })
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

  it('several lines that each need a yes are read back together: one yes saves all', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('Pinky ka 200 udhaar, Ramesh ka 50 udhaar, Sonu ne 300 diye')
    // Ramesh is known and clear: saved at once; the two new names wait for one yes
    expect(h.entries()).toHaveLength(1)
    expect(h.entries()[0]).toMatchObject({ cid: 'r', paise: 5000 })
    expect(h.s.pending?.kind).toBe('batch')
    expect(h.said.join(' ')).toMatch(/Pinky 200 उधार.*Sonu 300 जमा.*सब सही है/)
    const view = h.out.filter((m) => m.type === 'pending').at(-1) as { pending: { rows?: { name: string; newCustomer?: boolean }[] } }
    expect(view.pending.rows?.map((r) => r.name)).toEqual(['Pinky', 'Sonu'])
    expect(view.pending.rows?.every((r) => r.newCustomer)).toBe(true)
    await h.turn('haan')
    expect(h.entries()).toHaveLength(3)
    expect(h.entries().slice(1)).toMatchObject([{ paise: 20000, direction: 'credit' }, { paise: 30000, direction: 'payment' }])
    expect(h.s.pending).toBeNull()
    expect(h.said).toHaveLength(1) // one short ack, not every line again
  })

  it('a batch read-back takes a fix to one line, then one yes', async () => {
    const h = harness([])
    await h.turn('Pinky ka 200 udhaar, Sonu ka 300 udhaar')
    expect(h.s.pending?.kind).toBe('batch')
    await h.turn('Sonu ka 350 udhaar')
    expect(h.entries()).toHaveLength(0)
    expect(h.said.join(' ')).toMatch(/Sonu 350/)
    await h.turn('haan')
    expect(h.entries().map((e) => e.paise)).toEqual([20000, 35000])
  })

  it('"no" to a batch read-back goes line by line', async () => {
    const h = harness([])
    await h.turn('Pinky ka 200 udhaar, Sonu ka 300 udhaar')
    await h.turn('nahi')
    expect(h.s.pending?.kind).toBe('confirm')
    await h.turn('haan')
    await h.turn('nahi')
    expect(h.entries()).toHaveLength(1)
    expect(h.entries()[0]).toMatchObject({ paise: 20000 })
  })

  it('two lines for one new name open one account', async () => {
    const h = harness([])
    await h.turn('Pinky ka 200 udhaar, Pinky ne 50 diye')
    await h.turn('haan')
    expect(h.ops().filter((o) => o.op === 'add_customer')).toHaveLength(1)
    expect(new Set(h.entries().map((e) => e.cid)).size).toBe(1)
  })

  it('no direction word: the model reads it before the shopkeeper is asked', async () => {
    const h = harness([cust('r', 'Ramesh')], {
      llm: () => ({ intent: 'entries', sure: true, entries: [{ name: 'Ramesh', amount: 340, direction: 'credit', day_offset: 0, promise: false }] }),
    })
    await h.turn('Ramesh ka 340 hai')
    expect(h.s.pending).toBeNull()
    expect(h.entries()[0]).toMatchObject({ cid: 'r', paise: 34000, direction: 'credit' })
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

describe('auto language', () => {
  it('listens with indic-auto and replies in the language just spoken, same turn', async () => {
    const h = harness([cust('r', 'Ramesh')], { auto: true })
    expect(h.locales).toEqual(['indic-auto'])
    await h.turn('ರಮೇಶ್‌ಗೆ 500 ರೂಪಾಯಿ ಸಾಲ ಕೊಟ್ಟೆ', false, 'kn-IN')
    expect(h.entries()[0]).toMatchObject({ cid: 'r', paise: 50000, direction: 'credit' })
    expect(h.out.some((m) => m.type === 'lang' && m.lang === 'kn')).toBe(true)
    expect(h.said.join(' ')).toMatch(/[ಀ-೿]/) // the reply is in Kannada
    expect(h.locales).toEqual(['indic-auto']) // the stream is not re-locked to one language
    await h.turn('I gave 200 to Ramesh', false, 'en-IN')
    expect(h.out.filter((m) => m.type === 'lang').at(-1)).toMatchObject({ lang: 'en' })
  })

  it('a bare yes, or unreadable talk, never switches the language', async () => {
    const h = harness([], { auto: true })
    await h.turn('Pinky ka 200 udhaar', false, 'hi-IN')
    await h.turn('yes', false, 'en-IN')
    expect(h.entries()).toHaveLength(1)
    expect(h.out.some((m) => m.type === 'lang')).toBe(false)
  })

  it('Marathi tagged hi-IN by indic-auto stays Marathi', async () => {
    const h = harness([cust('r', 'Ramesh')], { auto: true })
    await h.turn('रमेशला 500 रुपये उधार दिले', false, 'hi-IN')
    expect(h.out.filter((m) => m.type === 'lang').at(-1)).toMatchObject({ lang: 'mr' })
  })

  it('a locked language keeps the old rules: no switch on English', async () => {
    const h = harness([cust('r', 'Ramesh')])
    expect(h.locales).toEqual(['hi-IN'])
    await h.turn('I gave 200 to Ramesh', false, 'en-IN')
    expect(h.out.some((m) => m.type === 'lang')).toBe(false)
  })
})

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

describe('a list the recogniser split at a breath', () => {
  it('joins "Suresh 200," with the rest of the list into one turn', async () => {
    const h = harness([cust('s', 'Suresh'), cust('g', 'Geeta'), cust('m', 'Mohan')])
    h.cb.onFinal!('सुरेश 200,')
    await new Promise((r) => setTimeout(r, 200))
    expect(h.out.filter((m) => m.type === 'final')).toHaveLength(0) // held, not handled alone
    h.cb.onFinal!('गीता 150, मोहन 100 उधार')
    await h.s.idle()
    const finals = h.out.filter((m): m is Extract<ServerMsg, { type: 'final' }> => m.type === 'final')
    expect(finals).toHaveLength(1)
    expect(finals[0].text).toMatch(/सुरेश 200.*गीता 150.*मोहन 100 उधार/)
    expect(h.said.join(' ')).not.toMatch(/उधार दिया या जमा/) // never asked about Suresh alone
    expect(h.said.join(' ')).toMatch(/सुरेश.*गीता.*मोहन/)
  })

  it('a lone "Ramesh 340" is still handled after the short wait', async () => {
    const h = harness([cust('r', 'Ramesh')])
    h.cb.onFinal!('रमेश 340')
    await new Promise((r) => setTimeout(r, MID_LIST_HOLD_MS + 200))
    await h.s.idle()
    expect(h.out.some((m) => m.type === 'final' && m.text === 'रमेश 340')).toBe(true)
    expect(h.said.join(' ')).toMatch(/उधार|जमा/) // asks which way
  })

  it('a complete line is never held', async () => {
    const h = harness([cust('r', 'Ramesh')])
    h.cb.onFinal!('रमेश का 340 उधार')
    expect(h.out.some((m) => m.type === 'final' && m.text === 'रमेश का 340 उधार')).toBe(true) // handled at once
    await h.s.idle()
    expect(h.said.join(' ')).toMatch(/340/)
  })
})

describe('a sentence the recogniser split at a breath', () => {
  it('joins a dangling "रमेश का" with the rest', async () => {
    const h = harness([cust('r', 'Ramesh')])
    h.cb.onFinal!('रमेश का।')
    await new Promise((r) => setTimeout(r, 100))
    expect(h.out.filter((m) => m.type === 'final')).toHaveLength(0)
    h.cb.onFinal!('340 रुपये उधार।')
    await h.s.idle()
    const finals = h.out.filter((m): m is Extract<ServerMsg, { type: 'final' }> => m.type === 'final')
    expect(finals.map((f) => f.text)).toEqual(['रमेश का 340 रुपये उधार।']) // one sentence, no list comma
    expect(h.said.join(' ')).toMatch(/Ramesh, 340.*उधार/) // read back as one entry (no audio here, so it confirms)
  })
})

describe('second reading of a noisy turn (Prisma REST)', () => {
  it('a different amount turns the read-back into "X or Y?"', async () => {
    const h = harness([cust('r', 'Ramesh')], { transcribe2: async () => ({ text: 'रमेश का सत्रह रुपये उधार' }) })
    await h.turn('रमेश का 70 रुपये उधार', true)
    expect(h.entries()).toHaveLength(0)
    expect(h.s.pending?.kind).toBe('confusable')
    expect(h.said.join(' ')).toMatch(/70.*17|17.*70/)
    await h.turn('सत्रह', true)
    await h.turn('हाँ', true) // noisy room: the chosen amount is read back once more
    expect(h.entries()[0]).toMatchObject({ cid: 'r', paise: 1700 })
  })

  it('an agreeing second reading keeps the plain noisy read-back', async () => {
    const h = harness([cust('r', 'Ramesh')], { transcribe2: async () => ({ text: 'रमेश का सत्तर रुपये उधार' }) })
    await h.turn('रमेश का 70 रुपये उधार', true)
    expect(h.s.pending?.kind).toBe('confirm')
  })

  it('a failing or slow second reading changes nothing', async () => {
    const h = harness([cust('r', 'Ramesh')], { transcribe2: () => new Promise((_r, rej) => setTimeout(() => rej(new Error('429')), 5)) })
    await h.turn('रमेश का 70 रुपये उधार', true)
    expect(h.s.pending?.kind).toBe('confirm')
  })

  it('quiet turns never ask for a second reading', async () => {
    let calls = 0
    const h = harness([cust('r', 'Ramesh')], { transcribe2: async () => { calls++; return { text: '' } } })
    await h.turn('रमेश का 70 रुपये उधार')
    expect(calls).toBe(0)
    expect(h.entries()).toHaveLength(1)
  })
})

describe('spoken-only markup', () => {
  it('list read-backs pause between names, but the screen shows no tags', async () => {
    const h = harness([cust('s', 'Suresh'), cust('g', 'Geeta'), cust('m', 'Mohan')])
    await h.turn('सुरेश 200, गीता 150, मोहन 100 उधार', true)
    expect(h.said.join(' ')).toContain('<pauses>')
    const shown = h.out.filter((m): m is Extract<ServerMsg, { type: 'say' }> => m.type === 'say').map((m) => m.text).join(' ')
    expect(shown).not.toMatch(/[<>]/)
    expect(shown).toMatch(/सुरेश 200, गीता 150, मोहन 100/)
  })
})

describe('language rescue (Prisma REST follows the spoken language)', () => {
  it('an unreadable turn heard as Kannada switches the session and is handled', async () => {
    const h = harness([cust('r', 'Ramesh')], { transcribe2: async () => ({ text: 'ರಮೇಶ್‌ಗೆ 500 ರೂಪಾಯಿ ಸಾಲ ಕೊಟ್ಟೆ', lang: 'kn-IN' }) })
    await h.turn('रमेश के 500 रुपये साला कोटे')
    expect(h.out).toContainEqual({ type: 'lang', lang: 'kn' })
    expect(h.s.lang).toBe('kn')
    expect(h.entries()).toEqual([expect.objectContaining({ cid: 'r', paise: 50000, direction: 'credit' })])
  })

  it('another language that is not a ledger turn (a customer chatting) changes nothing', async () => {
    const h = harness([cust('r', 'Ramesh')], { transcribe2: async () => ({ text: 'ಹೇಗಿದ್ದೀರಾ ಅಣ್ಣ', lang: 'kn-IN' }) })
    await h.turn('हेगिदिरा अन्ना')
    expect(h.s.lang).toBe('hi')
    expect(h.out.some((m) => m.type === 'lang')).toBe(false)
  })

  it('the same language as the session is not a rescue', async () => {
    const h = harness([], { transcribe2: async () => ({ text: 'कुछ भी', lang: 'hi-IN' }) })
    await h.turn('कुछ भी नहीं')
    expect(h.out.some((m) => m.type === 'lang')).toBe(false)
  })
})

describe('following the language realtime Prisma detected', () => {
  const at = (lang: string) => ({ speechEnd: 0, commitAt: null, finalAt: 0, early: false, snrDb: 25, noisy: false, lang })
  it('a Kannada ledger turn in a Hindi session switches replies to Kannada', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.s.handleText('ರಮೇಶ್‌ಗೆ 500 ರೂಪಾಯಿ ಸಾಲ ಕೊಟ್ಟೆ', at('kn-IN'), 'voice')
    expect(h.out).toContainEqual({ type: 'lang', lang: 'kn' })
    expect(h.s.lang).toBe('kn')
  })
  it('English (Hinglish code-mixing) never switches', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.s.handleText('Ramesh 500 credit', at('en-IN'), 'voice')
    expect(h.s.lang).toBe('hi')
  })
  it('a non-ledger line in another language (customer chatting) never switches', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.s.handleText('ಹೇಗಿದ್ದೀರಾ ಅಣ್ಣ', at('kn-IN'), 'voice')
    expect(h.s.lang).toBe('hi')
  })
})

describe('language rescue is not asked for plain turns', () => {
  it('"रमेश, 400" (nothing unplaced) asks the direction without a REST call', async () => {
    let calls = 0
    const h = harness([cust('r', 'Ramesh')], { transcribe2: async () => { calls++; return { text: '' } } })
    await h.turn('रमेश, 400')
    expect(calls).toBe(0)
    expect(h.said.join(' ')).toMatch(/उधार|जमा/)
  })
})

describe('feels instant', () => {
  const tone = (amp: number) => {
    const f = new Int16Array(512)
    for (let i = 0; i < 512; i++) f[i] = Math.round(amp * Math.sin(i / 3))
    return Buffer.from(f.buffer)
  }
  it('sends one "heard" cue when the speaker pauses after money words', async () => {
    const h = harness([cust('r', 'Ramesh')])
    for (let i = 0; i < 10; i++) h.s.onAudio(tone(30))
    for (let i = 0; i < 20; i++) h.s.onAudio(tone(8000))
    h.cb.onPartial!('रमेश का 340 रुपये')
    expect(h.out.filter((m) => m.type === 'heard')).toHaveLength(0) // still speaking
    for (let i = 0; i < 12; i++) h.s.onAudio(tone(30)) // ~380 ms pause
    expect(h.out.filter((m) => m.type === 'heard')).toHaveLength(1)
    for (let i = 0; i < 20; i++) h.s.onAudio(tone(30))
    expect(h.out.filter((m) => m.type === 'heard')).toHaveLength(1) // once per utterance
  })

  it('no cue for chatter without money words', async () => {
    const h = harness([cust('r', 'Ramesh')])
    for (let i = 0; i < 10; i++) h.s.onAudio(tone(30))
    for (let i = 0; i < 20; i++) h.s.onAudio(tone(8000))
    h.cb.onPartial!('भैया आज बहुत गर्मी है')
    for (let i = 0; i < 15; i++) h.s.onAudio(tone(30))
    expect(h.out.some((m) => m.type === 'heard')).toBe(false)
  })

  it('"Read back every entry" keeps the full read-back', async () => {
    const h = harness([cust('r', 'Ramesh')], { readBack: true })
    await h.turn('Ramesh ka 340 udhaar')
    expect(h.said[0]).toContain('340')
  })

  it('a new customer, a promise and another day keep the full read-back', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('Pinky ka 200 udhaar')
    expect(h.said[0]).toMatch(/200/)
    await h.turn('Ramesh kal 500 dega')
    expect(h.said.join(' ')).toMatch(/500/)
  })

  it('"haan" to a noisy read-back is answered with the short ack', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('रमेश का 340 रुपये उधार', true)
    expect(h.s.pending?.kind).toBe('confirm')
    await h.turn('हाँ', true)
    expect(h.entries()).toHaveLength(1)
    expect(h.said[0]).toBe('लिख दिया।')
  })

  it('warms the fixed phrases for the session language on hello', () => {
    const h = harness()
    expect(h.warmed[0]).toEqual(['लिख दिया।', expect.any(String)])
  })

  it('a slow model turn never says a filler (no "one second" over the shopkeeper)', async () => {
    const h = harness([], {
      llmMs: 600,
      llm: () => ({ intent: 'entries', sure: false, unsure_reason: 'name is a relation', entries: [{ name: 'Pinky ki mummy', amount: 500, direction: 'payment', day_offset: 0, promise: false }] }),
    })
    await h.turn('wo jo Pinky ki mummy hai na, unka paanch sau')
    expect(h.said.join(' ')).not.toContain('एक सेकंड')
    expect(h.s.pending?.kind).toBe('confirm')
  })
})

describe('colloquial rupee words do not trigger the language rescue', () => {
  it.each(['ரமேஷ், 400 ரூபா.', 'రమేష్, 400 రూపాయల.'])('%s asks the direction without a REST call', async (text) => {
    let calls = 0
    const h = harness([cust('r', 'Ramesh')], { transcribe2: async () => { calls++; return { text: '' } } })
    h.s.lang = text.includes('ரூ') ? 'ta' : 'te'
    await h.turn(text)
    expect(calls).toBe(0)
    expect(h.s.pending?.kind).toBe('direction')
  })
})

describe('continuity across a dropped connection', () => {
  const lastResume = (out: ServerMsg[]) => (out.filter((m) => m.type === 'turn_done').at(-1) as { resume?: string }).resume!

  it('an open read-back question survives a reconnect: "haan" in the new session saves it', async () => {
    const a = harness([cust('r', 'Ramesh')])
    await a.turn('रमेश का 340 रुपये उधार', true)
    expect(a.s.pending?.kind).toBe('confirm')
    const resume = lastResume(a.out)
    const b = harness([cust('r', 'Ramesh')])
    b.s.onClient({ type: 'hello', lang: 'hi', snapshot: { shopName: 'S', customers: [cust('r', 'Ramesh')], last: null, today: { creditPaise: 0, paymentPaise: 0, entries: 0 }, month: { creditPaise: 0, paymentPaise: 0, entries: 0 } }, firstRun: false, ptt: false, resume })
    expect(b.s.pending?.kind).toBe('confirm')
    expect(b.out).toContainEqual(expect.objectContaining({ type: 'pending', pending: expect.objectContaining({ kind: 'confirm' }) }))
    await b.turn('हाँ', true)
    expect(b.entries()).toEqual([expect.objectContaining({ cid: 'r', paise: 34000, direction: 'credit' })])
  })

  it('a garbled or foreign resume blob is ignored', () => {
    const b = harness([cust('r', 'Ramesh')])
    b.s.importState('not-base64-json')
    b.s.importState(Buffer.from(JSON.stringify({ v: 2 })).toString('base64url'))
    expect(b.s.pending).toBeNull()
  })

  it('a stale question is not restored', () => {
    const a = harness([cust('r', 'Ramesh')])
    const blob = Buffer.from(JSON.stringify({ v: 1, at: Date.now() - 60_000, lang: 'hi', pending: { kind: 'delete' }, pendingAgeMs: 0, focusCid: null, history: [] })).toString('base64url')
    a.s.importState(blob)
    expect(a.s.pending).toBeNull()
  })

  it('a turn re-sent after a drop is saved with a notice and a full read-back', async () => {
    const h = harness([cust('r', 'Ramesh')])
    h.s.onClient({ type: 'hello', lang: 'hi', snapshot: { shopName: 'S', customers: [cust('r', 'Ramesh')], last: null, today: { creditPaise: 0, paymentPaise: 0, entries: 0 }, month: { creditPaise: 0, paymentPaise: 0, entries: 0 } }, firstRun: false, ptt: false, resend: 'Ramesh ka 340 udhaar' })
    await h.s.idle()
    expect(h.entries()).toEqual([expect.objectContaining({ cid: 'r', paise: 34000 })])
    expect(h.said.join(' ')).toMatch(/नेटवर्क.*340/)
  })

  it('ledger ops carry a sequence number the phone acknowledges', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('Ramesh ka 340 udhaar')
    const ops = h.out.find((m) => m.type === 'ops') as { seq?: number }
    expect(ops.seq).toBe(1)
    h.s.onClient({ type: 'ack', seq: 1 })
  })
})

describe('name guard (cases from the 21 Nov production logs)', () => {
  it('"ಸುರೇಶ್ ಹೆಸರಿಂದ" as the answer to "whose name?" is Suresh, not a new customer', async () => {
    const h = harness([cust('s', 'Suresh')])
    h.s.lang = 'kn'
    await h.turn('300 ರೂಪಾಯಿ ಸಾಲ.')
    expect(h.s.pending?.kind).toBe('name')
    await h.turn('ಸುರೇಶ್ ಹೆಸರಿಂದ.')
    expect(h.ops().some((o) => o.op === 'add_customer')).toBe(false)
    expect(h.s.pending?.kind).toBe('confirm') // the name came as an answer: read back once
    expect(h.said.join(' ')).toMatch(/Suresh/)
    expect(h.said.join(' ')).not.toMatch(/ಹೆಸರಿಂದ/)
    await h.turn('ಹೌದು')
    expect(h.entries()).toEqual([expect.objectContaining({ cid: 's', paise: 30000, direction: 'credit' })])
  })

  it('"Ramesh ke naam se 300 udhaar" is Ramesh', async () => {
    const h = harness([cust('r', 'Ramesh')])
    await h.turn('Ramesh ke naam se 300 udhaar')
    expect(h.ops().some((o) => o.op === 'add_customer')).toBe(false)
    expect(h.entries()[0]).toMatchObject({ cid: 'r', paise: 30000 })
  })

  it('a model reading "ಸುರೇಶ್ದು" (Suresh\'s) is the existing Suresh', async () => {
    const h = harness([cust('s', 'Suresh')], {
      llm: () => ({ intent: 'entries', sure: true, entries: [{ name: 'ಸುರೇಶ್ದು', amount: 300, direction: 'credit', day_offset: 0, promise: false }] }),
    })
    await h.turn('Sureshdu 300 rupees sala aite.')
    expect(h.ops().some((o) => o.op === 'add_customer')).toBe(false)
    expect(h.entries()[0]).toMatchObject({ cid: 's', paise: 30000 })
  })

  it('with no Suresh yet, "Sureshdu" (Suresh\'s) opens an account called Suresh', async () => {
    const h = harness([cust('m', 'Mahi')], {
      llm: () => ({ intent: 'entries', sure: true, entries: [{ name: 'ಸುರೇಶ್ದು', amount: 300, direction: 'credit', day_offset: 0, promise: false }] }),
    })
    await h.turn('Sureshdu 300 rupees sala aite.')
    expect(h.said.join(' ')).toMatch(/(नया ग्राहक|New customer) Suresh/)
    await h.turn('yes')
    expect(h.ops().find((o) => o.op === 'add_customer')).toMatchObject({ name: 'Suresh' })
  })

  it('a model name that only contains a known customer ("Suresh hesaru account") is that customer', async () => {
    const h = harness([cust('s', 'Suresh')], {
      llm: () => ({ intent: 'entries', sure: true, entries: [{ name: 'Suresh mele', amount: 300, direction: 'credit', day_offset: 0, promise: false }] }),
    })
    await h.turn('Suresh hesaru mele 300 sala')
    expect(h.ops().some((o) => o.op === 'add_customer')).toBe(false)
  })

  it('"300 rupees kottu" (Kannada "gave") does not open an account called Kottu', async () => {
    const h = harness([cust('s', 'Suresh')])
    h.s.lang = 'en'
    await h.turn('300 rupees kottu.')
    expect(h.ops().some((o) => o.op === 'add_customer')).toBe(false)
    expect(h.s.pending?.kind).toBe('name')
  })

  it('a lone customer name is held and joined with the amount said after a pause', async () => {
    const h = harness([cust('s', 'Suresh')])
    h.s.lang = 'kn'
    h.cb.onFinal!('ಸುರೇಶ್')
    await new Promise((r) => setTimeout(r, 100))
    expect(h.out.filter((m) => m.type === 'final')).toHaveLength(0)
    h.cb.onFinal!('300 ರೂಪಾಯಿ ಸಾಲ.')
    await h.s.idle()
    const finals = h.out.filter((m): m is Extract<ServerMsg, { type: 'final' }> => m.type === 'final')
    expect(finals.map((f) => f.text)).toEqual(['ಸುರೇಶ್ 300 ರೂಪಾಯಿ ಸಾಲ.'])
    expect(h.s.pending?.kind === 'name').toBe(false) // never asked "whose name?"
  })

  it('a new name that contains no known customer still opens an account', async () => {
    const h = harness([cust('s', 'Suresh')])
    await h.turn('Pinky ka 200 udhaar')
    await h.turn('haan')
    expect(h.ops()[0]).toMatchObject({ op: 'add_customer', name: 'Pinky' })
  })

  it('chatter the model is sure about beats a stray number ("it says 1 second...")', async () => {
    const h = harness([cust('s', 'Suresh')], { llm: () => ({ intent: 'chitchat', sure: true }) })
    h.s.lang = 'kn'
    await h.turn('It says, "1 second before you finish saying no."')
    expect(h.entries()).toHaveLength(0)
    expect(h.s.pending).toBeNull()
  })
})

describe('new account names', () => {
  it('drop a glued possessive, keep names that really end in -du', async () => {
    const { newCustomerName } = await import('./session.js')
    expect(newCustomerName('ಸುರೇಶ್ದು')).toBe('ಸುರೇಶ್')
    expect(newCustomerName('Sureshdu')).toBe('Suresh')
    expect(newCustomerName('ಬಿಂದು')).toBe('ಬಿಂದು')
    expect(newCustomerName('Bindu')).toBe('Bindu')
    expect(newCustomerName('Indu')).toBe('Indu')
    expect(newCustomerName('Pandu')).toBe('Pandu')
    expect(newCustomerName('Pinky')).toBe('Pinky')
  })
})

describe('one entry built across turns (21 Nov evening production logs)', () => {
  const said = (h: ReturnType<typeof harness>) => h.said.join(' ')

  it('"300 ಬರೀ" (write 300) never opens an account called ಬರೀ without a yes', async () => {
    const h = harness([cust('s', 'Suresh')])
    h.s.lang = 'kn'
    await h.turn('300 ಬರೀ.')
    await h.turn('ಸಾಲ')
    expect(said(h)).toMatch(/ಹೊಸ ಗ್ರಾಹಕ ಬರೀ/)
    await h.turn('ಇಲ್ಲ')
    expect(h.ops()).toHaveLength(0)
  })

  it('"ಮಾಹಿ ಹೆಸರಿಂದ" asks how much; "300 ಬರೀ" fills the amount, not the name', async () => {
    const h = harness([cust('s', 'Suresh')])
    h.s.lang = 'kn'
    await h.turn('ಮಾಹಿ ಹೆಸರಿಂದ.')
    expect(h.s.pending?.kind).toBe('amount')
    expect(said(h)).toMatch(/ಮಾಹಿ, ಎಷ್ಟು/)
    await h.turn('300 ಬರೀ.')
    expect(h.s.pending?.kind).toBe('direction')
    expect(said(h)).toMatch(/^ಮಾಹಿ, 300/)
    await h.turn('ಸಾಲ')
    expect(said(h)).toMatch(/ಹೊಸ ಗ್ರಾಹಕ ಮಾಹಿ/)
    await h.turn('ಹೌದು')
    expect(h.ops().find((o) => o.op === 'add_customer')).toMatchObject({ name: 'ಮಾಹಿ' })
    expect(h.entries()).toEqual([expect.objectContaining({ paise: 30000, direction: 'credit' })])
  })

  it('a known name alone asks how much, and the answer can carry credit/paid too', async () => {
    const h = harness([cust('m', 'Mahi')])
    h.s.lang = 'en'
    await h.turn('Mahe')
    expect(said(h)).toMatch(/Mahi, how much\?/)
    await h.turn('300 credit')
    await h.turn('yes') // "Mahe" was only close to Mahi: read back once
    expect(h.entries()).toEqual([expect.objectContaining({ cid: 'm', paise: 30000, direction: 'credit' })])
  })

  it('an amount alone asks whose; a number word alone in chatter does not', async () => {
    const h = harness([cust('s', 'Suresh')])
    h.s.lang = 'en'
    await h.turn('One.')
    expect(h.s.pending).toBeNull()
    await h.turn('300')
    expect(h.s.pending?.kind).toBe('name')
  })

  it('talk to someone else while a question is open keeps the question and says nothing', async () => {
    const h = harness([cust('s', 'Suleiman')])
    h.s.lang = 'en'
    await h.turn('Suleiman 400.')
    expect(h.s.pending?.kind).toBe('direction')
    await h.turn('Should you take it upstairs for testing?')
    await h.turn('Your')
    expect(h.said).toHaveLength(0)
    expect(h.s.pending?.kind).toBe('direction')
    await h.turn('udhaar')
    expect(h.entries()).toEqual([expect.objectContaining({ cid: 's', paise: 40000, direction: 'credit' })])
  })

  it('"Mahe Talk 300" is read back as the existing Mahi, never opened as "Mahe Talk"', async () => {
    const h = harness([cust('m', 'Mahi')])
    h.s.lang = 'en'
    await h.turn('Mahe Talk 300.')
    await h.turn('udhaar')
    expect(said(h)).toMatch(/Mahi, 300 rupees on credit, correct\?/)
    await h.turn('yes')
    expect(h.ops().some((o) => o.op === 'add_customer')).toBe(false)
    expect(h.entries()).toEqual([expect.objectContaining({ cid: 'm', paise: 30000 })])
  })

  it('the same line said twice in one turn is one entry', async () => {
    const h = harness([cust('s', 'Suleiman')])
    h.s.lang = 'en'
    await h.turn('Suleiman 200 credit, Suleiman 200 credit.')
    expect(h.entries()).toHaveLength(1)
  })

  it('chatter is marked as not an entry so the phone can show it was heard', async () => {
    const h = harness([cust('s', 'Suresh')])
    h.s.lang = 'en'
    await h.turn('This network issue, bro.')
    expect(h.out.some((m) => m.type === 'not_entry')).toBe(true)
  })
})
