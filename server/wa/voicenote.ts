/**
 * A customer's WhatsApp voice note, as text: download the audio from Vonage (OGG/Opus), decode it to
 * 16 kHz mono s16le with ffmpeg (installed in the Cloud Run image, deploy/cloudrun/Dockerfile;
 * FFMPEG_PATH overrides), and transcribe it with Gnani's REST STT (GNANI_API_KEY). Notes longer
 * than 30 s are skipped: a promise or a question is short, and the shop is told nothing it did not ask.
 */
import { spawn } from 'node:child_process'
import { LOCALE, type Lang } from '../../shared/replies.js'
import { transcribeRest } from '../gnani/rest.js'
import { isLang } from './texts.js'

export const VOICE_NOTE_MAX_S = 30
/** 30 s of Opus is ~120 KB; anything far bigger is not a voice note */
const MAX_AUDIO_BYTES = 2 * 1024 * 1024
const PCM_BYTES_PER_S = 16000 * 2
const STT_TIMEOUT_MS = 8000

export type VoiceNoteResult = { text: string } | { skipped: 'too_long' | 'unconfigured' | 'failed' }

export interface VoiceNoteDeps {
  download: (url: string) => Promise<Buffer>
  decode: (audio: Buffer) => Promise<Buffer>
  /** null when there is no STT key */
  transcribe: ((pcm: Buffer, locale: string) => Promise<string>) | null
}

/** Vonage media needs the account's credentials (the same basic auth that sends messages). */
export async function downloadVonageMedia(url: string, env = process.env, fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  const key = env.VONAGE_API_KEY?.trim()
  const secret = env.VONAGE_API_SECRET?.trim()
  const res = await fetchImpl(url, {
    headers: key && secret ? { authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}` } : {},
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`media ${res.status}`)
  const len = Number(res.headers.get('content-length') ?? 0)
  if (len > MAX_AUDIO_BYTES) throw new Error('media too large')
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_AUDIO_BYTES) throw new Error('media too large')
  return buf
}

/**
 * Any audio ffmpeg reads -> 16 kHz mono s16le. Decodes at most VOICE_NOTE_MAX_S + 1 s, so a longer
 * note shows up as more than the limit without decoding all of it.
 */
export function decodeToPcm16k(audio: Buffer, ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg', timeoutMs = 10_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-t', String(VOICE_NOTE_MAX_S + 1),
      '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'], { stdio: ['pipe', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    let err = ''
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs)
    p.stdout.on('data', (d: Buffer) => out.push(d))
    p.stderr.on('data', (d: Buffer) => { err = (err + d.toString()).slice(-300) })
    p.on('error', (e) => { clearTimeout(timer); reject(e) })
    p.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(Buffer.concat(out))
      else reject(new Error(`ffmpeg exited ${code}: ${err.trim()}`))
    })
    // ffmpeg may stop reading early (-t): a closed pipe is not an error
    p.stdin.on('error', () => {})
    p.stdin.end(audio)
  })
}

export function envVoiceNoteDeps(env = process.env): VoiceNoteDeps {
  const key = env.GNANI_API_KEY ?? ''
  return {
    download: (url) => downloadVonageMedia(url, env),
    decode: (audio) => decodeToPcm16k(audio),
    transcribe: key ? async (pcm, locale) => (await transcribeRest(key, pcm, locale, [], undefined, STT_TIMEOUT_MS)).text : null,
  }
}

export async function voiceNoteText(url: string, lang: string, deps: VoiceNoteDeps = envVoiceNoteDeps()): Promise<VoiceNoteResult> {
  if (!deps.transcribe) return { skipped: 'unconfigured' }
  try {
    const pcm = await deps.decode(await deps.download(url))
    if (pcm.length > VOICE_NOTE_MAX_S * PCM_BYTES_PER_S) return { skipped: 'too_long' }
    if (pcm.length < PCM_BYTES_PER_S / 4) return { skipped: 'failed' } // under 0.25 s: nothing said
    const l: Lang = isLang(lang) ? lang : 'hi'
    const text = (await deps.transcribe(pcm, LOCALE[l])).trim()
    return text ? { text: text.slice(0, 1000) } : { skipped: 'failed' }
  } catch {
    return { skipped: 'failed' }
  }
}
