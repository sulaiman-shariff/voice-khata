import { describe, expect, it } from 'vitest'
import { handle as backup, MAX_BLOB } from '../api/backup.js'
import { handle as cleanup } from '../api/cleanup.js'
import { handle as confirm } from '../api/confirm.js'
import { ensureSchema, hasDb, sql } from './db.js'

if (!hasDb()) console.warn('SKIPPED server/db tests: DATABASE_URL is not set (provision Neon, then `vercel env pull .env.neon.local` and export DATABASE_URL)')

const post = (path: string, body: unknown) =>
  new Request('http://x' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) })
const get = (path: string) => new Request('http://x' + path)
const link = { shop: 'Test Kirana', paise: 25000, direction: 'credit', day: '2026-11-13', lang: 'hi' }
const blobOf = (ct = 'AAAA') => JSON.stringify({ v: 1, salt: 'AAAA', iv: 'AAAA', ct })

describe.skipIf(!hasDb())('neon: confirm links', () => {
  it('create, get, answer once, reject second answer', async () => {
    await ensureSchema()
    const { token } = await (await confirm(post('/api/confirm', link))).json()
    expect(token).toMatch(/^[0-9a-f]{32}$/)
    const d = await (await confirm(get(`/api/confirm?token=${token}`))).json()
    expect(d).toEqual({ ...link, status: 'pending' })
    expect(Object.keys(d).sort()).toEqual(['day', 'direction', 'lang', 'paise', 'shop', 'status'])
    expect((await confirm(post('/api/confirm', { token, answer: 'confirmed' }))).status).toBe(200)
    expect((await confirm(post('/api/confirm', { token, answer: 'disputed' }))).status).toBe(409)
    expect((await (await confirm(get(`/api/confirm?token=${token}`))).json()).status).toBe('confirmed')
  })
  it('validates input', async () => {
    for (const bad of [{ ...link, paise: 0 }, { ...link, paise: 1.5 }, { ...link, paise: 1e9 }, { ...link, direction: 'x' }, { ...link, shop: 'a'.repeat(61) }, { ...link, lang: 'zz' }, { ...link, day: 'today' }]) {
      expect((await confirm(post('/api/confirm', bad))).status).toBe(400)
    }
    expect((await confirm(post('/api/confirm', '{bad'))).status).toBe(400)
    expect((await confirm(get('/api/confirm?token=nope'))).status).toBe(400)
    expect((await confirm(get('/api/confirm?token=' + '0'.repeat(32)))).status).toBe(404)
  })
  it('expires after 30 days (410) and cleanup deletes it', async () => {
    const { token } = await (await confirm(post('/api/confirm', link))).json()
    await sql`UPDATE confirm_links SET created_at = now() - interval '31 days' WHERE token = ${token}`
    expect((await confirm(get(`/api/confirm?token=${token}`))).status).toBe(410)
    expect((await confirm(post('/api/confirm', { token, answer: 'confirmed' }))).status).toBe(410)
    process.env.CRON_SECRET = 'test-secret'
    expect((await cleanup(new Request('http://x/api/cleanup', { headers: { authorization: 'Bearer test-secret' } }))).status).toBe(200)
    expect((await confirm(get(`/api/confirm?token=${token}`))).status).toBe(404)
  })
})

describe('cleanup auth', () => {
  it('refuses when CRON_SECRET is unset or wrong', async () => {
    const prev = process.env.CRON_SECRET
    delete process.env.CRON_SECRET
    expect((await cleanup(get('/api/cleanup'))).status).toBe(401)
    process.env.CRON_SECRET = 's3'
    expect((await cleanup(new Request('http://x/api/cleanup', { headers: { authorization: 'Bearer nope' } }))).status).toBe(401)
    if (prev === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = prev
  })
})

describe.skipIf(!hasDb())('neon: backups', () => {
  it('creates, updates and fetches ciphertext', async () => {
    const { id } = await (await backup(post('/api/backup', { blob: blobOf('AAAA') }))).json()
    expect(id).toMatch(/^[0-9a-f]{32}$/)
    expect((await (await backup(get(`/api/backup?id=${id}`))).json()).blob).toBe(blobOf('AAAA'))
    expect((await backup(post('/api/backup', { id, blob: blobOf('BBBB') }))).status).toBe(200)
    expect((await (await backup(get(`/api/backup?id=${id}`))).json()).blob).toBe(blobOf('BBBB'))
    await sql`DELETE FROM backups WHERE id = ${id}`
  })
  it('deletes by id (idempotent, validated)', async () => {
    const { id } = await (await backup(post('/api/backup', { blob: blobOf('AAAA') }))).json()
    const del = (q: string) => backup(new Request('http://x/api/backup' + q, { method: 'DELETE' }))
    expect((await del('?id=zz')).status).toBe(400)
    expect((await del(`?id=${id}`)).status).toBe(200)
    expect((await backup(get(`/api/backup?id=${id}`))).status).toBe(404)
    expect((await del(`?id=${id}`)).status).toBe(200)
  })
  it('rejects oversize and malformed', async () => {
    expect((await backup(post('/api/backup', { blob: blobOf('A'.repeat(MAX_BLOB)) }))).status).toBe(413)
    expect((await backup(post('/api/backup', { blob: 'plain text' }))).status).toBe(400)
    expect((await backup(post('/api/backup', { blob: JSON.stringify({ v: 2 }) }))).status).toBe(400)
    expect((await backup(post('/api/backup', { id: 'zz', blob: blobOf() }))).status).toBe(400)
    expect((await backup(get('/api/backup?id=' + '0'.repeat(32)))).status).toBe(404)
  })
})
