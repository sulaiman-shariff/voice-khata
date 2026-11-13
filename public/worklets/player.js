/* Reply player worklet: Int16 16 kHz PCM chunks -> context rate, jitter buffer, duck/stop. */
const IN_RATE = 16000
const PREBUFFER_SAMPLES = Math.round(IN_RATE * 0.06)
const DUCK_GAIN = 0.25

class PlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.ratio = IN_RATE / sampleRate // input samples consumed per output sample
    this.queue = [] // Float32Array chunks
    this.off = 0 // read offset in queue[0]
    this.frac = 0
    this.avail = 0 // unread input samples
    this.playing = false
    this.ended = false
    this.gain = 1
    this.gainTarget = 1
    this.gainStep = 0
    this.fadeLeft = 0
    this.fadeTotal = 1
    this.fadeFrom = 0
    this.last = 0
    this.port.onmessage = (e) => this.onMessage(e.data)
  }

  onMessage(m) {
    switch (m.type) {
      case 'pcm': {
        const i16 = new Int16Array(m.buf, 0, m.buf.byteLength >> 1)
        if (i16.length === 0) return
        const f = new Float32Array(i16.length)
        for (let i = 0; i < i16.length; i++) f[i] = i16[i] / 32768
        this.queue.push(f)
        this.avail += f.length
        break
      }
      case 'duck':
        if (!this.playing) break // nothing audible to duck; do not carry into the next reply
        this.gainTarget = DUCK_GAIN
        this.gainStep = (1 - DUCK_GAIN) / (0.03 * sampleRate)
        break
      case 'unduck':
        this.gainTarget = 1
        this.gainStep = (1 - DUCK_GAIN) / (0.03 * sampleRate)
        break
      case 'stop':
        this.queue = []
        this.off = 0
        this.frac = 0
        this.avail = 0
        this.playing = false
        this.ended = false
        this.gain = 1
        this.gainTarget = 1
        this.fadeFrom = this.last
        this.fadeTotal = Math.max(1, Math.round(0.01 * sampleRate))
        this.fadeLeft = this.fadeTotal
        break
      case 'end':
        this.ended = true
        break
    }
  }

  process(inputs, outputs) {
    const out = outputs[0][0]
    const n = out.length

    if (!this.playing && this.avail > 0 && (this.avail >= PREBUFFER_SAMPLES || this.ended)) {
      this.playing = true
      // a reply never starts ducked: duck is only meaningful while the previous reply plays
      this.gain = 1
      this.gainTarget = 1
      this.port.postMessage({ type: 'started' })
    }

    let i = 0
    if (this.playing) {
      for (; i < n; i++) {
        const need = this.ended ? 1 : 2
        if (this.avail < need) break
        const cur = this.queue[0]
        const a = cur[this.off]
        let b = a
        if (this.avail >= 2) b = this.off + 1 < cur.length ? cur[this.off + 1] : this.queue[1][0]
        if (this.gain !== this.gainTarget) {
          if (this.gain < this.gainTarget) this.gain = Math.min(this.gainTarget, this.gain + this.gainStep)
          else this.gain = Math.max(this.gainTarget, this.gain - this.gainStep)
        }
        const s = (a + (b - a) * this.frac) * this.gain
        out[i] = s
        this.last = s
        this.frac += this.ratio
        while (this.frac >= 1) {
          this.frac -= 1
          this.off++
          this.avail--
          if (this.off >= this.queue[0].length) {
            this.queue.shift()
            this.off = 0
          }
          if (this.avail <= 0) break
        }
      }
    }
    // fade-out tail after stop, otherwise silence
    for (; i < n; i++) {
      if (this.fadeLeft > 0) {
        out[i] = this.fadeFrom * (this.fadeLeft / this.fadeTotal)
        this.fadeLeft--
        if (this.fadeLeft === 0) this.last = 0
      } else {
        out[i] = 0
      }
    }

    if (this.ended && this.avail <= 0) {
      this.ended = false
      this.playing = false
      this.queue = []
      this.off = 0
      this.frac = 0
      this.avail = 0
      this.gain = 1
      this.gainTarget = 1
      this.port.postMessage({ type: 'drained' })
    }
    return true
  }
}

registerProcessor('player', PlayerProcessor)
