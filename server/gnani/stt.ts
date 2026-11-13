/**
 * Gnani Prisma v3.0 streaming STT.
 *
 * Live-measured behaviour (2026-11-13): `language_code` takes exactly one locale; `format=transcribe`
 * gives digits; the undocumented `x-partials: true` header turns on `partial_transcript`
 * (~every 450 ms) plus `speech_start` / `speech_end` / `final_transcript`. Per the docs, `keyterms`
 * is a JSON array header (non-ASCII escaped) and can be replaced mid-session via
 * `update_settings` -> `bias.list`; sessions last up to 15 min, idle timeout 5-900 s.
 */
import WebSocket from 'ws'

const STT_URL = 'wss://api.vachana.ai/stt/v3/stream'
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
