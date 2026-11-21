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
  phone?: string
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
  /** Every live entry (voided excluded), newest first: the agent answers and changes from this. Memory only on the server. */
  entries: SnapEntry[]
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
  /** the customer's display name changes (a misheard or fuller name) */
  | { op: 'rename_customer'; cid: string; name: string }
  /** two accounts are one person: `from`'s entries move to `into`, `from`'s names become aliases, `from` is gone */
  | { op: 'merge_customers'; from: string; into: string }
  | { op: 'set_phone'; cid: string; phone: string }

export type ClientMsg =
  | {
    type: 'hello'; lang: Lang; snapshot: Snapshot; firstRun: boolean; ptt: boolean; speed?: 0.8 | 1 | 1.2
    /** the previous session's state (open question, conversation), from its last turn_done */
    resume?: string
    /** a turn whose result never arrived because the connection dropped: handle it again */
    resend?: string
  }
  | { type: 'speed'; speed: 0.8 | 1 | 1.2 }
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'ptt_start' }
  | { type: 'ptt_end' }
  /** the phone woke the app: tap, hold (until hold_end), or its on-device wake-word detector */
  | { type: 'wake'; source: 'tap' | 'hold' | 'phone' }
  | { type: 'hold_end' }
  /** the user tapped to put it to sleep */
  | { type: 'sleep' }
  | { type: 'tap'; action: 'yes' | 'no' | 'undo' }
  | { type: 'answer'; text: string } // tap answer to the open question (option text, udhaar/jama)
  | { type: 'text'; text: string } // typed (or pasted) instruction: same pipeline as speech
  | { type: 'barge' } // hands-free: the shopkeeper tapped to cut the reply short (does not switch to push-to-talk)
  | { type: 'playback_done' }
  | { type: 'ack'; seq: number } // these ops are written on the phone
  | { type: 'ping'; t: number } // heartbeat: the server answers pong at once
  | { type: 'replay_start' } // binary frames until replay_end are buffered speech from a dropped connection
  | { type: 'replay_end' }
  /** "Save anyway" on a dimmed not-an-entry line: handled as addressed to the agent, never not_for_me */
  | { type: 'force'; text: string }

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
  /** amount: the amounts to choose from (rupees), shown as buttons */
  amounts?: number[]
  /** delete: only typing this word (an answer / typed text) erases; a spoken or tapped yes never does */
  requireType?: string
}

/** A setting the agent changed by voice; the phone applies and stores it. */
export interface SettingMsg { type: 'setting'; key: 'lang' | 'speed' | 'shopName'; value: unknown }

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
  /** attention state: sent after every hello and on each change */
  | { type: 'attention'; state: 'asleep' | 'awake' }
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
  | { type: 'show'; view: 'customer'; cid: string } | { type: 'show'; view: 'dues' | 'summary' | 'privacy' | 'today' | 'settings' | 'close' }
  | { type: 'show'; view: 'top_debtors'; count?: number }
  /** entries between two days (YYYY-MM-DD, inclusive) */
  | { type: 'show'; view: 'history'; from: string; to: string; cid?: string }
  | { type: 'show'; view: 'search'; text: string; cids?: string[]; eids?: string[] }
  | SettingMsg
  /** one big button on the phone: open WhatsApp with `text` (to `cid`'s number) or start the backup */
  | { type: 'ready'; kind: 'whatsapp' | 'backup'; cid?: string; text?: string }
  | { type: 'metrics'; turn: TurnMetrics }
  | { type: 'error'; message: string }
  /** every handled turn ends with this, spoken reply or not: the phone leaves 'thinking' */
  | { type: 'turn_done'; resume?: string }
  /** heard, and taken as talk to someone else: nothing written, nothing asked (the phone shows it dimmed) */
  | { type: 'not_entry'; text: string }
  /** the agent woke (wake word, tap) or went back to sleep (idle timeout) */
  | { type: 'attention'; state: 'asleep' | 'awake' }
  /** a setting changed by voice: the phone applies it */
  | SettingMsg
