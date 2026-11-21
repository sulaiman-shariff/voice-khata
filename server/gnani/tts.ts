/**
 * Gnani Timbre v3.0 TTS over WebSocket, with a small pool of pre-opened sockets.
 *
 * Measured live (2026-11-13): a socket serves many requests in sequence and survives >45 s
 * idle; first audio is ~170-190 ms on a warm socket vs ~300 ms including the TLS connect.
 * Each request ends with two `complete` messages; the second ("Streaming completed") is the
 * real end. There is no cancel message, so barge-in detaches the listener: the rest of that
 * reply is drained and dropped, and the socket rejoins the pool once it finishes.
 */
import WebSocket from 'ws'
import { type Logger, nullLogger } from '../log.js'

const TTS_URL = 'wss://api.vachana.ai/api/v1/tts'
/**
 * One female Timbre v3.0 voice per language, each from Gnani's recommended list for that
 * language (docs: TTS/available-voices). Shivani is not recommended for kn/ta/te/ml/en/pa.
 */
export const VOICE_BY_LOCALE: Record<string, string> = {
  'hi-IN': 'Shivani', 'mr-IN': 'Shivani', 'bn-IN': 'Shivani', 'gu-IN': 'Shivani',
  'en-IN': 'Sunaina', 'kn-IN': 'Sneha', 'ta-IN': 'Kalpana', 'te-IN': 'Kalpana', 'pa-IN': 'Kalpana', 'ml-IN': 'Sunaina',
}
export const voiceFor = (locale: string) => VOICE_BY_LOCALE[locale] ?? 'Shivani'
/** Timbre v3.0 accepts exactly 0.8, 1.0 and 1.2. */
export type TtsSpeed = 0.8 | 1 | 1.2
export const TTS_RATE = 16000

/**
 * Fixed phrases (short ack, "did not catch") synthesized once per instance and replayed
 * from memory: no Timbre round trip (~150 ms) on the turns that use them. Shared by every session
 * on a warm instance; only phrases passed to warm() are stored, so it stays a few hundred KB.
 */
const PHRASES = new Map<string, Buffer[]>()
const MAX_PHRASES = 120
const phraseKey = (text: string, lang: string, speed: number) => `${lang}|${voiceFor(lang)}|${speed}|${text}`
export const cachedPhrase = (text: string, lang: string, speed: TtsSpeed = 1) => PHRASES.has(phraseKey(text, lang, speed))

export interface SpeakResult {
  firstAudioMs: number | null
  totalMs: number
  bytes: number
  cancelled: boolean
  error?: string
  /** served from the phrase cache */
  cached?: boolean
}

interface Slot {
  ws: WebSocket
  ready: Promise<void>
  busy: boolean
}

export class TtsPool {
  private slots: Slot[] = []
  private closed = false

  constructor(private key: string, private size = 2, private log: Logger = nullLogger) {
    for (let i = 0; i < size; i++) this.slots.push(this.openSlot())
  }

  private openSlot(): Slot {
    const ws = new WebSocket(TTS_URL, { headers: { 'X-API-Key-ID': this.key } })
    const t0 = performance.now()
    const ready = new Promise<void>((res, rej) => {
      ws.once('open', () => {
        this.log.debug('tts_socket_open', { ms: performance.now() - t0, pool: this.slots.length })
        res()
      })
      ws.once('error', (e) => {
        this.log.warn('tts_socket_failed', { ms: performance.now() - t0, error: e })
        rej(e)
      })
    })
    ready.catch(() => {}) // surfaced at use time
    const slot: Slot = { ws, ready, busy: false }
    ws.on('close', (code) => {
      // replace dead sockets so the pool stays warm
      if (this.closed) return
      this.log.info('tts_socket_closed', { code, replacing: true })
      const i = this.slots.indexOf(slot)
      if (i >= 0) this.slots[i] = this.openSlot()
    })
    ws.on('error', () => {})
    return slot
  }

  private acquire(): Slot {
    let s = this.slots.find((x) => !x.busy && x.ws.readyState === WebSocket.OPEN)
    s ??= this.slots.find((x) => !x.busy && x.ws.readyState === WebSocket.CONNECTING)
    if (!s) {
      // all busy (e.g. a barged-in reply still draining): open an extra socket
      this.log.info('tts_pool_grow', { size: this.slots.length + 1 })
      s = this.openSlot()
      this.slots.push(s)
    }
    s.busy = true
    return s
  }

