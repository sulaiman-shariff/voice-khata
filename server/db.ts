import { neon } from '@neondatabase/serverless'

type Sql = ReturnType<typeof neon>
let client: Sql | null = null

export const hasDb = (): boolean => !!process.env.DATABASE_URL

/** Tagged-template SQL client (HTTP). Created lazily so importing never throws without a DB. */
export const sql: Sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  client ??= neon(url)
  return client(strings, ...values)
}) as Sql

let ready: Promise<void> | null = null

/** Idempotent schema creation, run once per cold start. */
export function ensureSchema(): Promise<void> {
  ready ??= (async () => {
    await sql`CREATE TABLE IF NOT EXISTS backups (
      id text PRIMARY KEY,
      blob text NOT NULL,
      bytes int NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`
    await sql`CREATE TABLE IF NOT EXISTS confirm_links (
      token text PRIMARY KEY,
      shop text NOT NULL,
      paise bigint NOT NULL,
      direction text NOT NULL,
      day text NOT NULL,
      lang text NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      created_at timestamptz NOT NULL DEFAULT now(),
      answered_at timestamptz
    )`
  })().catch((e) => {
    ready = null
    throw e
  })
  return ready
}

export const randomHex = (bytes: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('')

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
