/**
 * Frame-energy tracker on the server's copy of the mic stream (16 kHz s16le, 512-sample frames).
 *
 * - Adaptive noise floor (falls fast, rises slowly) so a noisy shop doesn't count as speech.
 * - Pause detection: how long since the last speech frame, for the early `commit`.
 * - Per-utterance SNR estimate: drives "always read back the amount" when the shop is loud,
 *   because the noise benchmark showed Prisma's wrong amounts cluster at <= 0 dB.
 */

export const FRAME_SAMPLES = 512
export const FRAME_MS = (FRAME_SAMPLES / 16000) * 1000 // 32 ms

const SPEECH_OVER_FLOOR_DB = 9
const FLOOR_WINDOW = Math.round(4000 / FRAME_MS) // noise floor = 10th percentile of the last 4 s
const FLOOR_PCT = 0.1
const MIN_DB = -100

export interface EnergyState {
  floorDb: number
  history: number[] // recent frame levels (dB), ring buffer
  pos: number
  speechFrames: number
  speechPowerSum: number // linear power over the utterance span (first to last speech frame)
  spanFrames: number
  gapPower: number // frames since the last speech frame, added to the span only if speech resumes
  gapFrames: number
  silentMs: number // since the last speech frame
  inUtterance: boolean
}

export function newEnergyState(): EnergyState {
  return { floorDb: MIN_DB, history: [], pos: 0, speechFrames: 0, speechPowerSum: 0, spanFrames: 0, gapPower: 0, gapFrames: 0, silentMs: 0, inUtterance: false }
}

const toDb = (p: number) => (p > 0 ? Math.max(MIN_DB, 10 * Math.log10(p)) : MIN_DB)

/** Mean power (linear, full scale = 1) of one PCM s16le frame. */
export function framePower(pcm: Int16Array): number {
  let s = 0
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i] / 32768
    s += v * v
  }
  return pcm.length ? s / pcm.length : 0
}

/** Feed one frame; returns whether it was speech. Mutates `st`. */
export function pushFrame(st: EnergyState, pcm: Int16Array): boolean {
  const p = framePower(pcm)
  const db = toDb(p)
  if (st.history.length < FLOOR_WINDOW) st.history.push(db)
  else st.history[st.pos] = db
  st.pos = (st.pos + 1) % FLOOR_WINDOW
  // percentile floor: speech rarely fills a whole 4 s window, so the low tail is the noise
  const sorted = [...st.history].sort((a, b) => a - b)
  st.floorDb = sorted[Math.floor((sorted.length - 1) * FLOOR_PCT)]
  // need ~200 ms of history before calling anything speech
  const speech = st.history.length >= 6 && db > st.floorDb + SPEECH_OVER_FLOOR_DB
  if (!speech) {
    st.silentMs += FRAME_MS
    if (st.inUtterance) {
      st.gapPower += p
      st.gapFrames++
    }
  } else {
    st.silentMs = 0
    st.inUtterance = true
    st.speechFrames++
    st.speechPowerSum += st.gapPower + p
    st.spanFrames += st.gapFrames + 1
    st.gapPower = 0
    st.gapFrames = 0
  }
  return speech
}

/** Estimated SNR of the current utterance in dB (null until there is some speech). */
export function utteranceSnrDb(st: EnergyState): number | null {
  if (st.speechFrames < 5) return null
  const ps = st.speechPowerSum / st.spanFrames
  const pn = 10 ** (st.floorDb / 10)
  return toDb(Math.max(ps - pn, 1e-12) / pn)
}

/** Call after the turn is committed. Keeps the noise floor. */
export function resetUtterance(st: EnergyState): void {
  st.speechFrames = 0
  st.speechPowerSum = 0
  st.spanFrames = 0
  st.gapPower = 0
  st.gapFrames = 0
  st.silentMs = 0
  st.inUtterance = false
}

/**
 * "Too noisy to save without reading back." Calibrated on real DEMAND + Hindi babble mixes
 * (eval/snr_check.ts): the estimate reads ~4-7 dB high at low SNR. A true 5 dB mix estimates
 * 6.4-14.5 dB (median ~10), a true 10 dB mix 10.5-18.3 dB; Prisma's wrong amounts began at true <= 0 dB.
 * A null estimate (speech never cleared the floor) also counts as noisy.
 */
export const NOISY_EST_DB = 11

export function tooNoisy(st: EnergyState): boolean {
  const snr = utteranceSnrDb(st)
  return snr === null || snr < NOISY_EST_DB
}
