/**
 * Sarvam speech-to-text, used only as a second opinion on Gnani's reading (see Session: verify).
 * saaras:v4 with language auto-detect, so it reads a turn in whatever language was spoken.
 * Docs: https://docs.sarvam.ai/api-reference-docs/speech-to-text/transcribe
 */

/** 16 kHz mono s16le PCM as WAV. */
function wav(pcm: Buffer): Buffer {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12)
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24)
  h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}

/** The REST endpoint is meant for clips under 30 s: keep the end of anything longer (where the entry usually is). */
const MAX_BYTES = 28 * 32000

export async function transcribeSarvam(key: string, pcm: Buffer, keyterms: string[] = [], timeoutMs = 4000): Promise<{ text: string; lang?: string }> {
  const clip = pcm.length > MAX_BYTES ? pcm.subarray(pcm.length - MAX_BYTES) : pcm
  const fd = new FormData()
  fd.append('file', new Blob([new Uint8Array(wav(clip))], { type: 'audio/wav' }), 'turn.wav')
  fd.append('model', 'saaras:v4')
  fd.append('mode', 'transcribe')
  fd.append('language_code', 'unknown')
  // up to 50 terms of up to 64 characters
  const terms = keyterms.filter((t) => t && t.length <= 64).slice(0, 50)
  if (terms.length) fd.append('keyterms', JSON.stringify(terms))
  const r = await fetch('https://api.sarvam.ai/speech-to-text', {
    method: 'POST', headers: { 'api-subscription-key': key }, body: fd, signal: AbortSignal.timeout(timeoutMs),
  })
  if (!r.ok) throw new Error(`sarvam stt ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const j = (await r.json()) as { transcript?: string; language_code?: string | null }
  return { text: j.transcript ?? '', lang: j.language_code ?? undefined }
}
