import { BellRing, BookOpen, ChevronRight, Globe, Keyboard, Menu as MenuIcon, MessageCircle, Mic, Plus, Search, ShieldCheck, WifiOff } from 'lucide-react'
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { balance, daySummary, displayName, dues, promises } from '../shared/ledger.js'
import type { LedgerOp, PendingView, TurnMetrics } from '../shared/protocol.js'
import { LANG_NAME, LANGS, type Lang } from '../shared/replies.js'
import { Toaster } from '@/components/ui/sonner'
import { createBackupClient } from '@/lib/backup'
import type { KhataStore, VoiceClient, VoiceStatus } from '@/lib/contracts'
import { createStore, idbPersistence } from '@/lib/store'
import { cn } from '@/lib/utils'
import { createVoiceClient } from '@/lib/voice'
import { API_BASE, voiceUrl } from '@/lib/api'
import { ago, dayOfTs, initials, relDay, rs, rsShort, today } from '@/ui/format'
import { EntrySheet, TypeSheet, type EntryMode } from '@/ui/EntrySheet'
import { heardFeedback, primeFeedback, savedFeedback, sleepChime, wakeChime } from '@/ui/feedback'
import { isNative, keepAwake, onBackButton, openAppSettings } from '@/lib/native'
import { useOnline } from '@/lib/online'
import { clientLog } from '@/lib/log'
import { DayFeed } from '@/ui/Ledger'
import { MicButton, PendingCard, ReadyCard, Waterfall } from '@/ui/parts'
import { CustomerSheet, ListSheet, type ListView, PrivacySheet, SettingsSheet, shareWhatsApp, toastRemind } from '@/ui/Sheets'
import { ui } from '@/ui/strings'
import { Dropdown } from '@/ui/Dropdown'
import { MenuSheet } from '@/ui/Menu'
import { ImportSheet, type ImportSink } from '@/ui/ImportSheet'
import { RemindSheet } from '@/ui/RemindSheet'
import { ProfileForm } from '@/ui/Profile'
import { applyTheme } from '@/ui/theme'
import { Logo, Wordmark } from '@/ui/Logo'
import { dueForReminder, runAutoReminders, sendReminder } from '@/lib/remind'
import { startSync } from '@/lib/sync'

const ConfirmPage = lazy(() => import('@/pages/ConfirmPage'))
const PayPage = lazy(() => import('@/pages/PayPage'))
const backup = createBackupClient(API_BASE)

export default function App() {
  const m = location.pathname.match(/^\/c\/([A-Za-z0-9_-]+)/)
  if (m) return <Suspense fallback={null}><ConfirmPage token={m[1]} /></Suspense>
  // a customer paying from a WhatsApp reminder: no ledger on this page
  if (location.pathname === '/pay') return <Suspense fallback={null}><PayPage /></Suspense>
  return <ShopApp />
}

function ShopApp() {
  const [store, setStore] = useState<KhataStore | null>(null)
  useEffect(() => { void createStore(idbPersistence()).then(setStore) }, [])
  if (!store) return <div className="grid h-full place-items-center text-muted-foreground">…</div>
  return <Home store={store} />
}

const VOICE_URL = voiceUrl()

