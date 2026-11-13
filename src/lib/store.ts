/**
 * KhataStore: encrypted, hash-chained, event-sourced ledger on the phone.
 * Persistence is behind a small interface so tests run without a browser.
 */
import {
  apply, balance, daySummary, dayFromOffset, emptyLedger, lastEntry, monthSummary, reduce, typicalAmount,
  type LedgerEvent, type LedgerState,
} from '../../shared/ledger.js'
import {
  keyIdFor, memoryKeyStore, open, seal, shred, verifyChain, type ChainRecord, type KeyStore,
} from '../../shared/chain.js'
import type { LedgerOp, Snapshot } from '../../shared/protocol.js'
import type { KhataStore, Settings } from './contracts.js'

export interface Persistence {
  loadRecords(): Promise<ChainRecord[]>
  appendRecord(r: ChainRecord): Promise<void>
  clearRecords(): Promise<void>
  keys: KeyStore
  loadSettings(): Promise<Partial<Settings> | undefined>
  saveSettings(s: Settings): Promise<void>
}

export const defaultSettings = (): Settings => ({
  lang: null, shopName: 'Meri Dukaan', firstRunDone: false, handsFree: true, showLatency: false,
})

// ------------------------------------------------------------------ memory persistence (tests)
export function memoryPersistence(): Persistence & { records: ChainRecord[] } {
  const records: ChainRecord[] = []
  let settings: Settings | undefined
  return {
    records,
    keys: memoryKeyStore(),
    async loadRecords() {
      return records.map((r) => ({ ...r }))
    },
    async appendRecord(r) {
      records.push({ ...r })
    },
    async clearRecords() {
      records.length = 0
    },
    async loadSettings() {
      return settings ? { ...settings } : undefined
    },
    async saveSettings(s) {
      settings = { ...s }
    },
  }
}

// ------------------------------------------------------------------ IndexedDB persistence (browser)
const DB_NAME = 'voice-khata'

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
    tx.onabort = () => rej(tx.error)
  })
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1)
    r.onupgradeneeded = () => {
      const db = r.result
      if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'seq' })
      if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys')
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')
    }
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}

export function idbPersistence(): Persistence {
  let dbp: Promise<IDBDatabase> | undefined
  const db = () => (dbp ??= openDb())
  const run = async <T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const tx = (await db()).transaction(store, mode)
    const done = txDone(tx)
    const out = await req(fn(tx.objectStore(store)))
    await done
    return out
  }
  const keys: KeyStore = {
    get: (id) => run<CryptoKey | undefined>('keys', 'readonly', (s) => s.get(id)),
    async create(id) {
      const k = await globalThis.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
      await run('keys', 'readwrite', (s) => s.put(k, id))
      return k
    },
    async delete(id) {
      await run('keys', 'readwrite', (s) => s.delete(id))
    },
  }
  return {
    keys,
    async loadRecords() {
      const all = await run<ChainRecord[]>('records', 'readonly', (s) => s.getAll())
      return all.sort((a, b) => a.seq - b.seq)
    },
    async appendRecord(r) {
      await run('records', 'readwrite', (s) => s.add(r))
    },
    async clearRecords() {
      await run('records', 'readwrite', (s) => s.clear())
      await run('keys', 'readwrite', (s) => s.clear()) // belt and braces: no orphan keys survive a wipe
    },
    loadSettings: () => run<Partial<Settings> | undefined>('meta', 'readonly', (s) => s.get('settings')),
    async saveSettings(s) {
      await run('meta', 'readwrite', (m) => m.put(s, 'settings'))
    },
  }
}

