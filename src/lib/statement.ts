/**
 * A customer's statement as a 1080-wide PNG, drawn on the phone and shared to WhatsApp.
 * Only that customer's decrypted entries are drawn; nothing goes to the server.
 *
 * statementLayout() is pure (input -> draw ops) so it can be tested; renderStatementPng() paints
 * the ops on a canvas; shareStatement() uses the share sheet with the file, else downloads it and
 * opens WhatsApp with the text.
 */
import QRCode from 'qrcode'
import { balance, type LedgerState } from '../../shared/ledger.js'
import { formatINR } from '../../shared/numbers.js'

export const STATEMENT_WIDTH = 1080
export const STATEMENT_ROWS = 15

export interface StatementLabels {
  statementFor: string
  opening: string
  totalDue: string
  advance: string
  settled: string
  credit: string
  payment: string
  colDate: string
  colDetail: string
  colAmount: string
  colBalance: string
  scanToPay: string
  madeWith: string
}

export interface StatementEntry { day: string; paise: number; direction: 'credit' | 'payment'; note?: string; ts?: number }

export interface StatementInput {
  shop: { name: string; owner?: string; address?: string; phone?: string }
  customer: { name: string; tag?: string }
  /** the customer's live entries (no voided, no promises), any order */
  entries: StatementEntry[]
  /** upi:// or https link drawn as the pay QR (only when something is owed) */
  payUrl?: string
  labels: StatementLabels
  /** locale for dates, e.g. 'hi-IN' */
  locale?: string
  /** the footer date (YYYY-MM-DD) */
  asOf?: string
}

type Weight = 400 | 600 | 700
export type DrawOp =
  | { op: 'page'; w: number; h: number; fill: string }
  | { op: 'rect'; x: number; y: number; w: number; h: number; fill: string; r?: number }
  | { op: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; width: number }
  | { op: 'text'; x: number; y: number; text: string; size: number; weight: Weight; color: string; align?: 'left' | 'right' | 'center'; maxWidth?: number }
  | { op: 'qr'; x: number; y: number; size: number; text: string; color: string }

/** the ivory theme (src/index.css), as plain colours for the canvas */
export const INK = {
  bg: '#f7f4ee', card: '#fffdf9', ink: '#1d1c1a', muted: '#6b665d', primary: '#1f2a44', onPrimary: '#f7f4ee',
  gold: '#b08d57', chip: '#efe6d4', border: '#e2dccf', credit: '#b0553c', payment: '#2f7a66',
}

const PAD = 64
const R = (paise: number) => `₹${formatINR(Math.abs(paise) / 100)}`
const signed = (paise: number) => `${paise < 0 ? '−' : ''}${R(paise)}`
/** a rough text width for layout without a canvas (chips only); the renderer trims anything longer */
export const approxWidth = (text: string, size: number) => [...text].length * size * 0.56

/** "do kilo chawal, ek Maggi" -> ["do kilo chawal", "ek Maggi"] */
export const itemsOf = (note?: string): string[] => (note ?? '').split(/[,\n;]/).map((s) => s.trim()).filter(Boolean)

function dayText(day: string, locale?: string) {
  const d = new Date(`${day}T00:00:00`)
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString(locale ?? 'en-IN', { day: 'numeric', month: 'short' }) : day
}

/** Oldest first, with the balance after each entry; the last `n` are shown, the rest fold into an opening balance. */
export function runningRows(entries: StatementEntry[], n = STATEMENT_ROWS) {
  const sorted = [...entries].sort((a, b) => a.day.localeCompare(b.day) || (a.ts ?? 0) - (b.ts ?? 0))
  let bal = 0
  const all = sorted.map((e) => {
    bal += e.direction === 'credit' ? e.paise : -e.paise
    return { ...e, balance: bal }
  })
  const shown = all.slice(-n)
  const hidden = all.length - shown.length
  const opening = hidden > 0 ? all[hidden - 1].balance : null
  return { rows: shown, opening, closing: bal }
}