function Home({ store }: { store: KhataStore }) {
  const state = useSyncExternalStore(store.subscribe, () => store.state)
  const settings = store.settings
  const t = ui(settings.lang)
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const levelSource = useRef(new Set<(v: number) => void>()).current
  /** ledger writes in order; feedback no longer waits for them */
  const writes = useRef<Promise<unknown>>(Promise.resolve())
  const [heard, setHeard] = useState('')
  /** a tap that cut a reply short: a second tap right after it must not also mute */
  const lastBargeAt = useRef(0)
  /** the heard line was taken as talk to someone else (shown dimmed, marked "not an entry") */
  const [heardIgnored, setHeardIgnored] = useState(false)
  const [said, setSaid] = useState('')
  const [pending, setPending] = useState<PendingView | null>(null)
  const [metrics, setMetrics] = useState<(TurnMetrics & { clientFirstAudioMs: number | null }) | null>(null)
  const [tab, setTab] = useState<'today' | 'dues'>('today')
  const [cid, setCid] = useState<string | null>(null)
  const [sheet, setSheet] = useState<'menu' | 'privacy' | 'import' | 'remind' | 'settings' | null>(null)
  // rows read aloud from an old paper khata go straight to the open import sheet
  const importSink = useRef<ImportSink['current']>(null)
  // the bottom panel (question card, mic) floats over the list: the list is padded by its real height
  const footer = useRef<HTMLElement>(null)
  const [footerH, setFooterH] = useState(260)
  /** a spoken "show ..." list: a day's entries, a search, the biggest dues */
  const [listView, setListView] = useState<ListView | null>(null)
  /** a tool's one-tap card: send this on WhatsApp, or open the backup */
  const [ready, setReady] = useState<{ kind: 'whatsapp' | 'backup'; cid?: string; text?: string } | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  const [on, setOn] = useState(false)
  const online = useOnline()
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
        if (ignoredRef.current) ignoredTimer.current = setTimeout(() => { setHeard(''); markIgnored(false) }, 6000)
        else setHeard('')
      },
      micError: () => { setMicReady(false); toast.error(t.micError) },
      partial: (x) => { newTurn(); setHeard(x); markIgnored(false) },
      final: (x) => { setReady(null); newTurn(); setHeard(x); markIgnored(false) },
      notEntry: () => markIgnored(true),
      say: (x) => setSaid(x),
      ops: (ops) => onOps(ops),
      network: (s) => setNet(s),
      resent: (text) => toast(`${t.resent}: “${text.length > 60 ? `${text.slice(0, 60)}…` : text}”`, { duration: 6000 }),
      pending: (p) => {
        setPending(p)
        if (p) { setCid(null); setSheet(null); setEntry(null); setTyping(false); setListView(null); setReady(null) } // the question card must be visible
      },
      show: (s) => {
        // one view at a time: the new one replaces whatever was open
        setReady(null) // a card from an earlier turn must not stay tappable
        if (s.view !== 'customer') setCid(null)
        if (s.view !== 'history' && s.view !== 'search' && s.view !== 'top_debtors') setListView(null)
        if (s.view === 'customer') { setListView(null); setSheet(null); setCid(s.cid) }
        else if (s.view === 'dues') { setSheet(null); setTab('dues') }
        else if (s.view === 'summary' || s.view === 'today') { setSheet(null); setTab('today') }
        else if (s.view === 'privacy') setSheet('privacy')
        else if (s.view === 'settings') setSheet('settings')
        else if (s.view === 'history') { setSheet(null); setListView({ k: 'history', from: s.from, to: s.to, cid: s.cid }) }
        else if (s.view === 'search') { setSheet(null); setListView({ k: 'search', text: s.text, cids: s.cids, eids: s.eids }) }
        else if (s.view === 'top_debtors') { setSheet(null); setListView({ k: 'top', count: s.count }) }
        else if (s.view === 'close') { setSheet(null); setListView(null); setEntry(null); setTyping(false); setReady(null) }
      },
      // settings changed by voice: stored here, and the voice client told (the language is applied by `lang`, the mic stays on)
      setting: (m) => {
        if (m.key === 'speed' && (m.value === 0.8 || m.value === 1 || m.value === 1.2)) { const speed = m.value; void store.updateSettings({ speed }); voice.current?.setSpeed(speed) }
        else if (m.key === 'shopName' && typeof m.value === 'string') void store.updateSettings({ shopName: m.value })
      },
      ready: (m) => setReady({ kind: m.kind, cid: m.cid, text: m.text }),
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
  }, [onOps, store, t])

  /** who a WhatsApp card goes to: the customer's name and number, or a note that WhatsApp will ask */
  const recipient = (c?: string) => {
    const cu = c ? store.state.customers.get(c) : undefined
    if (!cu) return t.noNumber
    return cu.phone ? `${cu.name} · ${cu.phone}` : `${cu.name} · ${t.noNumber}`
  }
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
    else if (status === 'speaking' || status === 'thinking') { lastBargeAt.current = Date.now(); v.bargeIn() } // cut the reply short, stay awake
    else if (status === 'asleep') { setMicReady(true); v.wake('tap') }
    else if (status === 'listening') { if (Date.now() - lastBargeAt.current > 1500) v.sleep() } // a quick second tap is part of the interrupt
  }
  const stop = () => { voice.current?.stop(); voice.current = null; setOn(false); setStatus('idle'); setPending(null); setMicReady(false) }

  // the saved scheme wins over the quick local copy used for the first paint
  useEffect(() => { applyTheme(store.settings.theme) }, [store])

  // Razorpay payments and customer replies come back into the khata; opted-in customers go up for reminders
  useEffect(() => startSync(store, (n) => {
    const name = store.state.customers.get(n.cid)?.name ?? ''
    if (n.kind === 'payment') toast.success(`${name}: ₹${((n.paise ?? 0) / 100).toLocaleString('en-IN')} paid online (Razorpay)`)
    else if (n.kind === 'dispute') toast.warning(`${name} says an amount is wrong${n.text ? `: "${n.text}"` : ''}`)
    else toast(`${name} stopped WhatsApp reminders`)
  }), [store])

  // automatic WhatsApp reminders: on open and every 6 h while the app stays open
  useEffect(() => {
    const run = () => void runAutoReminders(store).then(({ sent }) => { if (sent) toast.success(`${ui(store.settings.lang).remindSent} × ${sent}`) })
    run()
    const id = setInterval(run, 6 * 3600_000)
    return () => clearInterval(id)
  }, [store])

  useEffect(() => {
    const el = footer.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setFooterH(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  })

  const remindAll = async () => {
    setSheet(null)
    let sent = 0
    let failed = 0
    for (const c of dueForReminder(store.state, store.settings)) {
      const r = await sendReminder(store, c)
      if (r.ok) sent++
      else failed++
    }
    if (sent) toast.success(`${t.remindSent} × ${sent}`)
    if (failed) toast.error(`${t.remindFailed} × ${failed}`)
  }

  /** WhatsApp button on a dues row: send now, or open the customer to add the number / consent. */
  const quickRemind = (cid: string) => {
    const c = store.state.customers.get(cid)
    if (!c?.phone || !c.adult || !c.remindersOptIn) {
      setCid(cid)
      toast(!c?.phone ? t.noPhone : t.notAllowed)
      return
    }
    void sendReminder(store, cid, { interactive: true }).then((r) => toastRemind(t, r))
  }

  /** Import "read aloud": the mic must be on and open (hands-free) while the book is read. */
  // reading an old khata aloud needed the old voice session's import mode (the agent has none): typed and photo import remain
  const importReading = async (_on: boolean): Promise<boolean> => false


  const setLanguage = (v: string) => {
    const auto = v === 'auto'
    void store.updateSettings(auto ? { autoLang: true } : { lang: v as Lang, autoLang: false }).then(() => { if (voice.current) stop() })
  }

  // keep the screen awake while the khata is listening
  useEffect(() => {
    if (isNative) { keepAwake(on); return () => keepAwake(false) }
    if (!on || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    void navigator.wakeLock.request('screen').then((l) => (lock = l)).catch(() => {})
    return () => void lock?.release()
  }, [on])

  // Android back button: close the topmost layer, else minimise (onboarding/profile fall through to minimise)
  const back = useRef<() => boolean>(() => false)
  useEffect(() => {
    back.current = () => {
      if (entry) closeEntry()
      else if (typing) setTyping(false)
      else if (sheet) setSheet(null)
      else if (cid) setCid(null)
      else return false
      return true
    }
  })
  useEffect(() => onBackButton(() => back.current()), [])

  if (!settings.lang) return <Onboarding onPick={(l, auto) => void store.updateSettings({ lang: l, autoLang: auto })} />
  if (!settings.profileDone) {
    return (
      <div className="mx-auto h-full max-w-md overflow-y-auto px-5 pb-8" style={{ paddingTop: SAFE_TOP }}>
        <Brand />
        <h1 className="mt-6 font-display text-3xl font-semibold">{t.signupTitle}</h1>
        <div className="gold-rule mt-3 mb-5" />
        <ProfileForm t={t} initial={settings} submit={t.continueBtn} onSave={(p) => void store.updateSettings({ ...p, profileDone: true })} />
      </div>
    )
  }

  if (isNative && !settings.micAsked) return <MicStep t={t} onDone={() => void store.updateSettings({ micAsked: true })} />

  const day = daySummary(state, today())
  const all = state.order.map((id) => state.entries.get(id)!)
  const due = dues(state)
  const totalDue = due.reduce((n, d) => n + d.paise, 0)
  const proms = promises(state)
  const name = (c: string) => displayName(state, c)
  const lastDay = new Map<string, string>()
  for (const e of all) if (!e.voided) { const d = e.promise ? dayOfTs(e.ts) : e.day; if (d > (lastDay.get(e.cid) ?? '')) lastDay.set(e.cid, d) }
  const needle = q.trim().toLowerCase()
  const shownDues = due
    .filter((d) => { const c = state.customers.get(d.cid); return !needle || !!c && (c.name.toLowerCase().includes(needle) || c.aliases.some((a) => a.toLowerCase().includes(needle))) })
    .sort((a, b) => (sort === 'name' ? name(a.cid).localeCompare(name(b.cid), t.loc) : b.paise - a.paise))
  const statusText = !on || (!micReady && status === 'asleep') ? (settings.handsFree ? t.tapToTalk : t.hold) : status === 'offline' ? t.offline : status === 'thinking' ? t.thinking : status === 'speaking' ? t.speaking : status === 'connecting' ? '…' : status === 'asleep' ? t.sayKhataBhai : settings.handsFree ? t.awake : t.hold

  return (
    <div className="mx-auto flex h-full max-w-md flex-col">
      {/* top bar: menu | shop name (centred on the bar) | reminders bell + language; clears the phone's status bar in the app */}
      <header className="relative shrink-0 border-b border-border" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="relative flex h-16 items-center justify-between gap-2 px-3">
          <button aria-label={t.menu} onClick={() => setSheet('menu')} className="grid size-11 shrink-0 place-items-center rounded-lg hover:bg-muted active:scale-95">
            <MenuIcon className="size-6" />
          </button>
          <div className="pointer-events-none absolute inset-x-[7.75rem] text-center">
            <div className="truncate text-base leading-tight font-semibold tracking-tight sm:text-lg">{settings.shopName}</div>
            <div className="mt-0.5 text-[10px] font-semibold tracking-[0.24em] text-gold uppercase">KhataBhai</div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button aria-label={t.remindersNav} onClick={() => setSheet('remind')} className="relative grid size-11 place-items-center rounded-lg hover:bg-muted active:scale-95">
              <BellRing className="size-5" />
              {due.length > 0 && <span className="num absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-credit px-1 text-[10px] leading-4 font-semibold text-white">{due.length > 99 ? '99+' : due.length}</span>}
            </button>
            <Dropdown
              compact label={t.language} align="right" panelClassName="w-60"
              value={settings.autoLang !== false ? 'auto' : settings.lang}
              options={[{ value: 'auto', label: 'Auto', hint: t.autoAny }, ...LANGS.map((l) => ({ value: l as string, label: LANG_NAME[l], hint: l.toUpperCase() }))]}
              onChange={setLanguage}
              button={<span className="flex items-center gap-1"><Globe className="size-4 shrink-0 text-muted-foreground" /><span>{settings.autoLang !== false ? 'Auto' : settings.lang.toUpperCase()}</span></span>}
            />
          </div>
        </div>
      </header>

      {!online && (
        <div role="status" className="mx-4 mt-2 flex items-center gap-2 rounded-xl bg-amber-500/15 px-3 py-1.5 text-sm text-amber-700 dark:text-amber-300">
          <WifiOff className="size-4 shrink-0" /><span>{t.offlineStrip}</span>
        </div>
      )}


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

      <main className="flex-1 space-y-2 overflow-y-auto px-4 pt-2" style={{ paddingBottom: footerH + 16 }}>
        {settings.showLatency && metrics && <Waterfall m={metrics} />}
        {tab === 'today' ? (
          all.length ? <DayFeed entries={all} t={t} name={name} fresh={fresh} onEntry={(eid) => setEntry({ kind: 'edit', eid })} />
            : (
              <div className="rounded-2xl border-2 border-dashed p-5 text-center">
                <div className="text-base text-muted-foreground">{t.noEntries}</div>
                <div className="mt-4 mb-2 text-sm font-semibold">{t.tryThese}</div>
                <button onClick={() => setSheet('import')} className="mb-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 font-semibold text-primary-foreground shadow-md active:scale-[.98]">
                  <BookOpen className="size-5" />{t.importCta}
                </button>
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
              <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl bg-card px-3 ring-1 ring-foreground/10">
                <Search className="size-4 shrink-0 text-muted-foreground" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.search} aria-label={t.search} className="min-w-0 flex-1 bg-transparent text-base outline-none" />
              </label>
              <div className="grid grid-cols-2 rounded-xl bg-muted p-0.5 text-sm font-semibold">
                <button onClick={() => setSort('amount')} className={cn('min-h-11 rounded-lg px-2.5', sort === 'amount' && 'bg-card shadow-sm')}>₹ {t.sortBig}</button>
                <button onClick={() => setSort('name')} className={cn('min-h-11 rounded-lg px-2.5', sort === 'name' && 'bg-card shadow-sm')}>A–Z</button>
              </div>
            </div>
            {shownDues.map((d) => (
              <div key={d.cid} className="flex min-h-16 w-full items-center gap-1 rounded-lg bg-card pr-1.5 shadow-sm ring-1 ring-foreground/5">
                <button onClick={() => setCid(d.cid)} className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 text-left active:opacity-70">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 font-semibold text-primary">{initials(name(d.cid))}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-lg font-semibold leading-snug">{name(d.cid)}</span>
                    {lastDay.get(d.cid) && <span className="block text-sm text-muted-foreground">{ago(lastDay.get(d.cid)!, t)}</span>}
                  </span>
                  {state.customers.get(d.cid)?.remindersOptIn && <BellRing className="size-4 shrink-0 text-muted-foreground" aria-label={t.reminders} />}
                  <span className="num text-xl font-semibold text-credit">{rs(d.paise)}</span>
                </button>
                <button aria-label={`${t.remindNow}: ${name(d.cid)}`} onClick={() => quickRemind(d.cid)}
                  className="grid size-11 shrink-0 place-items-center rounded-lg text-payment hover:bg-payment/10 active:scale-95">
                  <MessageCircle className="size-5" />
                </button>
              </div>
            ))}
            {q && shownDues.length === 0 && <div className="py-6 text-center text-muted-foreground">{t.noMatch}</div>}
            {proms.length > 0 && <div className="pt-3 text-sm font-semibold text-muted-foreground">{t.promise}</div>}
            {proms.map((p) => (
              <button key={p.eid} onClick={() => setCid(p.cid)} className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-amber-500/10 px-4 py-3 text-left ring-1 ring-amber-500/30">
                <span className="min-w-0 flex-1 truncate text-lg font-semibold">{name(p.cid)}</span>
                <span className={cn('text-sm', p.day < today() ? 'font-semibold text-destructive' : 'text-amber-700 dark:text-amber-300')}>{t.due} {relDay(p.day, t)}</span>
                <span className="num text-xl font-bold text-amber-700 dark:text-amber-300">{rs(p.paise)}</span>
                <span className="num text-xs text-muted-foreground">/ {rs(balance(state, p.cid))}</span>
              </button>
            ))}
          </>
        )}
      </main>

      {/* solid behind captions/mic (on a short phone the list reaches under them); only a thin fade above */}
      <footer ref={footer} className="pointer-events-none fixed inset-x-0 bottom-0 z-10 mx-auto max-w-md bg-background px-4 pt-3 pb-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.75rem))]">
        <div aria-hidden className="absolute inset-x-0 -top-6 h-6 bg-gradient-to-t from-background to-transparent" />
        <div className="pointer-events-auto space-y-3">
          {ready && !pending && (
            <ReadyCard
              t={t} text={ready.kind === 'whatsapp' ? ready.text : undefined}
              to={ready.kind === 'whatsapp' ? recipient(ready.cid) : undefined}
              label={ready.kind === 'whatsapp' ? t.sendWhatsApp : t.openBackup}
              onDismiss={() => setReady(null)}
              onGo={() => {
                try {
                  if (ready.kind === 'backup') setSheet('privacy')
                  else if (ready.cid) void sendReminder(store, ready.cid, { interactive: true }).then((r) => toastRemind(t, r)).catch((e) => clientLog.warn('remind_failed', { error: String(e) }))
                  else if (ready.text) shareWhatsApp(ready.text)
                } catch (e) { clientLog.warn('ready_failed', { error: String(e) }) }
                setReady(null)
              }}
            />
          )}
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
                <div className={cn('flex items-center justify-center gap-1.5 text-sm text-muted-foreground', heardIgnored && 'opacity-60')}>
                  <span className="min-w-0 truncate">“{heard}”</span>{heardIgnored && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs">{t.notEntry}</span>}
                  {heardIgnored && <button onClick={() => { const x = heard; markIgnored(false); setHeard(''); voice.current?.force(x) }} className="min-h-11 shrink-0 rounded-full px-3 text-xs font-semibold text-primary ring-1 ring-primary/30">{t.saveAnyway}</button>}
                </div>
              )}
              {said && <div className="text-base font-medium">{said}</div>}
            </div>
          )}
          <div className="flex flex-col items-center">
            <div className="flex items-center justify-center gap-5">
              <span className="size-14" aria-hidden />
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
              <button aria-label={t.typeInstead} onClick={() => setTyping(true)} className="grid size-14 place-items-center rounded-full bg-card shadow-md ring-1 ring-foreground/10 active:scale-95"><Keyboard className="size-6" /></button>
            </div>
            <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
              <span role="status" aria-live="polite">{statusText}</span>
              {/* push-to-talk's button is hold-only, so it cannot also be the off switch; hands-free needs no extra control */}
              {on && !settings.handsFree && <button onClick={stop} className="min-h-11 rounded-full px-3 text-sm ring-1 ring-foreground/10">{t.micStop}</button>}
            </div>
          </div>
        </div>
      </footer>

      <CustomerSheet store={store} cid={cid} t={t} backup={backup} onClose={() => setCid(null)} onChanged={() => voice.current?.sendSnapshot()} onEntry={openEntry} />
      <EntrySheet store={store} t={t} mode={entry} onClose={closeEntry} onChanged={() => voice.current?.sendSnapshot()} onSaved={onSaved}
        onCustomer={(c) => { setEntry(null); setEntryFrom(null); setCid(c) }} />
      <TypeSheet open={typing} t={t} onClose={() => setTyping(false)} onSend={sendTyped} />
      <RemindSheet store={store} open={sheet === 'remind'} t={t} onClose={() => setSheet(null)} onChanged={() => voice.current?.sendSnapshot()} />
      <ImportSheet store={store} open={sheet === 'import'} t={t} sink={importSink} onReading={importReading} onClose={() => setSheet(null)} onChanged={() => voice.current?.sendSnapshot()} />
      <MenuSheet store={store} open={sheet === 'menu'} t={t} onClose={() => setSheet(null)} onPrivacy={() => setSheet('privacy')} onImport={() => setSheet('import')} onRemindAll={() => void remindAll()}
        onChanged={(p) => { if (p.handsFree !== undefined) voice.current?.setHandsFree(p.handsFree); if (p.fastSpeech !== undefined) { const speed = p.fastSpeech ? 1.2 : 1; void store.updateSettings({ speed }); voice.current?.setSpeed(speed) } }} />
      <ListSheet store={store} view={listView} t={t} onClose={() => setListView(null)}
        onCustomer={(c) => { setListView(null); setCid(c) }} onEntry={(eid) => { setListView(null); setEntry({ kind: 'edit', eid }) }} />
      <SettingsSheet store={store} open={sheet === 'settings'} t={t} onClose={() => setSheet(null)}
        onChanged={(p) => { if (p.handsFree !== undefined) voice.current?.setHandsFree(p.handsFree); if (p.speed !== undefined) voice.current?.setSpeed(p.speed); if (p.lang) voice.current?.setLang(p.lang) }} />
      <PrivacySheet store={store} open={sheet === 'privacy'} t={t} backup={backup} onClose={() => setSheet(null)} onChanged={() => voice.current?.sendSnapshot()} />
      <Toaster position="top-center" offset={{ top: 'calc(env(safe-area-inset-top) + 16px)' }} />
    </div>
  )
}

