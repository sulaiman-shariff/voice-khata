/**
 * Interfaces between the UI and the parts built separately (store, voice client, backup).
 * Implementations: src/lib/store.ts, src/lib/voice.ts, src/lib/backup.ts.
 */
import type { Customer, Entry, LedgerState } from '../../shared/ledger.js'
import type { LedgerOp, PendingView, ServerMsg, Snapshot, TurnMetrics } from '../../shared/protocol.js'
import type { Lang } from '../../shared/replies.js'

// ------------------------------------------------------------------ store (src/lib/store.ts)
export interface Settings {
  lang: Lang | null // null until the language tile is picked
  shopName: string
  firstRunDone: boolean // AI disclosure already spoken
  handsFree: boolean // true: open mic with server end-of-turn; false: push-to-talk only
  showLatency: boolean
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
  setConsent(cid: string, c: { remindersOptIn: boolean; adult: boolean; phone?: string }): Promise<void>
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
export type { Customer, Entry, LedgerState }

// ------------------------------------------------------------------ voice client (src/lib/voice.ts)
export type VoiceStatus = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'offline'

export interface VoiceEvents {
  status(s: VoiceStatus): void
  /** Mic input level 0..1, ~30 Hz, for the mic animation. */
  level(v: number): void
  partial(text: string): void
  final(text: string): void
  say(text: string): void
  ops(ops: LedgerOp[]): void
  pending(p: PendingView | null): void
  show(m: Extract<ServerMsg, { type: 'show' }>): void
  remind(cid: string, text: string): void
  metrics(m: TurnMetrics & { clientFirstAudioMs: number | null }): void
  error(message: string): void
}

export interface VoiceClient {
  /** Ask mic permission + open the socket. Must be called from a user gesture (audio unlock). */
  start(opts: { lang: Lang; snapshot: () => Snapshot; firstRun: boolean; handsFree: boolean }): Promise<void>
  stop(): void
  /** Push-to-talk (works in both modes). */
  pttDown(): void
  pttUp(): void
  tap(action: 'yes' | 'no' | 'undo'): void
  /** Tap answer to an open question: 'udhaar' / 'jama' / an option's text. */
  answer(text: string): void
  /** Send a fresh snapshot after local (non-voice) ledger changes. */
  sendSnapshot(): void
  setHandsFree(on: boolean): void
}

// ------------------------------------------------------------------ backup + confirm links (src/lib/backup.ts)
export interface BackupClient {
  /** Encrypt records with a key derived from the PIN (PBKDF2) and upload; returns backup id. */
  backup(pin: string, records: unknown[]): Promise<{ id: string; bytes: number }>
  restore(id: string, pin: string): Promise<unknown[]>
  /** Create a customer confirmation link (no customer name/phone leaves the phone). */
  createConfirmLink(e: { eid: string; shopName: string; paise: number; direction: 'credit' | 'payment'; day: string; lang: Lang }): Promise<{ token: string; url: string }>
  /** Poll the customer's answer. */
  confirmStatus(token: string): Promise<'pending' | 'confirmed' | 'disputed' | 'expired'>
}
