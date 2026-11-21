/**
 * Interfaces between the UI and the parts built separately (store, voice client, backup).
 * Implementations: src/lib/store.ts, src/lib/voice.ts, src/lib/backup.ts.
 */
import type { CashCategory, Customer, Entry, LedgerState, PartyKind } from '../../shared/ledger.js'
import type { LedgerOp, PendingView, ServerMsg, SettingMsg, Snapshot, TurnMetrics } from '../../shared/protocol.js'
import type { Lang } from '../../shared/replies.js'

// ------------------------------------------------------------------ store (src/lib/store.ts)
export interface Settings {
  lang: Lang | null // null until the language tile is picked; with autoLang, the language last spoken
  /** auto language (default): listen for any supported language, reply in the one just spoken */
  autoLang?: boolean
  shopName: string
  firstRunDone: boolean // AI disclosure already spoken
  handsFree: boolean // true: open mic with server end-of-turn; false: push-to-talk only
  showLatency: boolean
  /** replies at Timbre speed 1.2 instead of 1.0 (optional: older stored settings lack it) */
  fastSpeech?: boolean
  /** read every saved entry back in full instead of a short "noted" */
  readBackAll?: boolean
  /** shop profile from the sign-up step (sign-up shows until profileDone) */
  profileDone?: boolean
  /** the microphone-permission step has been shown (once) */
  micAsked?: boolean
  ownerName?: string
  shopAddress?: string
  shopPhone?: string
  /** the shop's UPI ID (name@bank): reminders carry a pay link to it */
  shopUpi?: string
  /** colour scheme (see THEMES in src/ui/theme.ts) */
  theme?: string
  /** WhatsApp reminders: send automatically to opted-in customers who owe, every N days */
  autoRemind?: boolean
  remindEveryDays?: number
  /** cid -> last reminder sent (ms) */
  reminded?: Record<string, number>
  /** how fast replies are spoken (Timbre speed); optional: older stored settings lack it (see createStore) */
  speed?: 0.8 | 1 | 1.2
  /** the day (YYYY-MM-DD) the morning briefing was last offered: it is offered once, on the first wake of a day */
  briefedDay?: string
  /** "Bolkar batao payment": speak payments as they land. Missing means on. */
  announcePayments?: boolean
}

export interface KhataStore {
  /** Current reduced ledger (re-read after every change). */
  readonly state: LedgerState
  readonly settings: Settings
  /** Subscribe to any change (ledger or settings). Returns unsubscribe. */
  subscribe(fn: () => void): () => void
  /** Apply ops from the voice server: seal each resulting event into the hash chain. */
  applyOps(ops: LedgerOp[]): Promise<void>
  /** Local UI actions. */
  voidEntry(eid: string, reason: string): Promise<void>
  /** Manual edit of any entry (amount, direction, customer, day). Recorded as an amendment, never overwritten. */
  amendEntry(eid: string, ch: { paise?: number; direction?: 'credit' | 'payment'; cid?: string; day?: string; due?: string | null }): Promise<void>
  /** A galla row (no customer). Returns its eid; amend / void it with amendEntry / voidEntry. */
  addCash(c: { paise: number; dir: 'in' | 'out'; category: CashCategory; note?: string; day?: string }): Promise<string>
  /** Save (or clear, with '') a customer's nickname; reminders consent and phone stay as they are. */
  setTag(cid: string, tag: string): Promise<void>
  /** Turn an account into a supplier account, or back. */
  setKind(cid: string, kind: PartyKind): Promise<void>
  /** Set (or replace) a customer's instalment plan; the first instalment defaults to one interval from today. */
  setPlan(cid: string, p: { totalPaise: number; parts: number; everyDays: number; startDay?: string }): Promise<void>
  /** End the customer's instalment plan (no-op if none). */
  cancelPlan(cid: string): Promise<void>
  addCustomer(name: string): Promise<string>
  setConsent(cid: string, c: { remindersOptIn: boolean; adult: boolean; phone?: string; tag?: string }): Promise<void>
  addAlias(cid: string, alias: string): Promise<void>
  setHousehold(cid: string, householdId: string | null): Promise<void>
  setConfirmation(eid: string, status: 'confirmed' | 'disputed'): Promise<void>
  /** Crypto-shred one customer: delete their key; their events become unreadable, chain still verifies. */
  forgetCustomer(cid: string): Promise<void>
  /** Wipe everything (records, keys, settings except lang). */
  deleteAll(): Promise<void>
  updateSettings(p: Partial<Settings>): Promise<void>
  /** Snapshot for the voice server (balances, typical amounts, last entry, today/month totals). */
  snapshot(): Snapshot
  /** Hash-chain check over all stored records (needs no keys). */
  verify(): Promise<{ ok: boolean; records: number; brokenAt?: number }>
  /** Decrypted events, for the PIN-encrypted backup (encrypted again before upload). */
  exportRecords(): Promise<unknown[]>
  /** Restore from a backup: replaces the ledger, re-sealed under fresh keys. */
  importRecords(items: unknown[]): Promise<void>
  /** Readable JSON export for the shopkeeper ("download my data"). */
  exportReadable(): Promise<string>
}
// helpers the UI uses
export type { CashCategory, Customer, Entry, LedgerState, PartyKind }

