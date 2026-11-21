/**
 * Messages between the phone (client) and the voice function (server).
 * The ledger lives on the phone; the server is stateless across connections and works from
 * the snapshot the phone sends, replying with ledger ops for the phone to apply.
 */
import type { ImportRow } from './import.js'
import type { Direction } from './ledger.js'
import type { Lang } from './replies.js'

export interface SnapCustomer {
  cid: string
  name: string
  aliases: string[]
  householdId: string | null
  remindersOptIn: boolean
  adult: boolean
  balancePaise: number
  typicalPaise: number | null
  /** shown and spoken instead of `name` when two customers share it ("Ramesh · Gali 3") */
  label?: string
}

export interface SnapEntry {
  eid: string
  cid: string
  paise: number
  direction: Direction
  day: string
  promise?: boolean
  ts?: number
}

export interface Snapshot {
  shopName: string
  customers: SnapCustomer[]
  last: SnapEntry | null
  /** Recent live entries, newest first (up to 20): lets the agent change any of them, not just the last. */
  recent?: SnapEntry[]
  today: { creditPaise: number; paymentPaise: number; entries: number }
  month: { creditPaise: number; paymentPaise: number; entries: number }
}

export type LedgerOp =
  | { op: 'add_customer'; cid: string; name: string }
  | { op: 'add_alias'; cid: string; alias: string }
  | {
    op: 'entry'
    eid: string
    cid: string
    paise: number
    direction: Direction
    dayOffset: number
    promise: boolean
    source: { transcript: string; confidence: 'high' | 'low'; reasons: string[]; lang: string; snrDb?: number; path: 'fast' | 'llm' }
  }
  | { op: 'amend'; eid: string; paise?: number; direction?: Direction; cid?: string }
  | { op: 'void'; eid: string; reason: string }
  | { op: 'delete_all' }

export type ClientMsg =
  | {
    type: 'hello'; lang: Lang; snapshot: Snapshot; firstRun: boolean; ptt: boolean; speed?: 0.8 | 1 | 1.2; readBack?: boolean
    /** auto language: Prisma listens with indic-auto and replies follow the language just spoken
     *  (`lang` is then only the starting/last language) */
    auto?: boolean
    /** the previous session's state (open question, conversation), from its last turn_done */
    resume?: string
    /** a turn whose result never arrived because the connection dropped: handle it again */
    resend?: string
  }
  | { type: 'speed'; speed: 0.8 | 1 | 1.2 }
  | { type: 'readback'; on: boolean }
  /** importing an old paper khata read aloud: every sentence becomes review rows, nothing is saved */
  | { type: 'import'; on: boolean }
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'ptt_start' }
  | { type: 'ptt_end' }
  | { type: 'tap'; action: 'yes' | 'no' | 'undo' }
  | { type: 'answer'; text: string } // tap answer to the open question (option text, udhaar/jama)
  | { type: 'text'; text: string } // typed (or pasted) instruction: same pipeline as speech
  | { type: 'barge' } // hands-free: the shopkeeper tapped to cut the reply short (does not switch to push-to-talk)
  | { type: 'playback_done' }
  | { type: 'ack'; seq: number } // these ops are written on the phone
  | { type: 'ping'; t: number } // heartbeat: the server answers pong at once
  | { type: 'replay_start' } // binary frames until replay_end are buffered speech from a dropped connection
  | { type: 'replay_end' }

/** A question the agent is waiting on (drives the confirm card on screen). */
export interface PendingView {
  kind: 'confirm' | 'name' | 'amount' | 'direction' | 'which' | 'confusable' | 'delete' | 'batch' | 'modify'
  /** confirm: saying yes also opens an account for this name (it is not in the ledger yet) */
  newCustomer?: boolean
  /** batch: one line per entry ("Ramesh ₹200"); modify: true when the change removes the entry */
  remove?: boolean
  name?: string
  paise?: number
  direction?: Direction | null
  options?: string[]
  /** batch read-back: every line with its own direction; one yes saves them all */
  rows?: { name: string; paise: number; direction: Direction; newCustomer?: boolean }[]
}

export interface TurnMetrics {
  /** ms timestamps relative to the end of speech (energy-detected), negative = before */
  speechMs: number
  commitAt: number | null
  finalAt: number
  parseMs: number
  path: 'fast' | 'llm' | 'none'
  llmMs?: number
  firstAudioAt: number | null
  earlyCommit: boolean
  snrDb: number | null
  /** the "heard you" cue, ms after the end of speech */
  heardAt?: number | null
  replyChars?: number
  /** length of the spoken reply */
  replyAudioMs?: number
  /** reply came from the fixed-phrase audio cache */
  cached?: boolean
}

export type ServerMsg =
  | { type: 'ready'; region: string }
  | { type: 'heard' } // the shopkeeper paused after speaking: a tick on the phone, before the reply
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }
  | { type: 'ops'; ops: LedgerOp[]; seq?: number }
  | { type: 'pong'; t: number }
  | { type: 'say'; text: string } // audio follows as binary PCM 16 kHz s16le
  | { type: 'lang'; lang: Lang } // the shopkeeper spoke another language: the session switched to it
  | { type: 'audio_end' }
  | { type: 'duck' } // user started speaking over the agent: lower volume
  | { type: 'unduck' } // false alarm: restore volume
  | { type: 'stop_audio' } // real barge-in: stop playback now
  | { type: 'pending'; pending: PendingView | null }
  | { type: 'show'; view: 'customer'; cid: string } | { type: 'show'; view: 'dues' | 'summary' | 'privacy' }
  | { type: 'remind'; cid: string; text: string }
  /** import mode: "name amount" pairs heard in one sentence, for the phone's review table */
  | { type: 'import_rows'; rows: ImportRow[]; text: string }
  | { type: 'metrics'; turn: TurnMetrics }
  | { type: 'error'; message: string }
  /** every handled turn ends with this, spoken reply or not: the phone leaves 'thinking' */
  | { type: 'turn_done'; resume?: string }
  /** heard, and taken as talk to someone else: nothing written, nothing asked (the phone shows it dimmed) */
  | { type: 'not_entry'; text: string }
