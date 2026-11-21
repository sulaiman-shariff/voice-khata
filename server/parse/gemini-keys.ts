/**
 * Google AI Studio keys for the photo import (server/parse/vision.ts): GEMINI_API_KEY, GEMINI_API_KEY_2 .. _9,
 * and/or GEMINI_API_KEYS="k1,k2,...". Free-tier keys hit per-minute limits, so a rate-limited or failing key
 * is benched and the next one tried. (The voice agent uses Vertex AI instead: server/parse/gemini.ts.)
 */
import { log } from '../log.js'

const benchedUntil = new Map<string, number>() // key -> epoch ms
let nextKey = 0

export function geminiKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  const keys = [
    env.GEMINI_API_KEY,
    ...Array.from({ length: 8 }, (_, i) => env[`GEMINI_API_KEY_${i + 2}`]),
    ...(env.GEMINI_API_KEYS ?? '').split(','),
  ].map((k) => k?.trim()).filter((k): k is string => !!k)
  return [...new Set(keys)]
}

export class GeminiError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterMs?: number) {
    super(message)
  }
}

export async function withGeminiKey<T>(call: (key: string) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const keys = geminiKeys()
  if (!keys.length) throw new Error('no GEMINI_API_KEY set')
  const now = Date.now()
  // rotate the starting key so load spreads across keys; benched keys go last
  const order = keys.map((_, i) => keys[(nextKey + i) % keys.length])
  nextKey = (nextKey + 1) % keys.length
  order.sort((a, b) => Number((benchedUntil.get(a) ?? 0) > now) - Number((benchedUntil.get(b) ?? 0) > now))
  let last: unknown
  for (const key of order) {
    if (signal?.aborted) break
    try {
      return await call(key)
    } catch (e) {
      last = e
      const status = e instanceof GeminiError ? e.status : -1
      if (status === 400) throw e // bad request: another key will not fix it
      // 429 quota, 401/403 bad key, 5xx, timeout, network: bench this key and try the next
      const bench = status === 429 ? (e as GeminiError).retryAfterMs ?? 30_000 : status === 401 || status === 403 ? 10 * 60_000 : 5_000
      benchedUntil.set(key, Date.now() + bench)
      log.warn('gemini_key_failed', { key: `…${key.slice(-4)}`, status, benchMs: bench, error: String(e).slice(0, 160) })
    }
  }
  throw last ?? new Error('gemini: aborted')
}
