/**
 * The voice session: one voice client, its status and captions, the open question, and the
 * mic button's tap / hold logic. Navigation (which sheet or tab a turn opens) is handed back to
 * the screen through `nav`, read from a ref so the client never holds a stale handler.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { LedgerOp, PendingView, ReadyCard, ServerMsg, TurnMetrics } from '../../shared/protocol.js'
import type { Lang } from '../../shared/replies.js'
import type { KhataStore, VoiceClient, VoiceStatus } from '@/lib/contracts'
import { voiceUrl } from '@/lib/api'
import { clientLog } from '@/lib/log'
import { createVoiceClient } from '@/lib/voice'
import { heardFeedback, primeFeedback, savedFeedback, sleepChime, wakeChime } from './feedback'
import { rs } from './format'
import type { UiStrings } from './strings'

const VOICE_URL = voiceUrl()
export const UNDO_STYLE = { minHeight: 44, minWidth: 64, fontSize: 16, fontWeight: 700 } as const

export type ShowMsg = Extract<ServerMsg, { type: 'show' }>
export type Net = 'good' | 'slow' | 'offline'

export interface VoiceNav {
  /** a question opened: the card must be visible (close sheets) */
  pending: (p: PendingView | null) => void
  /** "show ...": open a view */
  show: (s: ShowMsg) => void
  /** a tool made something ready (null clears it) */
  ready: (r: ReadyCard | null) => void
  /** an entry was just written by voice: highlight it */
  saved: (eid: string) => void
}

