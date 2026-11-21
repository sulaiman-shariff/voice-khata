/**
 * Gnani Prisma v3.0 REST STT (clips up to 30 s), used as a second, independent reading of a
 * noisy turn. `format=verbatim` spells numbers out, so our own number-word parser reads the
 * amount instead of Prisma's digit formatter: two different paths to the same number.
 */
const REST_URL = 'https://api.vachana.ai/stt/v3'
export const REST_TIMEOUT_MS = 1500
const MAX_BYTES = 30 * 16000 * 2

/** 16 kHz mono s16le PCM -> WAV bytes. */
export function wav16k(pcm: Buffer): Buffer {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + pcm.length, 4)
  h.write('WAVE', 8)
  h.write('fmt ', 12)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20) // PCM
  h.writeUInt16LE(1, 22) // mono
  h.writeUInt32LE(16000, 24)
  h.writeUInt32LE(32000, 28)
  h.writeUInt16LE(2, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36)
  h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}

/**
 * `locale` is a hint on REST, not a lock: Kannada speech sent with `hi-IN` comes back in
 * Kannada with `detected_language_code: kn-IN` (probed 2026-11-21; realtime instead forces the
 * session language). That is what lets a turn in another language be rescued.
 */
export async function transcribeRest(key: string, pcm: Buffer, locale: string, keyterms: string[] = [], previousText?: string, timeoutMs = REST_TIMEOUT_MS): Promise<{ text: string; lang?: string }> {
  const clip = pcm.length > MAX_BYTES ? pcm.subarray(pcm.length - MAX_BYTES) : pcm
  const fd = new FormData()
  fd.append('audio_file', new Blob([new Uint8Array(wav16k(clip))], { type: 'audio/wav' }), 'turn.wav')
  fd.append('model', 'prisma-v3.0')
  fd.append('language_code', locale)
  fd.append('format', 'verbatim')
  if (keyterms.length) fd.append('keyterms', JSON.stringify(keyterms.slice(0, 200)))
  // what the agent just asked helps a short answer; values with "<|" "|>" are rejected, 12 chars is the docs' guard
  const prev = previousText?.replace(/<\|?|\|?>/g, ' ').trim()
  if (prev && prev.length >= 12) fd.append('previous_text', prev.slice(-600))
  const res = await fetch(REST_URL, {
    method: 'POST',
    headers: { 'X-API-Key-ID': key },
    body: fd,
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`stt rest ${res.status}: ${(await res.text()).slice(0, 120)}`)
  const body = (await res.json()) as { transcript?: string; detected_language_code?: string }
  return { text: body.transcript ?? '', lang: body.detected_language_code }
}
