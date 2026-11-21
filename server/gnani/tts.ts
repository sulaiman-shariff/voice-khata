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

export interface SpeakResult {
  firstAudioMs: number | null
  totalMs: number
  bytes: number
  cancelled: boolean
  error?: string
}

interface Slot {
  ws: WebSocket
  ready: Promise<void>
  busy: boolean
}

export class TtsPool {
  private slots: Slot[] = []
  private closed = false

  constructor(private key: string, private size = 2) {
    for (let i = 0; i < size; i++) this.slots.push(this.openSlot())
  }

  private openSlot(): Slot {
    const ws = new WebSocket(TTS_URL, { headers: { 'X-API-Key-ID': this.key } })
    const ready = new Promise<void>((res, rej) => {
      ws.once('open', () => res())
      ws.once('error', rej)
    })
    ready.catch(() => {}) // surfaced at use time
    const slot: Slot = { ws, ready, busy: false }
    ws.on('close', () => {
      // replace dead sockets so the pool stays warm
      if (this.closed) return
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
  async speak(text: string, lang: string, onAudio: (pcm: Buffer) => void, signal?: AbortSignal, speed: TtsSpeed = 1): Promise<SpeakResult> {
    const t0 = performance.now()
    const slot = this.acquire()
    try {
      await slot.ready
    } catch (e) {
      slot.busy = false
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
