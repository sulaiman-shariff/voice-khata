/**
 * Cloud backup: PIN-encrypted on the phone; the server only ever sees ciphertext.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BACKUP_ID_KEY, createBackupClient, decryptRecords, encryptRecords } from './backup.js'

const records = [{ cid: 'c1', name: 'Ramesh Kumar', paise: 12500, note: 'secret-note-xyz' }, { n: 2 }]

describe('backup crypto', () => {
  it('round trips with the right PIN; the blob holds no plaintext', async () => {
    const blob = await encryptRecords('1234', records)
    expect(await decryptRecords('1234', blob)).toEqual(records)
    expect(blob).not.toContain('Ramesh')
    expect(blob).not.toContain('secret-note-xyz')
  })

  it('a wrong PIN fails with a clear error', async () => {
    await expect(decryptRecords('9999', await encryptRecords('1234', records))).rejects.toThrow(/wrong pin/i)
  })

  it('a tampered or damaged blob is rejected', async () => {
    const o = JSON.parse(await encryptRecords('1234', records))
    const ct = Uint8Array.from(atob(o.ct), (c) => c.charCodeAt(0))
    ct[0] ^= 1
    o.ct = btoa(String.fromCharCode(...ct))
    await expect(decryptRecords('1234', JSON.stringify(o))).rejects.toThrow()
    await expect(decryptRecords('1234', 'not json')).rejects.toThrow(/damaged/)
  })

  it('the same data and PIN never give the same blob (fresh salt and IV)', async () => {
    expect(await encryptRecords('1234', records)).not.toBe(await encryptRecords('1234', records))
  })
})

describe('backup client', () => {
  const mem = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }
  }
  afterEach(() => vi.unstubAllGlobals())

  it('updates one backup row instead of piling up copies; delete removes it on the server', async () => {
    const calls: { method: string; url: string; body?: string }[] = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', url, body: init?.body as string | undefined })
      return new Response(JSON.stringify({ id: 'a'.repeat(32) }), { status: 200 })
    })
    const st = mem()
    const c = createBackupClient('', st)
    await c.backup('1234', [{ n: 1 }])
    await c.backup('1234', [{ n: 2 }])
    expect(JSON.parse(calls[1].body!).id).toBe('a'.repeat(32))
    await c.deleteBackup()
    expect(calls[2]).toMatchObject({ method: 'DELETE', url: '/api/backup?id=' + 'a'.repeat(32) })
    expect(st.m.has(BACKUP_ID_KEY)).toBe(false)
  })

  it('a failed delete keeps the id so it can be retried', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 500 }))
    const st = mem()
    st.setItem(BACKUP_ID_KEY, 'c'.repeat(32))
    await expect(createBackupClient('', st).deleteBackup()).rejects.toThrow()
    expect(st.m.has(BACKUP_ID_KEY)).toBe(true)
  })

  it('a backup row gone from the server (404) is re-created, not lost', async () => {
    vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) =>
      JSON.parse(init!.body as string).id ? new Response('{}', { status: 404 }) : new Response(JSON.stringify({ id: 'b'.repeat(32) }), { status: 200 }))
    const st = mem()
    st.setItem(BACKUP_ID_KEY, 'c'.repeat(32))
    expect((await createBackupClient('', st).backup('1234', [])).id).toBe('b'.repeat(32))
    expect(st.m.get(BACKUP_ID_KEY)).toBe('b'.repeat(32))
  })
})