/** Page top padding that clears the status bar when the app draws edge-to-edge (Android 15+). */
const SAFE_TOP = 'max(2rem, calc(env(safe-area-inset-top) + 1rem))'
const SAFE_TOP_LG = 'max(3.5rem, calc(env(safe-area-inset-top) + 1.5rem))'

const UNDO_STYLE = { minHeight: 44, minWidth: 64, fontSize: 16, fontWeight: 700 } as const

function Stat({ label, value, className, tint }: { label: string; value: string; className?: string; tint?: boolean }) {
  return (
    <div className={cn('min-w-0 rounded-lg bg-card px-2.5 py-2 shadow-sm ring-1 ring-foreground/10', tint && 'bg-primary/5 ring-gold/50')}>
      <div className="truncate text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className={cn('num truncate text-2xl font-bold', className)}>{value}</div>
    </div>
  )
}

/** Starting language for auto mode: the phone's own language when we speak it, else Hindi. */
function phoneLang(): Lang {
  try {
    const l = (navigator.languages ?? [navigator.language]).map((x) => x.slice(0, 2)).find((x) => (LANGS as readonly string[]).includes(x) && x !== 'en')
    return (l as Lang | undefined) ?? 'hi'
  } catch {
    return 'hi'
  }
}

function Brand() {
  return <Wordmark size={48} />
}

