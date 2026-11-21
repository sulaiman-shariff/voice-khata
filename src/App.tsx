import { BellRing, Keyboard, Plus, Search, Settings2, ShieldCheck } from 'lucide-react'
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { balance, daySummary, dues, promises } from '../shared/ledger.js'
import type { LedgerOp, PendingView, TurnMetrics } from '../shared/protocol.js'
import { LANG_NAME, LANGS, type Lang } from '../shared/replies.js'
import { Toaster } from '@/components/ui/sonner'
import { createBackupClient } from '@/lib/backup'
import type { KhataStore, VoiceClient, VoiceStatus } from '@/lib/contracts'
import { createStore, idbPersistence } from '@/lib/store'
import { cn } from '@/lib/utils'
import { createVoiceClient, defaultVoiceUrl } from '@/lib/voice'
import { ago, dayOfTs, initials, relDay, rs, rsShort, today } from '@/ui/format'
import { EntrySheet, TypeSheet, type EntryMode } from '@/ui/EntrySheet'
import { heardFeedback, primeFeedback, savedFeedback, sleepChime, wakeChime } from '@/ui/feedback'
import { clientLog } from '@/lib/log'
import { DayFeed } from '@/ui/Ledger'
import { MicButton, PendingCard, Waterfall } from '@/ui/parts'
import { CustomerSheet, PrivacySheet, SettingsSheet, remindLink } from '@/ui/Sheets'
import { ui } from '@/ui/strings'

const ConfirmPage = lazy(() => import('@/pages/ConfirmPage'))
const backup = createBackupClient()

export default function App() {
  const m = location.pathname.match(/^\/c\/([A-Za-z0-9_-]+)/)
  if (m) return <Suspense fallback={null}><ConfirmPage token={m[1]} /></Suspense>
  return <ShopApp />
}

function ShopApp() {
  const [store, setStore] = useState<KhataStore | null>(null)
  useEffect(() => { void createStore(idbPersistence()).then(setStore) }, [])
  if (!store) return <div className="grid h-full place-items-center text-muted-foreground">…</div>
  return <Home store={store} />
}

const VOICE_URL = (import.meta.env.VITE_VOICE_URL as string | undefined) ?? defaultVoiceUrl()