// ------------------------------------------------------------------ voice client (src/lib/voice.ts)
/** 'asleep': connected, waiting for "KhataBhai" or a tap. 'listening': awake. */
export type VoiceStatus = 'idle' | 'connecting' | 'asleep' | 'listening' | 'thinking' | 'speaking' | 'offline'

export interface VoiceEvents {
  status(s: VoiceStatus): void
  /** Mic input level 0..1, ~30 Hz, for the mic animation. */
  level(v: number): void
  partial(text: string): void
  final(text: string): void
  say(text: string): void
  /** apply these ops; resolve once they are written (the client then acknowledges them) */
  ops(ops: LedgerOp[]): void | Promise<void>
  pending(p: PendingView | null): void
  show(m: Extract<ServerMsg, { type: 'show' }>): void
  /** The agent changed a setting by voice (speed, shopName; the language goes through lang). */
  setting?(m: SettingMsg): void
  /** One-tap card from a tool: a WhatsApp message to send, or the backup. */
  ready?(m: Extract<ServerMsg, { type: 'ready'; kind: unknown }>): void
  metrics(m: TurnMetrics & { clientFirstAudioMs: number | null }): void
  error(message: string): void
  /** The server heard another language and switched the session to it. */
  lang?(l: Lang): void
  /** The shopkeeper paused after speaking: give instant feedback before the reply. */
  heard?(): void
  /** Connection quality: good, slow (replies will be late) or offline (nothing is saved). */
  network?(state: 'good' | 'slow' | 'offline'): void
  /** A turn lost to a dropped connection is being handled again in the new session. */
  resent?(text: string): void
  /** The last thing heard was taken as talk to someone else: nothing written, nothing asked. */
  notEntry?(text: string): void
  /** The agent woke or went back to sleep (server answer, or the optimistic local change after a tap). */
  attention?(state: 'asleep' | 'awake'): void
  /** The turn is over: the on-screen captions are stale. */
  turnDone?(): void
  /** The microphone could not be opened after a wake (permission refused, no device). */
  micError?(): void
}

export interface VoiceClient {
  /** Ask mic permission + open the socket (`mic: false`: socket only, for typed text; the mic opens on the first wake). Must be called from a user gesture (audio unlock). */
  start(opts: { lang: Lang; snapshot: () => Snapshot; firstRun: boolean; handsFree: boolean; speed?: 0.8 | 1 | 1.2; mic?: boolean }): Promise<void>
  stop(): void
  /** Push-to-talk (works in both modes). */
  pttDown(): void
  pttUp(): void
  tap(action: 'yes' | 'no' | 'undo'): void
  /** Tap answer to an open question: 'udhaar' / 'jama' / an option's text. */
  answer(text: string): void
  /** Typed or pasted instruction, handled exactly like speech (bulk lists welcome). */
  sendText(text: string): void
  /** "Save anyway": the line was dimmed as not-an-entry; handle it as addressed to the app. */
  force(text: string): void
  /** Send a fresh snapshot after local (non-voice) ledger changes. */
  sendSnapshot(): void
  setHandsFree(on: boolean): void
  setSpeed(speed: 0.8 | 1 | 1.2): void
  /** Hands-free tap to cut a reply short: stops local audio at once and tells the server (no push-to-talk). */
  bargeIn(): void
  /** Wake the agent without the wake word: a tap, or the button held (then call holdEnd). Opens the mic if it is not open yet. */
  wake(source: 'tap' | 'hold'): void
  /** The held button was released. */
  holdEnd(): void
  /** Tap while awake: show asleep now (the server also times out on its own). */
  sleep(): void
  /**
   * The soundbox: a payment that landed off the phone (QR, link) is in the ledger; the server says
   * it aloud. Returns false when the socket is not open (use speechSynthesis instead).
   */
  announce?(a: { kind: 'payment'; cid: string; paise: number; balancePaise?: number; partial?: boolean }): boolean
  /** Language changed in settings: continue the session in it, keep the mic on. */
  setLang(l: Lang): void
}

// ------------------------------------------------------------------ backup + confirm links (src/lib/backup.ts)
export interface BackupClient {
  /** Encrypt records with a key derived from the PIN (PBKDF2) and upload; returns backup id. */
  backup(pin: string, records: unknown[]): Promise<{ id: string; bytes: number }>
  restore(id: string, pin: string): Promise<unknown[]>
  /** Delete the stored cloud backup (id remembered from the last backup) and forget the id. No-op if none. Throws if the server refuses. */
  deleteBackup(): Promise<void>
  /** Create a customer confirmation link (no customer name/phone leaves the phone). */
  createConfirmLink(e: { eid: string; shopName: string; paise: number; direction: 'credit' | 'payment'; day: string; lang: Lang }): Promise<{ token: string; url: string }>
  /** Poll the customer's answer. */
  confirmStatus(token: string): Promise<'pending' | 'confirmed' | 'disputed' | 'expired'>
}