// ------------------------------------------------------------------ the store
export async function createStore(p: Persistence): Promise<KhataStore> {
  let records = await p.loadRecords()
  let settings: Settings = { ...defaultSettings(), ...(await p.loadSettings()) }
  const listeners = new Set<() => void>()
  let queue: Promise<unknown> = Promise.resolve()

  const rebuild = async (): Promise<LedgerState> => {
    const evs: { ev: LedgerEvent; ts: number }[] = []
    for (const r of records) {
      const ev = await open(r, p.keys).catch(() => null)
      if (ev) evs.push({ ev, ts: r.ts })
    }
    return reduce(evs)
  }

  let state: LedgerState = await rebuild()

  const notify = () => {
    state = { ...state }
    for (const fn of [...listeners]) fn()
  }
  /** Serialize mutations so the chain can never fork. */
  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn)
    queue = run.catch(() => undefined)
    return run
  }

  const append = async (evs: LedgerEvent[]) => {
    for (const ev of evs) {
      const keyId = keyIdFor(ev, (eid) => state.entries.get(eid)?.cid)
      const rec = await seal(ev, keyId, p.keys, records[records.length - 1])
      await p.appendRecord(rec)
      records.push(rec)
      apply(state, ev, rec.ts)
    }
    notify()
  }

  const wipe = async () => {
    const ids = new Set(records.map((r) => r.keyId))
    await p.clearRecords()
    for (const id of ids) await shred(id, p.keys)
    records = []
    state = emptyLedger()
  }

  const opToEvent = (o: LedgerOp): LedgerEvent | 'delete_all' => {
    switch (o.op) {
      case 'add_customer': return { type: 'customer_added', cid: o.cid, name: o.name, aliases: [] }
      case 'add_alias': return { type: 'alias_added', cid: o.cid, alias: o.alias }
      case 'entry':
        return {
          type: 'entry', eid: o.eid, cid: o.cid, paise: o.paise, direction: o.direction,
          day: dayFromOffset(o.dayOffset), promise: o.promise, source: o.source,
        }
      case 'amend': {
        const ev: LedgerEvent = { type: 'entry_amended', eid: o.eid }
        if (o.paise !== undefined) ev.paise = o.paise
        if (o.direction) ev.direction = o.direction
        if (o.cid) ev.cid = o.cid
        return ev
      }
      case 'void': return { type: 'entry_voided', eid: o.eid, reason: o.reason }
      case 'delete_all': return 'delete_all'
    }
  }

  const deleteAll = () =>
    enqueue(async () => {
      await wipe()
      settings = { ...defaultSettings(), lang: settings.lang, shopName: settings.shopName }
      await p.saveSettings(settings)
      notify()
    })

  const store: KhataStore = {
    get state() {
      return state
    },
    get settings() {
      return settings
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => void listeners.delete(fn)
    },
    applyOps(ops) {
      return enqueue(async () => {
        for (const o of ops) {
          const ev = opToEvent(o)
          if (ev === 'delete_all') {
            await wipe()
            notify()
          } else await append([ev])
        }
      })
    },
    voidEntry: (eid, reason) => enqueue(() => append([{ type: 'entry_voided', eid, reason }])),
    setConsent: (cid, c) => enqueue(() => append([{ type: 'consent', cid, ...c }])),
    addAlias: (cid, alias) => enqueue(() => append([{ type: 'alias_added', cid, alias }])),
    setHousehold: (cid, householdId) => enqueue(() => append([{ type: 'household_set', cid, householdId }])),
    setConfirmation: (eid, status) => enqueue(() => append([{ type: 'confirmation', eid, status }])),
    forgetCustomer: (cid) =>
      enqueue(async () => {
        await shred(cid, p.keys)
        state = await rebuild()
        notify()
      }),
    deleteAll,
    updateSettings: (patch) =>
      enqueue(async () => {
        settings = { ...settings, ...patch }
        await p.saveSettings(settings)
        notify()
      }),
    snapshot(): Snapshot {
      const now = new Date()
      const today = daySummary(state, dayFromOffset(0, now))
      const month = monthSummary(state, dayFromOffset(0, now).slice(0, 7))
      const last = lastEntry(state)
      const pick = (s: { creditPaise: number; paymentPaise: number; entries: number }) => ({
        creditPaise: s.creditPaise, paymentPaise: s.paymentPaise, entries: s.entries,
      })
      return {
        shopName: settings.shopName,
        customers: [...state.customers.values()].map((c) => ({
          cid: c.cid, name: c.name, aliases: [...c.aliases], householdId: c.householdId,
          remindersOptIn: c.remindersOptIn, adult: c.adult,
          balancePaise: balance(state, c.cid), typicalPaise: typicalAmount(state, c.cid),
        })),
        last: last ? { eid: last.eid, cid: last.cid, paise: last.paise, direction: last.direction, day: last.day } : null,
        today: pick(today),
        month: pick(month),
      }
    },
    async verify() {
      const r = await verifyChain(records)
      return { ok: r.ok, records: records.length, ...(r.brokenAt !== undefined ? { brokenAt: r.brokenAt } : {}) }
    },
    /** Decrypted events for the PIN-locked backup (per-customer keys never leave this phone). */
    async exportRecords() {
      const out: { ev: LedgerEvent; ts: number }[] = []
      for (const r of records) {
        const ev = await open(r, p.keys).catch(() => null)
        if (ev) out.push({ ev, ts: r.ts })
      }
      return out
    },
    /** Restore: replace everything with these events, re-sealed into a fresh chain with fresh keys. */
    importRecords(items) {
      return enqueue(async () => {
        await wipe()
        for (const it of items as { ev: LedgerEvent; ts: number }[]) {
          if (!it || typeof it !== 'object' || !it.ev || typeof it.ev.type !== 'string') throw new Error('bad backup')
          const keyId = keyIdFor(it.ev, (eid) => state.entries.get(eid)?.cid)
          const rec = await seal(it.ev, keyId, p.keys, records[records.length - 1], it.ts)
          await p.appendRecord(rec)
          records.push(rec)
          apply(state, it.ev, rec.ts)
        }
        notify()
      })
    },
    async exportReadable() {
      const chain = await store.verify()
      return JSON.stringify({
        exportedAt: new Date().toISOString(),
        shopName: settings.shopName,
        customers: [...state.customers.values()],
        entries: state.order.map((id) => state.entries.get(id)).filter(Boolean),
        chain,
      }, null, 2)
    },
  }
  return store
}
