/**
 * Messages between the phone (client) and the voice function (server).
 * The ledger lives on the phone; the server is stateless across connections and works from
 * the snapshot the phone sends, replying with ledger ops for the phone to apply.
 */
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
  | { type: 'hello'; lang: Lang; snapshot: Snapshot; firstRun: boolean; ptt: boolean; speed?: 0.8 | 1 | 1.2 }
  | { type: 'speed'; speed: 0.8 | 1 | 1.2 }
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'ptt_start' }
  | { type: 'ptt_end' }
  | { type: 'tap'; action: 'yes' | 'no' | 'undo' }
  | { type: 'answer'; text: string } // tap answer to the open question (option text, udhaar/jama)
  | { type: 'text'; text: string } // typed (or pasted) instruction: same pipeline as speech
  | { type: 'barge' } // hands-free: the shopkeeper tapped to cut the reply short (does not switch to push-to-talk)
  | { type: 'playback_done' }

/** A question the agent is waiting on (drives the confirm card on screen). */
export interface PendingView {
  kind: 'confirm' | 'name' | 'direction' | 'which' | 'confusable' | 'delete' | 'batch' | 'modify'
  /** batch: one line per entry ("Ramesh ₹200"); modify: true when the change removes the entry */
  remove?: boolean
  name?: string
  paise?: number
  direction?: Direction | null
  options?: string[]
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
}

export type ServerMsg =
  | { type: 'ready'; region: string }
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }
  | { type: 'ops'; ops: LedgerOp[] }
  | { type: 'say'; text: string } // audio follows as binary PCM 16 kHz s16le
  | { type: 'lang'; lang: Lang } // the shopkeeper spoke another language: the session switched to it
  | { type: 'audio_end' }
  | { type: 'duck' } // user started speaking over the agent: lower volume
  | { type: 'unduck' } // false alarm: restore volume
  | { type: 'stop_audio' } // real barge-in: stop playback now
  | { type: 'pending'; pending: PendingView | null }
  | { type: 'show'; view: 'customer'; cid: string } | { type: 'show'; view: 'dues' | 'summary' | 'privacy' }
  | { type: 'remind'; cid: string; text: string }
  | { type: 'metrics'; turn: TurnMetrics }
  | { type: 'error'; message: string }
  /** every handled turn ends with this, spoken reply or not: the phone leaves 'thinking' */
  | { type: 'turn_done' }
