let ctx: AudioContext | null = null

/** Soft two-tone "cash register" chime (WebAudio, no files) plus a short buzz. */
export function savedFeedback() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (AC) {
      ctx ??= new AC()
      const c = ctx
      if (c.state === 'suspended') void c.resume()
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