/** One-time "allow microphone" step; skipped silently when already granted (or the WebView can't tell). */
function MicStep({ t, onDone }: { t: ReturnType<typeof ui>; onDone: () => void }) {
  const [denied, setDenied] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let dead = false
    void (async () => {
      try {
        const p = await navigator.permissions?.query({ name: 'microphone' as PermissionName })
        if (!dead && p?.state === 'granted') onDone()
      } catch { /* not supported: show the step */ }
    })()
    return () => { dead = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const allow = async () => {
    setBusy(true)
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      s.getTracks().forEach((x) => x.stop())
      onDone()
    } catch { setDenied(true); setBusy(false) }
  }
  return (
    <div className="mx-auto flex h-full max-w-md flex-col overflow-y-auto px-6 pb-8" style={{ paddingTop: SAFE_TOP }}>
      <Brand />
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <span className="grid size-20 place-items-center rounded-full bg-primary/10 text-primary"><Mic className="size-10" /></span>
        <h1 className="mt-6 font-display text-3xl font-semibold">{t.micTitle}</h1>
        <div className="gold-rule mt-3 mb-4" />
        <p className="text-lg text-muted-foreground">{t.micBody}</p>
        {denied && <p role="alert" className="mt-5 rounded-xl bg-amber-500/15 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">{t.micDenied}</p>}
      </div>
      {denied ? (<>
        {isNative && <button onClick={openAppSettings} className="mt-8 flex h-14 w-full items-center justify-center rounded-lg border border-primary text-lg font-semibold text-primary active:scale-[.98]">{t.micSettings}</button>}
        <button onClick={onDone} className="mt-8 flex h-14 w-full items-center justify-center rounded-lg bg-primary text-lg font-semibold text-primary-foreground shadow-md active:scale-[.98]">{t.micAnyway}</button>
      </>) : (
        <>
          <button disabled={busy} onClick={() => void allow()} className="mt-8 flex h-14 w-full items-center justify-center gap-2 rounded-lg bg-primary text-lg font-semibold text-primary-foreground shadow-md active:scale-[.98] disabled:opacity-60"><Mic className="size-5" />{t.micAllow}</button>
          <button onClick={onDone} className="mt-3 min-h-11 text-sm text-muted-foreground underline">{t.micSkip}</button>
        </>
      )}
    </div>
  )
}

