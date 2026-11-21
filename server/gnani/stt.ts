/**
 * Gnani Prisma v3.0 streaming STT.
 *
 * Live-measured behaviour (2026-11-13): `language_code` takes exactly one locale; `format=transcribe`
 * gives digits; the undocumented `x-partials: true` header turns on `partial_transcript`
 * (~every 450 ms) plus `speech_start` / `speech_end` / `final_transcript`. Per the docs, `keyterms`
 * is a JSON array header (non-ASCII escaped) and can be replaced mid-session via
 * `update_settings` -> `bias.list`; sessions last up to 15 min, idle timeout 5-900 s.
 *
 * Re-probed 2026-11-21 (eval/probe_gnani*.ts): a `language_code` list is still rejected on
 * realtime ("exactly one locale"), and `multi_lang_codes` is accepted but has no effect.
 * The VAD silence window is the main latency lever: with defaults `speech_end` came ~1250 ms
 * after the audio ended; `x-min-silence-ms` 300/500/700 gave ~320/620/1000 ms. Shorter
 * windows split a sentence at a breath ("रमेश का।" + "340 रुपये उधार।"); the session holds
 * such dangling lines and joins them (see `dangling` / `midList`).
 */
import WebSocket from 'ws'

const STT_URL = 'wss://api.vachana.ai/stt/v3/stream'
/**
 * Optional Prisma VAD tuning (env). Off by default: in the e2e suite (4 languages, clean/street/
 * babble) 500 ms gave no measurable gain over Prisma's defaults, because our early commit already
 * ends complete sentences sooner, and clean p95 got worse.
 */
const MIN_SILENCE_MS = process.env.STT_MIN_SILENCE_MS
const VAD_THRESHOLD = process.env.STT_VAD_THRESHOLD
export const FRAME_BYTES = 1024 // 512 samples of s16le @ 16 kHz

export interface SttEvents {
  onSpeechStart?: () => void
  onSpeechEnd?: () => void
  onPartial?: (text: string) => void
  onFinal?: (text: string, detectedLang?: string) => void
  onError?: (msg: string) => void
  onClose?: (code: number) => void
}

/** Header-safe JSON: escape everything outside printable ASCII. */
export const asciiJson = (v: unknown) =>
  JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)

export class SttStream {
  private ws: WebSocket
  private queue: Buffer[] = []
  private carry = Buffer.alloc(0)
  readonly opened: Promise<void>

  constructor(key: string, lang: string, keyterms: string[], private ev: SttEvents) {
    const headers: Record<string, string> = {
      'x-api-key-id': key,
      model: 'prisma-v3.0',
      language_code: lang,
      format: 'transcribe',
      'x-sample-rate': '16000',
      'x-partials': 'true',
      'x-idle-timeout-sec': '300',
      topic: 'kirana shop credit ledger: customer names, rupee amounts, udhaar and payments',
    }
    if (MIN_SILENCE_MS) {
      headers['x-min-silence-ms'] = MIN_SILENCE_MS
      // short answers ("haan", "nahi", "ho") must still produce a transcript
      headers['x-min-segment-ms'] = '100'
    }
    if (VAD_THRESHOLD) headers['x-vad-threshold'] = VAD_THRESHOLD
    if (keyterms.length) headers.keyterms = asciiJson(keyterms.slice(0, 200))
    this.ws = new WebSocket(STT_URL, { headers })
    this.opened = new Promise((res, rej) => {
      this.ws.once('open', () => {
        for (const b of this.queue) this.ws.send(b)
        this.queue = []
        res()
      })
      this.ws.once('error', (e) => rej(e))
    })
    this.opened.catch(() => {})
    this.ws.on('message', (d) => this.onMessage(d))
    this.ws.on('error', (e) => ev.onError?.(String(e)))
    this.ws.on('close', (code) => ev.onClose?.(code))
  }

  private onMessage(d: WebSocket.RawData) {
    let m: { type?: string; text?: string; detected_language_code?: string; message?: string }
    try {
      m = JSON.parse(d.toString())
    } catch {
      return
    }
    switch (m.type) {
      case 'speech_start':
        this.ev.onSpeechStart?.()
        break
      case 'speech_end':
        this.ev.onSpeechEnd?.()
        break
      case 'partial_transcript':
        if (m.text) this.ev.onPartial?.(m.text)
        break
      case 'final_transcript':
      case 'transcript':
        this.ev.onFinal?.(m.text ?? '', m.detected_language_code)
        break
      case 'error':
        this.ev.onError?.(m.message ?? 'stt error')
        break
    }
  }

  /** Accepts any chunk size; forwards exact 1024-byte frames as Prisma requires. */
  send(pcm: Buffer) {
    let buf = this.carry.length ? Buffer.concat([this.carry, pcm]) : pcm
    while (buf.length >= FRAME_BYTES) {
      const frame = buf.subarray(0, FRAME_BYTES)
      if (this.ws.readyState === WebSocket.OPEN) this.ws.send(frame)
      else if (this.ws.readyState === WebSocket.CONNECTING) this.queue.push(Buffer.from(frame))
      buf = buf.subarray(FRAME_BYTES)
    }
    this.carry = Buffer.from(buf)
  }

  /** Force-close the current utterance now instead of waiting for the silence timer. */
  commit() {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'commit' }))
  }

  /** Switch the recognition language from the next utterance on (no reconnect). */
  setLanguage(locale: string) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'update_settings', language_code: locale }))
  }

  setKeyterms(terms: string[]) {
    if (this.ws.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify({ type: 'update_settings', bias: { list: terms.slice(0, 200) } }))
  }

  get open() {
    return this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING
  }

  close() {
    this.ws.close()
  }
}
