import type { BackupClient } from './contracts.js'

const ITER = 310_000
const enc = new TextEncoder()
const dec = new TextDecoder()

const b64 = (u: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function deriveKey(pin: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export async function encryptRecords(pin: string, records: unknown[]): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(pin, salt)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(records))))
  return JSON.stringify({ v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct) })
}

export async function decryptRecords(pin: string, blob: string): Promise<unknown[]> {
  let o: { v: number; salt: string; iv: string; ct: string }
  try {
    o = JSON.parse(blob)
    if (o.v !== 1) throw new Error('version')
  } catch {
    throw new Error('Backup data is damaged or in an unknown format')
  }
  const key = await deriveKey(pin, unb64(o.salt))
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, key, unb64(o.ct))
    return JSON.parse(dec.decode(pt)) as unknown[]
  } catch {
    throw new Error('Wrong PIN, or the backup is damaged')
  }
}

export const BACKUP_ID_KEY = 'khata.backupId'
export interface IdStorage {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
  removeItem(k: string): void
}
const defaultStorage = (): IdStorage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function createBackupClient(base = '', storage: IdStorage | null = defaultStorage()): BackupClient {
  const getId = () => {
    try {
      return storage?.getItem(BACKUP_ID_KEY) || null
    } catch {
      return null
    }
  }
  const setId = (id: string | null) => {
    try {
      if (id) storage?.setItem(BACKUP_ID_KEY, id)
      else storage?.removeItem(BACKUP_ID_KEY)
    } catch {
      /* storage blocked: the next backup just creates a new row */
    }
  }
  const call = async (path: string, init?: RequestInit) => {
    const res = await fetch(base + path, init)
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return { res, data }
  }
  const post = (path: string, body: unknown) => call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return {
    async backup(pin, records) {
      const blob = await encryptRecords(pin, records)
      const known = getId()
      let { res, data } = await post('/api/backup', known ? { id: known, blob } : { blob })
      if (res.status === 404 && known) {
        // the stored row is gone (deleted elsewhere): start a fresh one
        setId(null)
        ;({ res, data } = await post('/api/backup', { blob }))
      }
      if (!res.ok) throw new Error(`Backup failed (${res.status})`)
      const id = data.id as string
      setId(id)
      return { id, bytes: blob.length }
    },
    async deleteBackup() {
      const id = getId()
      if (!id) return
      const { res } = await call(`/api/backup?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`Could not delete backup (${res.status})`)
      setId(null)
    },
    async restore(id, pin) {
      const { res, data } = await call(`/api/backup?id=${encodeURIComponent(id)}`)
      if (res.status === 404) throw new Error('No backup found for this id')
      if (!res.ok) throw new Error(`Restore failed (${res.status})`)
      return decryptRecords(pin, data.blob as string)
    },
    async createConfirmLink(e) {
      const { res, data } = await post('/api/confirm', { shop: e.shopName, paise: e.paise, direction: e.direction, day: e.day, lang: e.lang })
      if (!res.ok) throw new Error(`Could not create link (${res.status})`)
      const token = data.token as string
      return { token, url: `${location.origin}/c/${token}` }
    },
    async confirmStatus(token) {
      const { res, data } = await call(`/api/confirm?token=${encodeURIComponent(token)}`)
      if (res.status === 410 || res.status === 404) return 'expired'
      if (!res.ok) throw new Error(`Status check failed (${res.status})`)
      return data.status as 'pending' | 'confirmed' | 'disputed'
    },
  }
}
