let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  ctx ??= new AC()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** Create the feedback AudioContext inside the mic tap (a user gesture), so the first cue is not late or muted. */
export function primeFeedback() {
  try { audio() } catch { /* sound is a nicety only */ }
}

/** "Heard you": one soft, short tick and a tiny buzz the moment the shopkeeper pauses. */
export function heardFeedback() {
  try {
    const c = audio()
    if (c) {
      const t0 = c.currentTime
      const o = c.createOscillator()
      const g = c.createGain()
      o.type = 'sine'
      o.frequency.value = 1320
      g.gain.setValueAtTime(0.0001, t0)
      g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.005)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.04)
      o.connect(g).connect(c.destination)
      o.start(t0)
      o.stop(t0 + 0.05)
    }
    navigator.vibrate?.(15)
  } catch { /* sound is a nicety only */ }
}

/** Soft two-tone "cash register" chime (WebAudio, no files) plus a short buzz. */
export function savedFeedback() {
  try {
    const c = audio()
    if (c) {
      const t0 = c.currentTime
      for (const [f, d] of [[988, 0], [1480, 0.07]] as const) {
        const o = c.createOscillator()
        const g = c.createGain()
        o.type = 'sine'
        o.frequency.value = f
        g.gain.setValueAtTime(0.0001, t0 + d)
        g.gain.exponentialRampToValueAtTime(0.1, t0 + d + 0.01)
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.09)
        o.connect(g).connect(c.destination)
        o.start(t0 + d)
        o.stop(t0 + d + 0.1)
      }
    }
    navigator.vibrate?.(30)
  } catch { /* sound is a nicety only */ }
}

function notes(freqs: readonly (readonly [number, number])[], peak: number, len: number, buzz: number) {
  try {
    const c = audio()
    if (c) {
      const t0 = c.currentTime
      for (const [f, d] of freqs) {
        const o = c.createOscillator()
        const g = c.createGain()
        o.type = 'sine'
        o.frequency.value = f
        g.gain.setValueAtTime(0.0001, t0 + d)
        g.gain.exponentialRampToValueAtTime(peak, t0 + d + 0.01)
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + len)
        o.connect(g).connect(c.destination)
        o.start(t0 + d)
        o.stop(t0 + d + len + 0.01)
      }
    }
    if (buzz) navigator.vibrate?.(buzz)
  } catch { /* sound is a nicety only */ }
}

/** Awake: a short rising two-note "I'm listening". */
export function wakeChime() {
  notes([[660, 0], [990, 0.09]], 0.1, 0.12, 20)
}

/** Back to sleep: a softer, falling two-note. */
export function sleepChime() {
  notes([[740, 0], [494, 0.1]], 0.05, 0.14, 0)
}