export function useVoice(store: KhataStore, t: UiStrings, nav: VoiceNav) {
  const navRef = useRef(nav)
  useEffect(() => { navRef.current = nav })
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [levelSource] = useState(() => new Set<(v: number) => void>())
  /** ledger writes in order; feedback no longer waits for them */
  const writes = useRef<Promise<unknown>>(Promise.resolve())
  const [heard, setHeard] = useState('')
  /** bumps on every "heard you" tick: the orb pulses once */
  const [heardPulse, setHeardPulse] = useState(0)
  /** a tap that cut a reply short: a second tap right after it must not also mute */
  const lastBargeAt = useRef(0)
  /** the heard line was taken as talk to someone else (shown dimmed, marked "not an entry") */
  const [heardIgnored, setHeardIgnored] = useState(false)
  const [said, setSaid] = useState('')
  const [pending, setPendingState] = useState<PendingView | null>(null)
  const [metrics, setMetrics] = useState<(TurnMetrics & { clientFirstAudioMs: number | null }) | null>(null)
  const [on, setOn] = useState(false)
  const [net, setNet] = useState<Net>('good')
  const voice = useRef<VoiceClient | null>(null)
  /** the mic stream is open (or being opened): false for a typed-text-only session */
  const [micReady, setMicReady] = useState(false)
  /** the previous status, to clear the reply caption when speech ends */
  const lastStatus = useRef<VoiceStatus>('idle')
  const ignoredRef = useRef(false)
  const markIgnored = (b: boolean) => { ignoredRef.current = b; setHeardIgnored(b) }
  const ignoredTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** mic button still down / push-to-talk started for this press (hold-to-start can outlast start()) */
  const held = useRef(false)
  const pttOn = useRef(false)
  const setPending = (p: PendingView | null) => { setPendingState(p); navRef.current.pending(p) }

  const onOps = useCallback(async (ops: LedgerOp[]) => {
    // feedback first: the chime, highlight and toast must not wait for the encrypted IndexedDB write
    const e = ops.find((o): o is Extract<LedgerOp, { op: 'entry' }> => o.op === 'entry')
    if (e) {
      navRef.current.saved(e.eid)
      const added = ops.find((o): o is Extract<LedgerOp, { op: 'add_customer' }> => o.op === 'add_customer' && o.cid === e.cid)
      const name = added?.name ?? store.state.customers.get(e.cid)?.name ?? ''
      savedFeedback()
      toast(`${t.saved}: ${name} ${rs(e.paise)}`, {
        action: { label: t.undo, onClick: () => void writes.current.then(() => store.voidEntry(e.eid, 'tap undo')).then(() => voice.current?.sendSnapshot()) },
        actionButtonStyle: UNDO_STYLE,
        duration: 8000,
      })
    }
    const w = writes.current.then(() => store.applyOps(ops))
    writes.current = w.catch(() => {})
    try {
      await w
    } catch (err) {
      toast.error(t.saveFailed)
      clientLog.error('store_write_failed', { error: String(err), ops: ops.map((o) => o.op) })
    }
    voice.current?.sendSnapshot()
  }, [store, t])

  const newTurn = () => {
    if (ignoredTimer.current) clearTimeout(ignoredTimer.current)
    ignoredTimer.current = null
    setSaid('')
  }

  /** Open the connection. `mic: false` (typed text, example chips): socket only, no permission prompt yet. */
  const start = useCallback(async (lang: Lang, mic = true) => {
    if (voice.current) return
    const v = createVoiceClient(VOICE_URL, {
      status: (st) => {
        if (lastStatus.current === 'speaking' && st !== 'speaking') setSaid('') // the reply is over: its caption goes
        lastStatus.current = st
        setStatus(st)
        if (st === 'offline' || (st as string) === 'reconnecting') setPending(null)
      },
      level: (x) => { for (const f of levelSource) f(x) },
      heard: () => { heardFeedback(); setHeardPulse((n) => n + 1) },
      attention: (s) => { if (s === 'awake') wakeChime(); else sleepChime() },
      turnDone: () => {
        // the reply caption stays while its audio plays (cleared when speaking ends); a silent turn clears it now
        if (lastStatus.current !== 'speaking') setSaid('')
        if (ignoredTimer.current) clearTimeout(ignoredTimer.current)
        // "not an entry" stays readable for a few seconds, a normal heard line goes with the turn
        if (ignoredRef.current) ignoredTimer.current = setTimeout(() => { setHeard(''); markIgnored(false) }, 6000)
        else setHeard('')
      },
      micError: () => { setMicReady(false); toast.error(t.micError) },
      partial: (x) => { newTurn(); setHeard(x); markIgnored(false) },
      final: (x) => { navRef.current.ready(null); newTurn(); setHeard(x); markIgnored(false) },
      notEntry: () => markIgnored(true),
      say: (x) => setSaid(x),
      ops: (ops) => onOps(ops),
      network: (s) => setNet(s),
      resent: (text) => toast(`${t.resent}: “${text.length > 60 ? `${text.slice(0, 60)}…` : text}”`, { duration: 6000 }),
      pending: (p) => setPending(p),
      show: (s) => navRef.current.show(s as ShowMsg),
      // settings changed by voice: stored here, and the voice client told (the language is applied by `lang`, the mic stays on)
      setting: (m) => {
        if (m.key === 'speed' && (m.value === 0.8 || m.value === 1 || m.value === 1.2)) { const speed = m.value; void store.updateSettings({ speed }); voice.current?.setSpeed(speed) }
        else if (m.key === 'shopName' && typeof m.value === 'string') void store.updateSettings({ shopName: m.value })
      },
      ready: (m) => { const { type: _type, ...card } = m as ReadyCard & { type?: string }; navRef.current.ready(card as ReadyCard) },
      metrics: setMetrics,
      error: (msg) => clientLog.warn('voice_error', { message: msg }),
      lang: (l) => void store.updateSettings({ lang: l }),
    })
    primeFeedback()
    voice.current = v
    setOn(true)
    setMicReady(mic)
    try {
      await v.start({ lang, snapshot: () => store.snapshot(), firstRun: !store.settings.firstRunDone, handsFree: store.settings.handsFree, speed: store.settings.speed, mic })
      if (mic) v.wake('tap') // tapping the mic to start also wakes it
      if (!store.settings.firstRunDone) void store.updateSettings({ firstRunDone: true })
    } catch {
      voice.current = null
      setOn(false)
      setMicReady(false)
      toast.error(t.micError)
    }
  }, [onOps, store, t]) // eslint-disable-line react-hooks/exhaustive-deps

  const sendTyped = async (text: string) => {
    if (!voice.current) await start(store.settings.lang!, false)
    if (!voice.current) return false
    voice.current.sendText(text)
    return true
  }

  const micTap = () => {
    const v = voice.current
    if (!on || !v) void start(store.settings.lang!)
    else if (status === 'speaking' || status === 'thinking') { lastBargeAt.current = Date.now(); v.bargeIn() } // cut the reply short, stay awake
    else if (status === 'asleep') { setMicReady(true); v.wake('tap') }
    else if (status === 'listening') { if (Date.now() - lastBargeAt.current > 1500) v.sleep() } // a quick second tap is part of the interrupt
  }
  const stop = () => { voice.current?.stop(); voice.current = null; setOn(false); setStatus('idle'); setPending(null); setMicReady(false) }

  const holdStart = () => {
    const handsFree = store.settings.handsFree
    held.current = true
    setMicReady(true)
    if (!on || !voice.current) {
      // start() wakes by itself (tap); released before it finishes = no hold at all, never a second wake
      void start(store.settings.lang!).then(() => {
        if (held.current && voice.current && !store.settings.handsFree) { voice.current.pttDown(); pttOn.current = true }
      })
      return
    }
    voice.current.wake('hold')
    if (!handsFree) { voice.current.pttDown(); pttOn.current = true }
  }
  const holdEnd = () => {
    held.current = false
    voice.current?.holdEnd() // no-op unless a hold wake was sent
    if (pttOn.current) { pttOn.current = false; voice.current?.pttUp() }
  }

  /** a tap answer to the open question */
  const answer = (a: string) => {
    if (a === 'haan') voice.current?.tap('yes')
    else if (a === 'nahi') voice.current?.tap('no')
    else voice.current?.answer(a)
  }
  /** "not an entry" was wrong: save the heard line anyway */
  const saveAnyway = () => { const x = heard; markIgnored(false); setHeard(''); voice.current?.force(x) }
  const snapshot = () => voice.current?.sendSnapshot()

  // keep the screen awake while the khata is listening
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    void navigator.wakeLock.request('screen').then((l) => (lock = l)).catch(() => {})
    return () => void lock?.release()
  }, [on])

  return {
    voice, status, on, micReady, net, heard, heardIgnored, heardPulse, said, pending, metrics, levelSource, writes,
    start, stop, micTap, holdStart, holdEnd, sendTyped, answer, saveAnyway, snapshot,
  }
}
export type Voice = ReturnType<typeof useVoice>
