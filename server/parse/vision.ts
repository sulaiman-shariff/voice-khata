/**
 * Reading a photo of a paper khata page with Gemini (multimodal): names and the amount each one
 * owes. The model fills a fixed tool schema (the same function-calling path as the slow-path
 * reader), and every row goes back to the phone for the shopkeeper to check before it is saved.
 * Uses the same Gemini keys and rotation (withGeminiKey).
 */
import type { ImportRow } from '../../shared/import.js'
import { GeminiError, withGeminiKey } from './llm.js'

export const VISION_MODEL = process.env.GEMINI_VISION_MODEL?.trim() || 'gemini-3.5-flash'
const TIMEOUT_MS = 30_000

const PROMPT = `This is a photo of a page from a small Indian shop's handwritten credit book (khata / bahi). It may be in any Indian language or English, in any script, with cuttings and totals.
Read every customer row and call "ledger_rows" once with all of them.
- name: the customer's name exactly as written (keep the script; add the area or note if one is written next to the name).
- amount: the amount that is STILL DUE for that customer, in rupees, as a plain number. If a row shows several entries and a running balance, use the final balance. If a figure is crossed out, use the one that replaces it.
- paid: true only if the row clearly says the customer paid in advance / has money with the shop (jama, advance, Cr). Otherwise false.
- unsure: true if the name or amount is hard to read.
Skip headings, dates, page totals and rows with no amount. Never invent rows. If nothing is readable, return an empty list.`

const TOOL = {
  name: 'ledger_rows',
  description: 'All customer rows read from the khata page.',
  parametersJsonSchema: {
    type: 'object',
    required: ['rows'],
    properties: {
      rows: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name', 'amount'],
          properties: {
            name: { type: 'string' },
            amount: { type: 'number' },
            paid: { type: 'boolean' },
            unsure: { type: 'boolean' },
          },
        },
      },
    },
  },
}

export interface PhotoRow extends ImportRow { unsure?: boolean }

export async function readLedgerPhoto(base64: string, mime: string): Promise<{ rows: PhotoRow[]; ms: number }> {
  const t0 = performance.now()
  const body = {
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType: mime, data: base64 } }, { text: PROMPT }] }],
    tools: [{ functionDeclarations: [TOOL] }],
    toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [TOOL.name] } },
    generationConfig: { temperature: 0, maxOutputTokens: 4000 },
  }
  const raw = await withGeminiKey(async (key) => {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const j = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; details?: { retryDelay?: string }[] }
      candidates?: { finishReason?: string; content?: { parts?: { functionCall?: { name?: string; args?: { rows?: unknown } } }[] } }[]
    }
    if (!res.ok) {
      const delay = j.error?.details?.find((d) => d.retryDelay)?.retryDelay
      throw new GeminiError(`gemini ${res.status}: ${j.error?.message?.slice(0, 200) ?? res.statusText}`, res.status, delay ? Number.parseFloat(delay) * 1000 : undefined)
    }
    const call = j.candidates?.[0]?.content?.parts?.find((p) => p.functionCall?.name === TOOL.name)?.functionCall
    if (!call?.args) throw new GeminiError(`gemini: no rows (finish ${j.candidates?.[0]?.finishReason})`, 0)
    return call.args.rows
  })
  return { rows: cleanRows(raw), ms: performance.now() - t0 }
}

/** Keep only well-formed rows: a name, and a positive amount below a sane ceiling. */
export function cleanRows(raw: unknown): PhotoRow[] {
  if (!Array.isArray(raw)) return []
  const out: PhotoRow[] = []
  for (const r of raw.slice(0, 200)) {
    if (!r || typeof r !== 'object') continue
    const x = r as { name?: unknown; amount?: unknown; paid?: unknown; unsure?: unknown }
    const name = typeof x.name === 'string' ? x.name.trim().slice(0, 60) : ''
    const amount = typeof x.amount === 'number' ? Math.round(x.amount * 100) / 100 : Number.NaN
    if (!name || !(amount > 0) || amount > 10_000_000) continue
    out.push({ name, amount, direction: x.paid === true ? 'payment' : 'credit', ...(x.unsure === true ? { unsure: true } : {}) })
  }
  return out
}
