/**
 * Listen in several languages at once. Prisma's realtime stream recognises one language, but a
 * shopkeeper (or a judge) may speak any of them in any session. This opens one stream per
 * language on the same audio and, for each utterance, hands the session the transcript that
 * reads best (the session decides: `pick`). Measured: three parallel streams open in ~0.4 s and
 * their finals arrive within a few ms of each other, so this adds no wait in practice.
 *
 * To the session it looks like one stream: speech start/end, partials, open/error/close come from
 * the primary stream (the session's language); finals are grouped per utterance across streams.
 */
import type { SttEvents } from './stt.js'

export interface Heard {
  text: string
  locale: string
}

/** What one underlying recogniser must offer (SttStream does). */
export interface SttLikeStream {
  send(pcm: Buffer): void
  commit(): void
  setKeyterms(terms: string[]): void
  setLanguage?(locale: string): void
  close(): void
}

export interface MultiEvents extends SttEvents {
  /** Choose among one utterance's transcripts (index into `heard`); default: the primary's. */
  pick?: (heard: Heard[]) => number
}

/** How long to wait for the other languages' finals after the first one arrives. */
export const GROUP_MS = 350

export class MultiStt {
  private streams: { locale: string; s: SttLikeStream }[]
  private group: { texts: Map<string, string>; done: Set<string>; timer: ReturnType<typeof setTimeout> } | null = null

  constructor(
    locales: string[],
    open: (locale: string, ev: SttEvents) => SttLikeStream,
    private ev: MultiEvents,
    private groupMs = GROUP_MS,
  ) {
    const uniq = locales.filter((l, i) => locales.indexOf(l) === i)
    this.streams = []
    for (const locale of uniq) {
      const x = { locale, s: null as unknown as SttLikeStream }
      const primary = () => this.streams[0] === x
      x.s = open(locale, {
        onOpen: () => { if (primary()) ev.onOpen?.() },
        onSpeechStart: () => { if (primary()) ev.onSpeechStart?.() },
        onSpeechEnd: () => { if (primary()) ev.onSpeechEnd?.() },
        onPartial: (t) => { if (primary()) ev.onPartial?.(t) },
        onFinal: (t) => this.final(x.locale, t),
        onError: (m) => { if (primary()) ev.onError?.(m) },
        onClose: (c) => { if (primary()) ev.onClose?.(c) },
      })
      this.streams.push(x)
    }
  }

  get locales(): string[] {
    return this.streams.map((x) => x.locale)
  }

  private final(locale: string, text: string) {
    if (!this.group) {
      const timer = setTimeout(() => this.flush(), this.groupMs)
      timer.unref?.()
      this.group = { texts: new Map(), done: new Set(), timer }
    }
    const g = this.group
    const t = text.trim()
    // a stream that split the utterance in two: keep both halves
    if (t) g.texts.set(locale, g.texts.has(locale) ? `${g.texts.get(locale)} ${t}` : t)
    g.done.add(locale)
    if (g.done.size >= this.streams.length) this.flush()
  }

  private flush() {
    const g = this.group
    if (!g) return
    clearTimeout(g.timer)
    this.group = null
    // primary first, so ties go to the session's language
    const heard: Heard[] = this.streams.filter((x) => g.texts.has(x.locale)).map((x) => ({ locale: x.locale, text: g.texts.get(x.locale)! }))
    if (!heard.length) {
      this.ev.onFinal?.('', this.streams[0].locale)
      return
    }
    const i = heard.length > 1 && this.ev.pick ? this.ev.pick(heard) : 0
    const h = heard[Math.max(0, Math.min(heard.length - 1, i))]
    this.ev.onFinal?.(h.text, h.locale)
  }

  send(pcm: Buffer) {
    for (const x of this.streams) x.s.send(pcm)
  }

  commit() {
    for (const x of this.streams) x.s.commit()
  }

  setKeyterms(terms: string[]) {
    for (const x of this.streams) x.s.setKeyterms(terms)
  }

  /** The session switched language: that stream becomes the primary (or the primary switches). */
  setLanguage(locale: string) {
    const at = this.streams.findIndex((x) => x.locale === locale)
    if (at > 0) {
      const [x] = this.streams.splice(at, 1)
      this.streams.unshift(x)
    } else if (at < 0) {
      this.streams[0].s.setLanguage?.(locale)
      this.streams[0].locale = locale
    }
  }

  close() {
    if (this.group) clearTimeout(this.group.timer)
    this.group = null
    for (const x of this.streams) x.s.close()
  }
}