/** The statement as draw ops. The first op is the page (its size). */
export function statementLayout(input: StatementInput): DrawOp[] {
  const W = STATEMENT_WIDTH
  const L = input.labels
  const ops: DrawOp[] = []
  const body: DrawOp[] = []
  const { rows, opening, closing } = runningRows(input.entries)

  // header band
  body.push({ op: 'rect', x: 0, y: 0, w: W, h: 210, fill: INK.primary })
  body.push({ op: 'text', x: PAD, y: 104, text: input.shop.name || 'KhataBhai', size: 56, weight: 700, color: INK.onPrimary, maxWidth: W - PAD * 2 })
  const sub = [input.shop.owner, input.shop.address, input.shop.phone].filter(Boolean).join(' · ')
  if (sub) body.push({ op: 'text', x: PAD, y: 160, text: sub, size: 28, weight: 400, color: '#c9c6bf', maxWidth: W - PAD * 2 })
  body.push({ op: 'rect', x: 0, y: 210, w: W, h: 4, fill: INK.gold })

  // customer
  let y = 284
  body.push({ op: 'text', x: PAD, y, text: L.statementFor, size: 28, weight: 600, color: INK.muted })
  y += 62
  body.push({ op: 'text', x: PAD, y, text: input.customer.name, size: 52, weight: 700, color: INK.ink, maxWidth: W - PAD * 2 })
  if (input.customer.tag) {
    y += 26
    const tw = Math.min(W - PAD * 2, approxWidth(input.customer.tag, 26) + 36)
    body.push({ op: 'rect', x: PAD, y, w: tw, h: 46, fill: INK.chip, r: 23 })
    body.push({ op: 'text', x: PAD + 18, y: y + 32, text: input.customer.tag, size: 26, weight: 600, color: INK.ink, maxWidth: tw - 36 })
    y += 46
  }

  // balance card
  y += 36
  const owes = closing > 0
  body.push({ op: 'rect', x: PAD, y, w: W - PAD * 2, h: 150, fill: INK.card, r: 20 })
  body.push({ op: 'text', x: PAD + 36, y: y + 64, text: closing > 0 ? L.totalDue : closing < 0 ? L.advance : L.settled, size: 30, weight: 600, color: INK.muted })
  body.push({ op: 'text', x: W - PAD - 36, y: y + 100, text: R(closing), size: 72, weight: 700, color: owes ? INK.credit : INK.payment, align: 'right' })
  y += 150 + 56

  // table header
  const C = { date: PAD, detail: PAD + 170, amount: W - PAD - 250, balance: W - PAD }
  const head = (x: number, text: string, align: 'left' | 'right' = 'left') => body.push({ op: 'text', x, y, text, size: 24, weight: 600, color: INK.muted, align })
  head(C.date, L.colDate); head(C.detail, L.colDetail); head(C.amount, L.colAmount, 'right'); head(C.balance, L.colBalance, 'right')
  y += 22
  body.push({ op: 'line', x1: PAD, y1: y, x2: W - PAD, y2: y, color: INK.border, width: 2 })

  if (opening !== null) {
    y += 58
    body.push({ op: 'text', x: C.detail, y, text: L.opening, size: 30, weight: 400, color: INK.muted })
    body.push({ op: 'text', x: C.balance, y, text: signed(opening), size: 30, weight: 600, color: INK.ink, align: 'right' })
    y += 26
    body.push({ op: 'line', x1: PAD, y1: y, x2: W - PAD, y2: y, color: INK.border, width: 1 })
  }

  for (const r of rows) {
    y += 58
    const credit = r.direction === 'credit'
    body.push({ op: 'text', x: C.date, y, text: dayText(r.day, input.locale), size: 28, weight: 400, color: INK.muted })
    body.push({ op: 'text', x: C.detail, y, text: credit ? L.credit : L.payment, size: 32, weight: 600, color: INK.ink })
    body.push({ op: 'text', x: C.amount, y, text: `${credit ? '+' : '−'}${R(r.paise)}`, size: 32, weight: 700, color: credit ? INK.credit : INK.payment, align: 'right' })
    body.push({ op: 'text', x: C.balance, y, text: signed(r.balance), size: 30, weight: 600, color: INK.ink, align: 'right' })
    const items = itemsOf(r.note)
    if (items.length) {
      y += 20
      let x = C.detail
      const maxX = W - PAD
      for (const it of items) {
        const w = Math.min(maxX - C.detail, approxWidth(it, 22) + 28)
        if (x + w > maxX) break
        body.push({ op: 'rect', x, y, w, h: 38, fill: INK.chip, r: 19 })
        body.push({ op: 'text', x: x + 14, y: y + 27, text: it, size: 22, weight: 400, color: INK.ink, maxWidth: w - 28 })
        x += w + 10
      }
      y += 38
    }
    y += 24
    body.push({ op: 'line', x1: PAD, y1: y, x2: W - PAD, y2: y, color: INK.border, width: 1 })
  }

  // pay QR
  if (input.payUrl && owes) {
    y += 48
    const size = 260
    body.push({ op: 'rect', x: PAD, y, w: W - PAD * 2, h: size + 64, fill: INK.card, r: 20 })
    body.push({ op: 'qr', x: PAD + 32, y: y + 32, size, text: input.payUrl, color: INK.ink })
    body.push({ op: 'text', x: PAD + 32 + size + 48, y: y + 32 + 110, text: L.scanToPay, size: 38, weight: 700, color: INK.ink, maxWidth: W - PAD * 2 - size - 112 })
    body.push({ op: 'text', x: PAD + 32 + size + 48, y: y + 32 + 172, text: R(closing), size: 48, weight: 700, color: INK.credit })
    y += size + 64
  }

  // footer
  y += 70
  body.push({ op: 'text', x: W / 2, y, text: [L.madeWith, input.asOf && dayText(input.asOf, input.locale)].filter(Boolean).join(' · '), size: 24, weight: 400, color: INK.muted, align: 'center' })
  y += PAD

  ops.push({ op: 'page', w: W, h: Math.ceil(y), fill: INK.bg }, ...body)
  return ops
}

