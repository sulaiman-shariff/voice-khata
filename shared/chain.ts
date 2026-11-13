/**
 * Tamper-evident, encrypted event log with per-customer crypto-shredding.
 *
 * Each record stores its payload encrypted (AES-GCM) under a key that belongs either to one
 * customer or to the shop. The SHA-256 hash chain covers the CIPHERTEXT plus metadata, never
 * the plaintext. So:
 *   - editing or deleting any record breaks verification (tamper-evident), and
 *   - forgetting a customer = deleting their key. Their records become unreadable, yet the
 *     chain still verifies, because the ciphertext it hashed is untouched (DPDP erasure).
 *
 * Uses WebCrypto only (globalThis.crypto.subtle): same code in the browser and in Node 20+.
 */
import type { LedgerEvent } from './ledger.js'

const subtle = globalThis.crypto.subtle
const enc = new TextEncoder()
const dec = new TextDecoder()

export interface ChainRecord {
  seq: number
  ts: number
  keyId: string // 'shop' or a customer id
  iv: string // base64
  ct: string // base64 ciphertext of the JSON event
  prev: string // hex hash of previous record ('' for the first)
  hash: string // hex sha256(seq|ts|keyId|iv|ct|prev)
}

const b64 = (u: Uint8Array) => {
  let s = ''
  for (const b of u) s += String.fromCharCode(b)
  return btoa(s)
}
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

export async function recordHash(r: Omit<ChainRecord, 'hash'>): Promise<string> {
  const material = `${r.seq}|${r.ts}|${r.keyId}|${r.iv}|${r.ct}|${r.prev}`
  return hex(await subtle.digest('SHA-256', enc.encode(material)))
}

/** Key store abstraction: the browser backs it with IndexedDB (non-extractable keys). */
export interface KeyStore {
  get(keyId: string): Promise<CryptoKey | undefined>
  create(keyId: string): Promise<CryptoKey>
  delete(keyId: string): Promise<void>
}

export function memoryKeyStore(extractable = false): KeyStore {
  const m = new Map<string, CryptoKey>()
  return {
    async get(id) {
      return m.get(id)
    },
    async create(id) {
      const k = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt'])
      m.set(id, k)
      return k
    },
    async delete(id) {
      m.delete(id)
    },
  }
}

/** Which key protects an event: customer-scoped events use that customer's key. */
export function keyIdFor(ev: LedgerEvent, entryOwner: (eid: string) => string | undefined): string {
  if ('cid' in ev && ev.cid) return ev.cid
  if ('eid' in ev) return entryOwner(ev.eid) ?? 'shop'
  return 'shop'
}

export async function seal(
  ev: LedgerEvent, keyId: string, keys: KeyStore, prev: ChainRecord | undefined, ts = Date.now(),
): Promise<ChainRecord> {
  const key = (await keys.get(keyId)) ?? (await keys.create(keyId))
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(ev))))
  const base = { seq: prev ? prev.seq + 1 : 0, ts, keyId, iv: b64(iv), ct: b64(ct), prev: prev?.hash ?? '' }
  return { ...base, hash: await recordHash(base) }
}

/** Decrypt a record; returns null if its key was shredded. */
export async function open(r: ChainRecord, keys: KeyStore): Promise<LedgerEvent | null> {
  const key = await keys.get(r.keyId)
  if (!key) return null
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(r.iv) }, key, unb64(r.ct))
  return JSON.parse(dec.decode(pt)) as LedgerEvent
}

export interface VerifyResult {
  ok: boolean
  brokenAt?: number // seq of the first bad record
  reason?: string
}

/** Verify the whole chain: hashes, links and sequence. Needs no keys at all. */
export async function verifyChain(records: ChainRecord[]): Promise<VerifyResult> {
  let prev = ''
  for (let i = 0; i < records.length; i++) {
    const r = records[i]
    if (r.seq !== i) return { ok: false, brokenAt: i, reason: 'sequence gap' }
    if (r.prev !== prev) return { ok: false, brokenAt: r.seq, reason: 'broken link' }
    const { hash, ...rest } = r
    if ((await recordHash(rest)) !== hash) return { ok: false, brokenAt: r.seq, reason: 'hash mismatch' }
    prev = hash
  }
  return { ok: true }
}

/** Crypto-shred: forget a customer by destroying their key. The chain is untouched. */
export async function shred(cid: string, keys: KeyStore): Promise<void> {
  await keys.delete(cid)
}