  /**
   * Speak `text`; PCM s16le 16 kHz chunks go to `onAudio` as they arrive.
   * Aborting stops delivery immediately (barge-in); the socket drains in the background.
   */
  /** Synthesize fixed phrases in the background so later speak() calls replay them from memory. */
  async warm(texts: string[], lang: string, speed: TtsSpeed = 1): Promise<void> {
    for (const text of texts) {
      const key = phraseKey(text, lang, speed)
      if (PHRASES.has(key) || this.closed) continue
      const chunks: Buffer[] = []
      const r = await this.synth(text, lang, (pcm) => chunks.push(pcm), undefined, speed)
      this.log.debug('tts_warm', { text, lang, speed, ok: !r.error, ms: r.totalMs, bytes: r.bytes, error: r.error ?? null })
      if (!r.error && !r.cancelled && chunks.length) {
        if (PHRASES.size >= MAX_PHRASES) PHRASES.delete(PHRASES.keys().next().value!)
        PHRASES.set(key, chunks)
      }
    }
  }

  async speak(text: string, lang: string, onAudio: (pcm: Buffer) => void, signal?: AbortSignal, speed: TtsSpeed = 1): Promise<SpeakResult> {
    const hit = PHRASES.get(phraseKey(text, lang, speed))
    if (hit) {
      let bytes = 0
      for (const pcm of hit) {
        if (signal?.aborted) break
        bytes += pcm.length
        onAudio(pcm)
      }
      return { firstAudioMs: 0, totalMs: 0, bytes, cancelled: !!signal?.aborted, cached: true }
    }
    return this.synth(text, lang, onAudio, signal, speed)
  }

  private async synth(text: string, lang: string, onAudio: (pcm: Buffer) => void, signal?: AbortSignal, speed: TtsSpeed = 1): Promise<SpeakResult> {
    const t0 = performance.now()
    const slot = this.acquire()
    try {
      await slot.ready
    } catch (e) {
      slot.busy = false
      this.log.error('tts_socket_unavailable', { error: e, text, lang })
      return { firstAudioMs: null, totalMs: performance.now() - t0, bytes: 0, cancelled: false, error: String(e) }
    }
    return new Promise<SpeakResult>((resolve) => {
      let first: number | null = null
      let bytes = 0
      let cancelled = false
      let settled = false
      const finish = (error?: string) => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        if (error) this.log.error('tts_error', { error, text, lang, bytes, ms: performance.now() - t0 })
        resolve({ firstAudioMs: first, totalMs: performance.now() - t0, bytes, cancelled, error })
      }
      const onMessage = (raw: WebSocket.RawData) => {
        let m: { type?: string; message?: string; data?: { audio?: string } }
        try {
          m = JSON.parse(raw.toString())
        } catch {
          return
        }
        if (m.type === 'audio' && m.data?.audio) {
          if (cancelled) return
          const pcm = Buffer.from(m.data.audio, 'base64')
          if (first === null) first = performance.now() - t0
          bytes += pcm.length
          onAudio(pcm)
        } else if (m.type === 'complete' && m.message) {
          release()
          finish()
        } else if (m.type === 'error') {
          release()
          finish(m.message ?? 'tts error')
        }
      }
      const onClose = () => {
        release()
        finish(cancelled ? undefined : 'tts socket closed')
      }
      const release = () => {
        slot.ws.off('message', onMessage)
        slot.ws.off('close', onClose)
        slot.busy = false
      }
      const onAbort = () => {
        cancelled = true
        finish() // caller moves on now; the socket keeps draining until "Streaming completed"
      }
      if (signal?.aborted) {
        slot.busy = false
        cancelled = true
        finish()
        return
      }
      signal?.addEventListener('abort', onAbort)
      slot.ws.on('message', onMessage)
      slot.ws.on('close', onClose)
      slot.ws.send(
        JSON.stringify({
          text,
          voice: voiceFor(lang),
          model: 'timbre-v3.0',
          language: lang,
          speed,
          audio_config: { sample_rate: TTS_RATE, num_channels: 1, sample_width: 2, encoding: 'linear_pcm', container: 'raw' },
        }),
      )
    })
  }

  close(): void {
    this.closed = true
    for (const s of this.slots) s.ws.close()
  }
}