/** The input for one customer, straight from the ledger (live entries only). */
export function statementInputFor(state: LedgerState, cid: string, o: {
  shop: StatementInput['shop']; label: string; tag?: string; labels: StatementLabels; payUrl?: string; locale?: string; asOf?: string
}): StatementInput {
  const entries = [...state.entries.values()]
    .filter((e) => e.cid === cid && !e.voided && !e.promise)
    .map((e) => ({ day: e.day, paise: e.paise, direction: e.direction, ts: e.ts, ...(e.note ? { note: e.note } : {}) }))
  return {
    shop: o.shop,
    // the label already carries the tag ("Ramesh · doodhwala"): show the name, then the tag as a chip
    customer: { name: o.tag && o.label.endsWith(` · ${o.tag}`) ? o.label.slice(0, -(o.tag.length + 3)) : o.label, tag: o.tag },
    entries,
    ...(o.payUrl && balance(state, cid) > 0 ? { payUrl: o.payUrl } : {}),
    labels: o.labels, locale: o.locale, asOf: o.asOf,
  }
}

// ------------------------------------------------------------------ canvas

const FONT = "'Inter Variable', 'Noto Sans Devanagari Variable', 'Noto Sans Kannada Variable', 'Noto Sans Tamil Variable', 'Noto Sans Telugu Variable', 'Noto Sans Malayalam Variable', 'Noto Sans Bengali Variable', 'Noto Sans Gujarati Variable', 'Noto Sans Gurmukhi Variable', system-ui, sans-serif"

function fit(ctx: CanvasRenderingContext2D, text: string, max?: number) {
  if (!max || ctx.measureText(text).width <= max) return text
  const cs = [...text]
  while (cs.length > 1 && ctx.measureText(`${cs.join('')}…`).width > max) cs.pop()
  return `${cs.join('')}…`
}

function drawQr(ctx: CanvasRenderingContext2D, op: Extract<DrawOp, { op: 'qr' }>) {
  const q = QRCode.create(op.text, { errorCorrectionLevel: 'M' })
  const n = q.modules.size
  const cell = Math.floor(op.size / n)
  const off = Math.floor((op.size - cell * n) / 2)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(op.x, op.y, op.size, op.size)
  ctx.fillStyle = op.color
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (q.modules.get(r, c)) ctx.fillRect(op.x + off + c * cell, op.y + off + r * cell, cell, cell)
}

/** Paint the statement and return it as a PNG. Browser only. */
export async function renderStatementPng(input: StatementInput): Promise<Blob> {
  await document.fonts?.ready
  const ops = statementLayout(input)
  const page = ops[0] as Extract<DrawOp, { op: 'page' }>
  const canvas = document.createElement('canvas')
  canvas.width = page.w
  canvas.height = page.h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no canvas')
  for (const op of ops) {
    switch (op.op) {
      case 'page':
        ctx.fillStyle = op.fill
        ctx.fillRect(0, 0, op.w, op.h)
        break
      case 'rect':
        ctx.fillStyle = op.fill
        ctx.beginPath()
        if (op.r && ctx.roundRect) ctx.roundRect(op.x, op.y, op.w, op.h, op.r)
        else ctx.rect(op.x, op.y, op.w, op.h)
        ctx.fill()
        break
      case 'line':
        ctx.strokeStyle = op.color
        ctx.lineWidth = op.width
        ctx.beginPath()
        ctx.moveTo(op.x1, op.y1)
        ctx.lineTo(op.x2, op.y2)
        ctx.stroke()
        break
      case 'text':
        ctx.font = `${op.weight} ${op.size}px ${FONT}`
        ctx.fillStyle = op.color
        ctx.textAlign = op.align ?? 'left'
        ctx.textBaseline = 'alphabetic'
        ctx.fillText(fit(ctx, op.text, op.maxWidth), op.x, op.y)
        break
      case 'qr':
        drawQr(ctx, op)
        break
    }
  }
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'))
}

/**
 * Share the image: the system share sheet with the file (Android Chrome: straight to WhatsApp),
 * else download it and open WhatsApp with the text so the shopkeeper attaches it.
 */
export async function shareStatement(blob: Blob, text: string, o: { phone?: string; filename?: string } = {}): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], o.filename ?? 'khata-statement.png', { type: 'image/png' })
  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text })
      return 'shared'
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'cancelled'
      // fall through to download
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  const digits = o.phone?.replace(/\D/g, '') ?? ''
  const to = digits.length === 10 ? `91${digits}` : digits
  window.open(`https://wa.me/${to}?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
  return 'downloaded'
}