function Home({ store }: { store: KhataStore }) {
  const state = useSyncExternalStore(store.subscribe, () => store.state)
  const settings = store.settings
  const t = ui(settings.lang)
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const levelSource = useRef(new Set<(v: number) => void>()).current
  /** ledger writes in order; feedback no longer waits for them */
  const writes = useRef<Promise<unknown>>(Promise.resolve())
  const [heard, setHeard] = useState('')
  /** the heard line was taken as talk to someone else (shown dimmed, marked "not an entry") */
  const [heardIgnored, setHeardIgnored] = useState(false)
  const [said, setSaid] = useState('')
  const [pending, setPending] = useState<PendingView | null>(null)
  const [metrics, setMetrics] = useState<(TurnMetrics & { clientFirstAudioMs: number | null }) | null>(null)
  const [tab, setTab] = useState<'today' | 'dues'>('today')
  const [cid, setCid] = useState<string | null>(null)
  const [sheet, setSheet] = useState<'settings' | 'privacy' | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  const [on, setOn] = useState(false)
  const [net, setNet] = useState<'good' | 'slow' | 'offline'>('good')
  const [entry, setEntry] = useState<EntryMode>(null)
  const [entryFrom, setEntryFrom] = useState<string | null>(null)
  const [typing, setTyping] = useState(false)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'amount' | 'name'>('amount')
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

  const onOps = useCallback(async (ops: LedgerOp[]) => {
    // feedback first: the chime, highlight and toast must not wait for the encrypted IndexedDB write
    const e = ops.find((o): o is Extract<LedgerOp, { op: 'entry' }> => o.op === 'entry')
    if (e) {
      setFresh(e.eid)
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
      level: (v) => { for (const f of levelSource) f(v) },
      heard: heardFeedback,
      attention: (s) => { if (s === 'awake') wakeChime(); else sleepChime() },
      turnDone: () => {
        // the reply caption stays while its audio plays (cleared when speaking ends); a silent turn clears it now
        if (lastStatus.current !== 'speaking') setSaid('')
        if (ignoredTimer.current) clearTimeout(ignoredTimer.current)
        // "not an entry" stays readable for a few seconds, a normal heard line goes with the turn
        if (ignoredRef.current) ignoredTimer.current = setTimeout(() => { setHeard(''); markIgnored(false) }, 3000)
        else setHeard('')
      },
      micError: () => { setMicReady(false); toast.error(t.micError) },
      partial: (x) => { newTurn(); setHeard(x); markIgnored(false) },
      final: (x) => { newTurn(); setHeard(x); markIgnored(false) },
      notEntry: () => markIgnored(true),
      say: (x) => setSaid(x),
      ops: (ops) => onOps(ops),
      network: (s) => setNet(s),
      resent: (text) => toast(`${t.resent}: “${text.length > 60 ? `${text.slice(0, 60)}…` : text}”`, { duration: 6000 }),
      pending: (p) => {
        setPending(p)
        if (p) { setCid(null); setSheet(null); setEntry(null); setTyping(false) } // the question card must be visible
      },
      show: (s) => {
        if (s.view === 'customer') setCid(s.cid)
        else if (s.view === 'dues') setTab('dues')
        else if (s.view === 'summary') setTab('today')
        else if (s.view === 'privacy') setSheet('privacy')
      },
      remind: (c, text) => { try { if (c && text) remindLink(store, c, text) } catch (e) { clientLog.warn('remind_failed', { error: String(e) }) } },
      metrics: setMetrics,
      error: (msg) => clientLog.warn('voice_error', { message: msg }),
      lang: (l) => void store.updateSettings({ lang: l }),
    })
    primeFeedback()
    voice.current = v
    setOn(true)
    setMicReady(mic)
    try {
      await v.start({ lang, snapshot: () => store.snapshot(), firstRun: !store.settings.firstRunDone, handsFree: store.settings.handsFree, fastSpeech: store.settings.fastSpeech, readBackAll: store.settings.readBackAll, mic })
      if (mic) v.wake('tap') // tapping the mic to start also wakes it
      if (!store.settings.firstRunDone) void store.updateSettings({ firstRunDone: true })
    } catch {
      voice.current = null
      setOn(false)
      setMicReady(false)
      toast.error(t.micError)
    }
  }, [onOps, store, t])

  const sendTyped = async (text: string) => {
    if (!voice.current) await start(store.settings.lang!, false)
    if (!voice.current) return false
    voice.current.sendText(text)
    return true
  }
  const openEntry = (eid: string) => { setEntryFrom(cid); setCid(null); setEntry({ kind: 'edit', eid }) }
  const closeEntry = () => { setEntry(null); if (entryFrom) setCid(entryFrom); setEntryFrom(null) }
  const onSaved = (eid: string, how: 'new' | 'edit' | 'removed') => {
    const e = store.state.entries.get(eid)
    const nm = e ? store.state.customers.get(e.cid)?.name ?? '' : ''
    if (how === 'removed') { toast(`${t.removed}: ${nm}`); return }
    savedFeedback()
    setFresh(eid)
    toast(`${t.saved}: ${nm} ${e ? rs(e.paise) : ''}`, {
      action: how === 'new' ? { label: t.undo, onClick: () => void store.voidEntry(eid, 'tap undo').then(() => voice.current?.sendSnapshot()) } : undefined,
      actionButtonStyle: UNDO_STYLE,
      duration: 8000,
    })
  }

  const micTap = () => {
    const v = voice.current
    if (!on || !v) void start(settings.lang!)
    else if (status === 'speaking' || status === 'thinking') v.bargeIn() // cut the reply short, stay awake
    else if (status === 'asleep') { setMicReady(true); v.wake('tap') }
    else if (status === 'listening') v.sleep()
  }
  const stop = () => { voice.current?.stop(); voice.current = null; setOn(false); setStatus('idle'); setPending(null); setMicReady(false) }

  // keep the screen awake while the khata is listening
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    void navigator.wakeLock.request('screen').then((l) => (lock = l)).catch(() => {})
    return () => void lock?.release()
  }, [on])

  if (!settings.lang) return <Onboarding onPick={(l) => void store.updateSettings({ lang: l }).then(() => start(l))} />

  const day = daySummary(state, today())
  const all = state.order.map((id) => state.entries.get(id)!)
  const due = dues(state)
  const totalDue = due.reduce((n, d) => n + d.paise, 0)
  const proms = promises(state)
  const name = (c: string) => state.customers.get(c)?.name ?? '—'
  const lastDay = new Map<string, string>()
  for (const e of all) if (!e.voided) { const d = e.promise ? dayOfTs(e.ts) : e.day; if (d > (lastDay.get(e.cid) ?? '')) lastDay.set(e.cid, d) }
  const needle = q.trim().toLowerCase()
  const shownDues = due
    .filter((d) => { const c = state.customers.get(d.cid); return !needle || !!c && (c.name.toLowerCase().includes(needle) || c.aliases.some((a) => a.toLowerCase().includes(needle))) })
    .sort((a, b) => (sort === 'name' ? name(a.cid).localeCompare(name(b.cid), t.loc) : b.paise - a.paise))
  const statusText = !on || (!micReady && status === 'asleep') ? (settings.handsFree ? t.tapToTalk : t.hold) : status === 'offline' ? t.offline : status === 'thinking' ? t.thinking : status === 'speaking' ? t.speaking : status === 'connecting' ? '…' : status === 'asleep' ? t.sayKhataBhai : settings.handsFree ? t.awake : t.hold

  return (
    <div className="mx-auto flex h-full max-w-md flex-col">
      <header className="flex items-center gap-1.5 px-4 pt-4">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-lg font-black text-primary-foreground">₹</div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-bold leading-tight">{settings.shopName}</div>
          <div className="text-xs text-muted-foreground">KhataBhai · AI</div>
        </div>
        <button aria-label={t.language} onClick={() => setSheet('settings')} className="h-11 shrink-0 rounded-full px-3 text-sm font-semibold ring-1 ring-black/15">{LANG_NAME[settings.lang]}</button>
        <button aria-label={t.myData} onClick={() => setSheet('privacy')} className="grid size-11 shrink-0 place-items-center rounded-full hover:bg-muted"><ShieldCheck className="size-5" /></button>
        <button aria-label={t.settings} onClick={() => setSheet('settings')} className="grid size-11 shrink-0 place-items-center rounded-full hover:bg-muted"><Settings2 className="size-5" /></button>
      </header>

      <section className="mx-4 mt-3 grid grid-cols-3 gap-1.5">
        <Stat label={`${t.today} · ${t.credit}`} value={rsShort(day.creditPaise)} className="text-credit" />
        <Stat label={`${t.today} · ${t.payment}`} value={rsShort(day.paymentPaise)} className="text-payment" />
        <Stat label={t.totalDues} value={rsShort(totalDue)} className="text-foreground" tint />
      </section>

      <div className="mx-4 mt-3 flex gap-2">
        <nav className="grid flex-1 grid-cols-2 rounded-2xl bg-muted p-1 text-base font-semibold">
          {(['today', 'dues'] as const).map((k) => (
            <button key={k} onClick={() => setTab(k)} className={cn('min-h-11 rounded-xl', tab === k && 'bg-card shadow-sm')}>
              {k === 'today' ? t.history : `${t.dues} · ${due.length}`}
            </button>
          ))}
        </nav>
        <button aria-label={t.addEntry} onClick={() => setEntry({ kind: 'new' })} className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm active:scale-95"><Plus className="size-6" /></button>
      </div>

      <main className="flex-1 space-y-2 overflow-y-auto px-4 pt-2 pb-64">
        {settings.showLatency && metrics && <Waterfall m={metrics} />}
        {tab === 'today' ? (
          all.length ? <DayFeed entries={all} t={t} name={name} fresh={fresh} onEntry={(eid) => setEntry({ kind: 'edit', eid })} />
            : (
              <div className="rounded-2xl border-2 border-dashed p-5 text-center">
                <div className="text-base text-muted-foreground">{t.noEntries}</div>
                <div className="mt-4 mb-2 text-sm font-semibold">{t.tryThese}</div>
                <div className="flex flex-col gap-2">
                  {[t.ex1, t.ex2, t.ex3].map((x) => (
                    <button key={x} onClick={() => void sendTyped(x)} className="min-h-12 rounded-2xl bg-card px-4 py-2 text-lg font-medium shadow-sm ring-1 ring-primary/30 active:scale-[.98]">“{x}”</button>
                  ))}
                </div>
              </div>
            )
        ) : (
          <>
            <div className="flex items-center gap-2">
              <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl bg-card px-3 ring-1 ring-black/10">
                <Search className="size-4 shrink-0 text-muted-foreground" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.search} aria-label={t.search} className="min-w-0 flex-1 bg-transparent text-base outline-none" />
              </label>
              <div className="grid grid-cols-2 rounded-xl bg-muted p-0.5 text-sm font-semibold">
                <button onClick={() => setSort('amount')} className={cn('min-h-11 rounded-lg px-2.5', sort === 'amount' && 'bg-card shadow-sm')}>₹ {t.sortBig}</button>
                <button onClick={() => setSort('name')} className={cn('min-h-11 rounded-lg px-2.5', sort === 'name' && 'bg-card shadow-sm')}>A–Z</button>
              </div>
            </div>
            {shownDues.map((d) => (
              <button key={d.cid} onClick={() => setCid(d.cid)} className="flex min-h-16 w-full items-center gap-3 rounded-2xl bg-card px-4 py-3 text-left shadow-sm ring-1 ring-black/5 active:bg-muted/60">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 font-bold text-primary">{initials(name(d.cid))}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-lg font-semibold leading-snug">{name(d.cid)}</span>
                  {lastDay.get(d.cid) && <span className="block text-sm text-muted-foreground">{ago(lastDay.get(d.cid)!, t)}</span>}
                </span>
                {state.customers.get(d.cid)?.remindersOptIn && <BellRing className="size-4 shrink-0 text-muted-foreground" aria-label={t.reminders} />}
                <span className="num text-2xl font-bold text-credit">{rs(d.paise)}</span>
              </button>
            ))}
            {q && shownDues.length === 0 && <div className="py-6 text-center text-muted-foreground">{t.noMatch}</div>}
            {proms.length > 0 && <div className="pt-3 text-sm font-semibold text-muted-foreground">{t.promise}</div>}
            {proms.map((p) => (
              <button key={p.eid} onClick={() => setCid(p.cid)} className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-amber-50 px-4 py-3 text-left ring-1 ring-amber-200">
                <span className="min-w-0 flex-1 truncate text-lg font-semibold">{name(p.cid)}</span>
                <span className={cn('text-sm', p.day < today() ? 'font-semibold text-destructive' : 'text-amber-800')}>{t.due} {relDay(p.day, t)}</span>
                <span className="num text-xl font-bold text-amber-800">{rs(p.paise)}</span>
                <span className="num text-xs text-muted-foreground">/ {rs(balance(state, p.cid))}</span>
              </button>
            ))}
          </>
        )}
      </main>

      <footer className="pointer-events-none fixed inset-x-0 bottom-0 mx-auto max-w-md bg-gradient-to-t from-background via-background/95 to-transparent px-4 pt-10 pb-5">
        <div className="pointer-events-auto space-y-3">
          {pending && <PendingCard p={pending} t={t} onAnswer={(a) => {
            if (a === 'haan') voice.current?.tap('yes')
            else if (a === 'nahi') voice.current?.tap('no')
            else voice.current?.answer(a)
          }} />}
          {on && (net !== 'good' || status === 'offline') && (
            <div role="status" className={cn('rounded-xl px-3 py-1.5 text-center text-sm font-medium', net === 'offline' || status === 'offline' ? 'bg-destructive/10 text-destructive' : 'bg-amber-500/15 text-amber-800 dark:text-amber-300')}>
              {net === 'offline' || status === 'offline' ? t.netOffline : t.netSlow}
            </div>
          )}
          {(heard || said) && on && (
            <div className="space-y-1 text-center">
              {heard && (
                <div className={cn('truncate text-sm text-muted-foreground', heardIgnored && 'opacity-60')}>
                  “{heard}”{heardIgnored && <span className="ml-1.5 rounded-full bg-muted px-2 py-0.5 text-xs">{t.notEntry}</span>}
                </div>
              )}
              {said && <div className="text-base font-medium">{said}</div>}
            </div>
          )}
          <div className="flex flex-col items-center">
            <div className="flex items-center justify-center gap-5">
              <button aria-label={t.typeInstead} onClick={() => setTyping(true)} className="grid size-14 place-items-center rounded-full bg-card shadow-md ring-1 ring-black/10 active:scale-95"><Keyboard className="size-6" /></button>
              <MicButton
                status={status} levelSource={levelSource} on={on} handsFree={settings.handsFree} t={t}
                onTap={micTap}
                onHoldStart={() => {
                  held.current = true
                  setMicReady(true)
                  if (!on || !voice.current) {
                    // start() wakes by itself (tap); released before it finishes = no hold at all, never a second wake
                    void start(settings.lang!).then(() => {
                      if (held.current && voice.current && !settings.handsFree) { voice.current.pttDown(); pttOn.current = true }
                    })
                    return
                  }
                  voice.current.wake('hold')
                  if (!settings.handsFree) { voice.current.pttDown(); pttOn.current = true }
                }}
                onHoldEnd={() => {
                  held.current = false
                  voice.current?.holdEnd() // no-op unless a hold wake was sent
                  if (pttOn.current) { pttOn.current = false; voice.current?.pttUp() }
                }}
              />
              <span className="size-14" aria-hidden />
            </div>
            <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
              <span role="status" aria-live="polite">{statusText}</span>
              {/* push-to-talk's button is hold-only, so it cannot also be the off switch; hands-free needs no extra control */}
              {on && !settings.handsFree && <button onClick={stop} className="min-h-11 rounded-full px-3 text-sm ring-1 ring-black/10">{t.micStop}</button>}
            </div>
          </div>
        </div>
      </footer>

      <CustomerSheet store={store} cid={cid} t={t} backup={backup} onClose={() => setCid(null)} onChanged={() => voice.current?.sendSnapshot()} onEntry={openEntry} />
      <EntrySheet store={store} t={t} mode={entry} onClose={closeEntry} onChanged={() => voice.current?.sendSnapshot()} onSaved={onSaved} />
      <TypeSheet open={typing} t={t} onClose={() => setTyping(false)} onSend={sendTyped} />
      <SettingsSheet store={store} open={sheet === 'settings'} t={t} onClose={() => setSheet(null)}
        onChanged={(p) => { if (p.handsFree !== undefined) voice.current?.setHandsFree(p.handsFree); if (p.fastSpeech !== undefined) voice.current?.setFastSpeech(p.fastSpeech); if (p.readBackAll !== undefined) voice.current?.setReadBackAll(p.readBackAll); if (p.lang) voice.current?.setLang(p.lang) }} />
      <PrivacySheet store={store} open={sheet === 'privacy'} t={t} backup={backup} onClose={() => setSheet(null)} onChanged={() => voice.current?.sendSnapshot()} />
      <Toaster position="top-center" />
    </div>
  )
}