function Onboarding({ onPick }: { onPick: (l: Lang, auto: boolean) => void }) {
  const [step, setStep] = useState<'welcome' | 'lang'>('welcome')
  const sample = useMemo(() => ['रमेश का 340 उधार', 'ರಮೇಶ್ 340 ಸಾಲ', 'ரமேஷ் 340 கடன்', 'రమేష్ 340 అప్పు', 'Ramesh 340 credit'], [])
  const [i, setI] = useState(0)
  useEffect(() => { const id = setInterval(() => setI((x) => (x + 1) % sample.length), 1800); return () => clearInterval(id) }, [sample])

  if (step === 'welcome') {
    return (
      <div className="mx-auto flex h-full max-w-md flex-col overflow-y-auto px-6 pb-8" style={{ paddingTop: SAFE_TOP_LG }}>
        <div className="flex flex-1 flex-col items-center text-center">
          <Logo size={96} className="drop-shadow-md" />
          <div className="mt-6 text-sm font-medium tracking-[0.2em] text-gold uppercase">Welcome to · स्वागत है</div>
          <h1 className="mt-1 text-4xl font-semibold tracking-tight">KhataBhai</h1>
          <p className="mt-3 text-lg text-muted-foreground">Your voice khata. Speak, it writes.<br />बोलो, खाता लिख जाएगा।</p>
          <div className="mt-5 h-8 overflow-hidden text-xl text-primary">
            <div key={i} className="stamp">“{sample[i]}”</div>
          </div>
          <ul className="mt-8 w-full space-y-3 text-left">
            {([
              [Mic, 'Speak in any Indian language', 'हिंदी, ಕನ್ನಡ, தமிழ், తెలుగు, English…'],
              [ShieldCheck, 'Your khata stays on your phone', 'Encrypted · कोई और नहीं पढ़ सकता'],
              [MessageCircle, 'WhatsApp reminders with a UPI pay link', 'Customers pay you directly'],
            ] as const).map(([Icon, title, sub]) => (
              <li key={title} className="flex items-start gap-3 rounded-lg bg-card p-3 ring-1 ring-foreground/10">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><Icon className="size-5" /></span>
                <span>
                  <span className="block font-semibold">{title}</span>
                  <span className="block text-sm text-muted-foreground">{sub}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <button onClick={() => setStep('lang')} className="mt-8 flex h-14 w-full items-center justify-center gap-2 rounded-lg bg-primary text-lg font-semibold text-primary-foreground shadow-md active:scale-[.98]">
          Get started · शुरू करें<ChevronRight className="size-5" />
        </button>
        <p className="mt-3 text-center text-xs text-muted-foreground">An AI assistant · आपकी आवाज़ AI समझता है</p>
      </div>
    )
  }

  return (
    <div className="mx-auto flex h-full max-w-md flex-col overflow-y-auto px-5 pt-8 pb-6">
      <Brand />
      <h1 className="mt-8 text-2xl font-semibold tracking-tight">Choose language · भाषा चुनें</h1>
      <div className="gold-rule mt-4" />
      <button onClick={() => onPick(phoneLang(), true)}
        className="mt-5 flex items-center gap-3 rounded-lg bg-primary px-4 py-4 text-left text-primary-foreground shadow-md active:scale-[.98]">
        <Globe className="size-7 shrink-0" />
        <span>
          <span className="block text-xl font-bold">Auto · कोई भी भाषा</span>
          <span className="block text-sm opacity-90">Speak any language — replies in the same one</span>
        </span>
      </button>
      <div className="mt-3 grid grid-cols-2 content-start gap-2">
        {LANGS.map((l) => (
          <button key={l} onClick={() => onPick(l, false)}
            className="min-h-14 rounded-lg bg-card py-3 text-lg font-semibold shadow-sm ring-1 ring-foreground/10 active:scale-[.97]">
            {LANG_NAME[l]}
          </button>
        ))}
      </div>
    </div>
  )
}
