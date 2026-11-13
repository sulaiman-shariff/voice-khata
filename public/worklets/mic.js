/* Mic capture worklet: mono input -> 16 kHz Int16 LE, 512-sample frames + RMS level.
 * Logic mirrors src/lib/pcm.ts (keep identical). */
const TARGET_RATE = 16000
const FRAME_SAMPLES = 512

class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.ratio = sampleRate / TARGET_RATE
    this.pos = 0
    this.prev = 0
    // boxcar low-pass over one decimation window, applied before decimating (anti-alias)
    this.win = Math.max(1, Math.round(this.ratio))
    this.hist = new Float32Array(this.win)
    this.hpos = 0
    this.hsum = 0
    this.buf = new Int16Array(FRAME_SAMPLES)
    this.fill = 0
  }

  emit(s) {
    this.buf[this.fill++] = s
    if (this.fill === FRAME_SAMPLES) {
      const frame = this.buf
      let sum = 0
      for (let i = 0; i < FRAME_SAMPLES; i++) {
        const v = frame[i] / 32768
        sum += v * v
      }
      const level = Math.min(1, Math.sqrt(sum / FRAME_SAMPLES))
      this.buf = new Int16Array(FRAME_SAMPLES)
      this.fill = 0
      this.port.postMessage({ buf: frame.buffer, level }, [frame.buffer])
    }
  }

  static toInt16(x) {
    if (x > 1) x = 1
    else if (x < -1) x = -1
    return Math.round(x < 0 ? x * 32768 : x * 32767)
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (!ch || ch.length === 0) return true
    if (sampleRate === TARGET_RATE) {
      for (let i = 0; i < ch.length; i++) this.emit(MicProcessor.toInt16(ch[i]))
      return true
    }
    const n = ch.length
    if (this.win > 1) {
      const f = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        this.hsum += ch[i] - this.hist[this.hpos]
        this.hist[this.hpos] = ch[i]
        this.hpos = (this.hpos + 1) % this.win
        f[i] = this.hsum / this.win
      }
      return this.decimate(f)
    }
    return this.decimate(ch)
  }

  decimate(ch) {
    const n = ch.length
    let pos = this.pos
    while (pos < n - 1) {
      const idx = Math.floor(pos)
      const frac = pos - idx
      const a = idx < 0 ? this.prev : ch[idx]
      const b = ch[idx + 1]
      this.emit(MicProcessor.toInt16(a + (b - a) * frac))
      pos += this.ratio
    }
    this.pos = pos - n
    this.prev = ch[n - 1]
    return true
  }
}

registerProcessor('mic', MicProcessor)
