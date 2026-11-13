import { afterEach, describe, expect, it, vi } from 'vitest'
import { BACKUP_ID_KEY, createBackupClient, decryptRecords, encryptRecords } from './backup.js'

const records = [{ cid: 'c1', name: 'Ramesh Kumar', paise: 12500, note: 'secret-note-xyz' }, { n: 2 }]

describe('backup crypto', () => {
  it('round trips', async () => {
    const blob = await encryptRecords('1234', records)
    expect(await decryptRecords('1234', blob)).toEqual(records)
  })
  it('wrong PIN throws a clear error', async () => {
    const blob = await encryptRecords('1234', records)
    await expect(decryptRecords('9999', blob)).rejects.toThrow(/wrong pin/i)
  })
  it('blob has the expected shape and no plaintext', async () => {
    const blob = await encryptRecords('1234', records)
    const o = JSON.parse(blob)
    expect(o.v).toBe(1)
    expect(Object.keys(o).sort()).toEqual(['ct', 'iv', 'salt', 'v'])
    expect(blob).not.toContain('Ramesh')
    expect(blob).not.toContain('secret-note-xyz')
    expect(atob(o.ct)).not.toContain('Ramesh')
    expect(atob(o.salt)).toHaveLength(16)
  })
  it('salt and iv differ per backup', async () => {
    const a = JSON.parse(await encryptRecords('1234', records))
    const b = JSON.parse(await encryptRecords('1234', records))
    expect(a.salt).not.toBe(b.salt)
    expect(a.iv).not.toBe(b.iv)
    expect(a.ct).not.toBe(b.ct)
  })
  it('rejects tampered or malformed blobs', async () => {
    const o = JSON.parse(await encryptRecords('1234', records))
    const ct = Uint8Array.from(atob(o.ct), (c) => c.charCodeAt(0))
    ct[0] ^= 1
    o.ct = btoa(String.fromCharCode(...ct))
    await expect(decryptRecords('1234', JSON.stringify(o))).rejects.toThrow()
    await expect(decryptRecords('1234', 'not json')).rejects.toThrow(/damaged/)
  })
})

describe('backup id reuse and delete', () => {
  const mem = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }
  }
  afterEach(() => vi.unstubAllGlobals())

  it('first backup creates, later ones update the same id, delete clears it', async () => {
    const calls: { method: string; url: string; body?: string }[] = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', url, body: init?.body as string | undefined })
      return new Response(JSON.stringify({ id: 'a'.repeat(32) }), { status: 200 })
    })
    const st = mem()
    const c = createBackupClient('', st)
    await c.backup('1234', [{ n: 1 }])
    expect(JSON.parse(calls[0].body!).id).toBeUndefined()
    expect(st.m.get(BACKUP_ID_KEY)).toBe('a'.repeat(32))
    await c.backup('1234', [{ n: 2 }])
    expect(JSON.parse(calls[1].body!).id).toBe('a'.repeat(32))
    await c.deleteBackup()
    expect(calls[2]).toMatchObject({ method: 'DELETE', url: '/api/backup?id=' + 'a'.repeat(32) })
    expect(st.m.has(BACKUP_ID_KEY)).toBe(false)
    await c.deleteBackup() // nothing stored: no request
    expect(calls).toHaveLength(3)
  })

  it('falls back to a new row when the stored id is gone (404)', async () => {
    let n = 0
    vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => {
      n++
      const hasId = JSON.parse(init!.body as string).id
      return hasId ? new Response('{}', { status: 404 }) : new Response(JSON.stringify({ id: 'b'.repeat(32) }), { status: 200 })
    })
    const st = mem()
    st.setItem(BACKUP_ID_KEY, 'c'.repeat(32))
    const r = await createBackupClient('', st).backup('1234', [])
    expect(r.id).toBe('b'.repeat(32))
    expect(n).toBe(2)
    expect(st.m.get(BACKUP_ID_KEY)).toBe('b'.repeat(32))
  })

  it('failed delete keeps the id', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 500 }))
    const st = mem()
    st.setItem(BACKUP_ID_KEY, 'c'.repeat(32))
    await expect(createBackupClient('', st).deleteBackup()).rejects.toThrow()
    expect(st.m.has(BACKUP_ID_KEY)).toBe(true)
  })
})
