import { BellRing, Settings2, ShieldCheck } from 'lucide-react'
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
import { dayLabel, initials, rs, today } from '@/ui/format'
import { EntryRow, MicButton, PendingCard, Waterfall } from '@/ui/parts'
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
  const [level, setLevel] = useState(0)
  const [heard, setHeard] = useState('')
  const [said, setSaid] = useState('')
  const [pending, setPending] = useState<PendingView | null>(null)
  const [metrics, setMetrics] = useState<(TurnMetrics & { clientFirstAudioMs: number | null }) | null>(null)
  const [tab, setTab] = useState<'today' | 'dues'>('today')
  const [cid, setCid] = useState<string | null>(null)
  const [sheet, setSheet] = useState<'settings' | 'privacy' | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  const [on, setOn] = useState(false)
  const voice = useRef<VoiceClient | null>(null)

  const onOps = useCallback(async (ops: LedgerOp[]) => {
    await store.applyOps(ops)
    const e = ops.find((o): o is Extract<LedgerOp, { op: 'entry' }> => o.op === 'entry')
    if (e) {
      setFresh(e.eid)
      const name = store.state.customers.get(e.cid)?.name ?? ''
      toast(`${t.saved}: ${name} ${rs(e.paise)}`, {
        action: { label: t.undo, onClick: () => void store.voidEntry(e.eid, 'tap undo').then(() => voice.current?.sendSnapshot()) },
        duration: 6000,
      })
    }
  }, [store, t])

  const start = useCallback(async (lang: Lang) => {
    if (voice.current) return
    const v = createVoiceClient(VOICE_URL, {
      status: setStatus,
      level: setLevel,
      partial: (x) => setHeard(x),
      final: (x) => setHeard(x),
      say: (x) => setSaid(x),
      ops: (ops) => void onOps(ops),
      pending: (p) => {
        setPending(p)
        if (p) { setCid(null); setSheet(null) } // the question card must be visible
      },
      show: (s) => {
        if (s.view === 'customer') setCid(s.cid)
        else if (s.view === 'dues') setTab('dues')
        else if (s.view === 'summary') setTab('today')
        else if (s.view === 'privacy') setSheet('privacy')
      },
      remind: (c, text) => remindLink(store, c, text),
      metrics: setMetrics,
      error: (msg) => console.warn('[voice]', msg),
    })
    voice.current = v
    setOn(true)
    try {
      await v.start({ lang, snapshot: () => store.snapshot(), firstRun: !store.settings.firstRunDone, handsFree: store.settings.handsFree })
      if (!store.settings.firstRunDone) void store.updateSettings({ firstRunDone: true })
    } catch {
      voice.current = null
      setOn(false)
      toast.error('Microphone / network')
    }
  }, [onOps, store])

  const stop = () => { voice.current?.stop(); voice.current = null; setOn(false); setStatus('idle'); setPending(null) }

  // keep the screen awake while the khata is listening
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    void navigator.wakeLock.request('screen').then((l) => (lock = l)).catch(() => {})
    return () => void lock?.release()
  }, [on])

  if (!settings.lang) return <Onboarding onPick={(l) => void store.updateSettings({ lang: l }).then(() => start(l))} />

  const day = daySummary(state, today())
  const todays = state.order.map((id) => state.entries.get(id)!).filter((e) => e.day === today() || new Date(e.ts).toDateString() === new Date().toDateString()).reverse()
  const due = dues(state)
  const proms = promises(state)
  const name = (c: string) => state.customers.get(c)?.name ?? '—'
  const statusText = !on ? (settings.handsFree ? t.tapToTalk : t.hold) : status === 'offline' ? t.offline : status === 'thinking' ? t.thinking : status === 'speaking' ? t.speaking : status === 'connecting' ? '…' : settings.handsFree ? t.listening : t.hold

  return (
    <div className="mx-auto flex h-full max-w-md flex-col">
      <header className="flex items-center gap-2 px-4 pt-4">
        <div className="grid size-9 place-items-center rounded-xl bg-primary text-lg font-black text-primary-foreground">₹</div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-bold leading-tight">{settings.shopName}</div>
          <div className="text-xs text-muted-foreground">Voice Khata · AI</div>
        </div>
        <button aria-label="my data" onClick={() => setSheet('privacy')} className="grid size-10 place-items-center rounded-full hover:bg-muted"><ShieldCheck className="size-5" /></button>
        <button aria-label="settings" onClick={() => setSheet('settings')} className="grid size-10 place-items-center rounded-full hover:bg-muted"><Settings2 className="size-5" /></button>
      </header>

      <section className="mx-4 mt-3 grid grid-cols-2 gap-2">
        <Stat label={`${t.today} · ${t.credit}`} value={rs(day.creditPaise)} className="text-credit" />
        <Stat label={`${t.today} · ${t.payment}`} value={rs(day.paymentPaise)} className="text-payment" />
      </section>

      <nav className="mx-4 mt-3 grid grid-cols-2 rounded-2xl bg-muted p-1 text-sm font-semibold">
        {(['today', 'dues'] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)} className={cn('rounded-xl py-2', tab === k && 'bg-card shadow-sm')}>
            {k === 'today' ? t.today : `${t.dues} · ${due.length}`}
          </button>
        ))}
      </nav>

      <main className="flex-1 space-y-2 overflow-y-auto px-4 pt-3 pb-64">
        {settings.showLatency && metrics && <Waterfall m={metrics} />}
        {tab === 'today' ? (
          todays.length ? todays.map((e) => <EntryRow key={e.eid} e={e} name={name(e.cid)} t={t} fresh={e.eid === fresh} onClick={() => setCid(e.cid)} />)
            : <div className="rounded-2xl border-2 border-dashed p-6 text-center text-muted-foreground">{t.noEntries}</div>
        ) : (
          <>
            {due.map((d) => (
              <button key={d.cid} onClick={() => setCid(d.cid)} className="flex w-full items-center gap-3 rounded-2xl bg-card px-4 py-3 text-left shadow-sm ring-1 ring-black/5">
                <span className="grid size-10 place-items-center rounded-full bg-primary/10 font-bold text-primary">{initials(name(d.cid))}</span>
                <span className="min-w-0 flex-1 truncate font-semibold">{name(d.cid)}</span>
                {state.customers.get(d.cid)?.remindersOptIn && <BellRing className="size-4 text-muted-foreground" />}
                <span className="num text-2xl font-bold text-credit">{rs(d.paise)}</span>
              </button>
            ))}
            {proms.length > 0 && <div className="pt-3 text-sm font-semibold text-muted-foreground">{t.promise}</div>}
            {proms.map((p) => (
              <button key={p.eid} onClick={() => setCid(p.cid)} className="flex w-full items-center gap-3 rounded-2xl bg-amber-50 px-4 py-3 text-left ring-1 ring-amber-200">
                <span className="min-w-0 flex-1 truncate font-semibold">{name(p.cid)}</span>
                <span className="text-sm text-amber-800">{dayLabel(p.day)}</span>
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
          {(heard || said) && on && (
            <div className="space-y-1 text-center">
              {heard && <div className="truncate text-sm text-muted-foreground">“{heard}”</div>}
              {said && <div className="text-base font-medium">{said}</div>}
            </div>
          )}
          <div className="flex flex-col items-center">
            <MicButton
              status={status} level={level} on={on}
              onPress={() => {
                if (!on) void start(settings.lang!)
                else if (!settings.handsFree) voice.current?.pttDown()
                else if (status === 'speaking') voice.current?.pttDown() // tap to cut the reply short
              }}
              onRelease={() => { if (on && !settings.handsFree) voice.current?.pttUp() }}
            />
            <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
              <span>{statusText}</span>
              {on && <button onClick={stop} className="rounded-full px-2 py-0.5 text-xs ring-1 ring-black/10">{t.stop}</button>}
            </div>
          </div>
        </div>
      </footer>

      <CustomerSheet store={store} cid={cid} t={t} backup={backup} onClose={() => setCid(null)} onChanged={() => voice.current?.sendSnapshot()} />
      <SettingsSheet store={store} open={sheet === 'settings'} t={t} onClose={() => setSheet(null)}
        onChanged={(p) => { if (p.handsFree !== undefined) voice.current?.setHandsFree(p.handsFree); if (p.lang) { stop() } }} />
      <PrivacySheet store={store} open={sheet === 'privacy'} t={t} backup={backup} onClose={() => setSheet(null)} onChanged={() => voice.current?.sendSnapshot()} />
      <Toaster position="top-center" />
    </div>
  )
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-2xl bg-card px-3 py-2.5 shadow-sm ring-1 ring-black/5">
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div className={cn('num text-2xl font-extrabold', className)}>{value}</div>
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
      <h1 className="mt-4 text-3xl font-extrabold leading-tight">Voice Khata</h1>
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
