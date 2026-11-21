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
    // ---- WhatsApp reminders and Razorpay payments (receivables mirror; the phone stays the ledger)
    await sql`CREATE TABLE IF NOT EXISTS shops (
      id text PRIMARY KEY,
      secret_hash text NOT NULL,
      name text NOT NULL DEFAULT '',
      lang text NOT NULL DEFAULT 'hi',
      -- signature line under reminders: owner · address · phone
      signature text NOT NULL DEFAULT '',
      -- automatic reminders (the phone's settings, synced): on/off and every N days
      auto_remind boolean NOT NULL DEFAULT false,
      remind_every_days int NOT NULL DEFAULT 7,
      created_at timestamptz NOT NULL DEFAULT now(),
      seen_at timestamptz NOT NULL DEFAULT now()
    )`
    // only customers who agreed to reminders and are adults, with a phone; deleted when that stops
    await sql`CREATE TABLE IF NOT EXISTS receivables (
      shop_id text NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      cid text NOT NULL,
      name text NOT NULL,
      phone text NOT NULL,
      balance_paise bigint NOT NULL,
      promise_day text,
      oldest_unpaid_day text,
      last_reminded_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (shop_id, cid)
    )`
    await sql`CREATE INDEX IF NOT EXISTS receivables_phone ON receivables (phone)`
    // due dates and instalment plans (the phone computes them; the hourly sweep acts on them)
    await sql`ALTER TABLE receivables ADD COLUMN IF NOT EXISTS due_day text`
    await sql`ALTER TABLE receivables ADD COLUMN IF NOT EXISTS plan_next_day text`
    await sql`ALTER TABLE receivables ADD COLUMN IF NOT EXISTS plan_part_paise bigint`
    await sql`CREATE TABLE IF NOT EXISTS payment_links (
      id text PRIMARY KEY,
      shop_id text NOT NULL,
      cid text NOT NULL,
      rzp_link_id text NOT NULL UNIQUE,
      short_url text NOT NULL,
      amount_paise bigint NOT NULL,
      status text NOT NULL DEFAULT 'created',
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`
    await sql`CREATE INDEX IF NOT EXISTS payment_links_open ON payment_links (shop_id, cid, status)`
    // counter QR codes (single use, fixed amount, open 15 min); a payment's rzp_link_id holds the QR id
    await sql`CREATE TABLE IF NOT EXISTS qr_codes (
      id text PRIMARY KEY,
      shop_id text NOT NULL,
      cid text NOT NULL,
      paise bigint NOT NULL,
      status text NOT NULL DEFAULT 'active',
      close_by timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`
    await sql`CREATE TABLE IF NOT EXISTS payments (
      rzp_payment_id text PRIMARY KEY,
      rzp_link_id text NOT NULL,
      shop_id text NOT NULL,
      cid text NOT NULL,
      paise bigint NOT NULL,
      method text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`
    // things that happened off the phone, for the phone to pick up and add to its own ledger
    await sql`CREATE TABLE IF NOT EXISTS pending_events (
      id bigserial PRIMARY KEY,
      shop_id text NOT NULL,
      kind text NOT NULL,
      body jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      acked_at timestamptz
    )`
    await sql`CREATE INDEX IF NOT EXISTS pending_events_open ON pending_events (shop_id) WHERE acked_at IS NULL`
    await sql`CREATE TABLE IF NOT EXISTS wa_messages (
      id text PRIMARY KEY,
      shop_id text,
      cid text,
      phone text NOT NULL,
      kind text NOT NULL,
      status text NOT NULL DEFAULT 'submitted',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`
    await sql`CREATE INDEX IF NOT EXISTS wa_messages_phone ON wa_messages (phone, created_at DESC)`
    await sql`CREATE TABLE IF NOT EXISTS wa_optouts (
      phone text PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now()
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
