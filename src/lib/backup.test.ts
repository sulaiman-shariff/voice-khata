import { describe, expect, it } from 'vitest'
import { decryptRecords, encryptRecords } from './backup.js'

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