const UNDO_STYLE = { minHeight: 44, minWidth: 64, fontSize: 16, fontWeight: 700 } as const

function Stat({ label, value, className, tint }: { label: string; value: string; className?: string; tint?: boolean }) {
  return (
    <div className={cn('min-w-0 rounded-2xl bg-card px-2.5 py-2 shadow-sm ring-1 ring-black/5', tint && 'bg-primary/5 ring-primary/20')}>
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
      <div className={cn('num truncate text-xl font-extrabold', className)}>{value}</div>
    </div>
  )
}

function Onboarding({ onPick }: { onPick: (l: Lang) => void }) {
  const sample = useMemo(() => ['रमेश का 340 उधार', 'ರಮೇಶ್ 340 ಸಾಲ', 'ரமேஷ் 340 கடன்', 'రమేష్ 340 అప్పు'], [])
  const [i, setI] = useState(0)
  useEffect(() => { const id = setInterval(() => setI((x) => (x + 1) % sample.length), 1800); return () => clearInterval(id) }, [sample])
  return (
    <div className="mx-auto flex h-full max-w-md flex-col px-5 pt-10 pb-6">
      <div className="grid size-14 place-items-center rounded-2xl bg-primary text-3xl font-black text-primary-foreground">₹</div>
      <h1 className="mt-4 text-3xl font-extrabold leading-tight">KhataBhai</h1>
      <div className="mt-1 h-7 overflow-hidden text-lg text-primary">
        <div key={i} className="stamp">“{sample[i]}”</div>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">Bolo, khata likh jaayega. An AI assistant · data stays on your phone.</p>
      <div className="mt-8 grid flex-1 grid-cols-2 content-start gap-2.5">
        {LANGS.map((l) => (
          <button key={l} onClick={() => onPick(l)}
            className={cn('rounded-2xl bg-card py-5 text-xl font-semibold shadow-sm ring-1 ring-black/10 active:scale-[.97]', ['hi', 'kn', 'ta', 'te'].includes(l) && 'ring-primary/40')}>
            {LANG_NAME[l]}
          </button>
        ))}
      </div>
    </div>
  )
}
