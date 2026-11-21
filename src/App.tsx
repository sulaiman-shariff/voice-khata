import { isNative, onBackButton } from '@/lib/native'
import { useOnline } from '@/lib/online'
import { MicStep } from '@/ui/home/MicStep'
import { Plus, WifiOff } from 'lucide-react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { balance, daysBetween, displayName, dues, lenaDena, supplierDues } from '../shared/ledger.js'
import type { PendingView, ReadyCard as ReadyMsg } from '../shared/protocol.js'
import type { Lang } from '../shared/replies.js'
import { Toaster } from '@/components/ui/sonner'
import { API_BASE } from '@/lib/api'
import { createBackupClient } from '@/lib/backup'
import type { KhataStore } from '@/lib/contracts'
import { clientLog } from '@/lib/log'
import { canRemind, dueForReminder, runAutoReminders, sendReminder } from '@/lib/remind'
import { createStore, idbPersistence } from '@/lib/store'
import { startSync, type SyncNotice } from '@/lib/sync'
import { CashbookTab } from '@/ui/CashbookTab'
import { CashSheet, type CashMode } from '@/ui/CashSheet'
import { CollectSheet, type CollectStatus } from '@/ui/CollectSheet'
import { CustomerSheet } from '@/ui/CustomerSheet'
import { EntrySheet, TypeSheet, type EntryMode } from '@/ui/EntrySheet'
import { savedFeedback } from '@/ui/feedback'
import { rs, today } from '@/ui/format'
import { DuesTab, type DuesSort, type Party } from '@/ui/home/DuesTab'
import { Header } from '@/ui/home/Header'
import { Onboarding } from '@/ui/home/Onboarding'
import { Splash } from '@/ui/home/Splash'
import { StatsRow } from '@/ui/home/StatsRow'
import { TodayTab } from '@/ui/home/TodayTab'
import { VoiceDock } from '@/ui/home/VoiceDock'
import { ImportSheet, type ImportSink } from '@/ui/ImportSheet'
import { Segmented, type SegmentedItem } from '@/ui/kit'
import { ListSheet, type ListView } from '@/ui/ListSheet'
import { Wordmark } from '@/ui/Logo'
import { MenuSheet } from '@/ui/Menu'
import { announceOn } from '@/ui/prefs'
import { ReadyCard, Waterfall } from '@/ui/parts'
import { PrivacySheet } from '@/ui/PrivacySheet'
import { PromiseSuggestionCard } from '@/ui/PromiseSuggestionCard'
import { ProfileForm } from '@/ui/Profile'
import { QrSheet } from '@/ui/QrSheet'
import { RemindSheet } from '@/ui/RemindSheet'
import { shareWhatsApp, toastRemind } from '@/ui/share'
import { ui } from '@/ui/strings'
import { UNDO_STYLE, type ShowMsg, useVoice } from '@/ui/useVoice'

const ConfirmPage = lazy(() => import('@/pages/ConfirmPage'))
const PayPage = lazy(() => import('@/pages/PayPage'))
const backup = createBackupClient(API_BASE)

export default function App() {
  const m = location.pathname.match(/^\/c\/([A-Za-z0-9_-]+)/)
  return (
    <MotionConfig reducedMotion="user">
      {m ? <Suspense fallback={<Splash />}><ConfirmPage token={m[1]} /></Suspense>
        // a customer paying from a WhatsApp reminder: no ledger on this page
        : location.pathname === '/pay' ? <Suspense fallback={<Splash />}><PayPage /></Suspense>
        : <ShopApp />}
    </MotionConfig>
  )
}

function ShopApp() {
  const [store, setStore] = useState<KhataStore | null>(null)
  useEffect(() => { void createStore(idbPersistence()).then(setStore) }, [])
  return (
    <AnimatePresence mode="wait">
      {!store ? (
        <motion.div key="splash" className="h-full" exit={{ opacity: 0 }} transition={{ duration: 0.2 }}><Splash /></motion.div>
      ) : (
        <motion.div key="home" className="h-full" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}><Home store={store} /></motion.div>
      )}
    </AnimatePresence>
  )
}

type Tab = 'today' | 'dues' | 'cashbook'
type SheetId = 'menu' | 'privacy' | 'import' | 'remind' | 'collect' | null
const TAB_ORDER: Tab[] = ['today', 'dues', 'cashbook']

function Home({ store }: { store: KhataStore }) {
  const state = useSyncExternalStore(store.subscribe, () => store.state)
  const settings = store.settings
  const t = ui(settings.lang)
  const [tab, setTabState] = useState<Tab>('today')
  const [tabDir, setTabDir] = useState(1)
  const [cid, setCid] = useState<string | null>(null)
  const [sheet, setSheet] = useState<SheetId>(null)
  // rows read aloud from an old paper khata go straight to the open import sheet
  const importRows = useRef<Parameters<ImportSink>[0]>(null)
  const importSink = useCallback<ImportSink>((fn) => { importRows.current = fn }, [])
  // the bottom panel (question card, mic) floats over the list: the list is padded by its real height
  const [footerH, setFooterH] = useState(260)
  /** a spoken "show ..." list: a day's entries, a search, the biggest dues */
  const [listView, setListView] = useState<ListView | null>(null)
  /** a tool's one-tap card: send this on WhatsApp, or open the backup */
  const [ready, setReady] = useState<ReadyMsg | null>(null)
  /** the entry just written: it flashes once, then is plain again */
  const [fresh, setFresh] = useState<string | null>(null)
  const freshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [entry, setEntry] = useState<EntryMode>(null)
  const [entryFrom, setEntryFrom] = useState<string | null>(null)
  const [typing, setTyping] = useState(false)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<DuesSort>('amount')
  const [party, setParty] = useState<Party>('customer')
  /** "30 din se purane": the Dues tab narrowed to dues at least this old */
  const [minAge, setMinAge] = useState<number | null>(null)
  /** the counter QR: mounted only while set, so every open makes a fresh QR */
  const [qr, setQr] = useState<{ cid: string; paise: number } | null>(null)
  /** the latest payment notice: the open QR sheet closes when its qrId matches */
  const [lastPaid, setLastPaid] = useState<SyncNotice | null>(null)
  const [collectSt, setCollectSt] = useState<Record<string, CollectStatus>>({})
  /** "kal de dunga" on WhatsApp: a promise offered, written only on a tap */
  const [suggestion, setSuggestion] = useState<SyncNotice | null>(null)
  const [cash, setCash] = useState<CashMode>(null)
  const online = useOnline()

  const setTab = (next: Tab) => {
    setTabDir(TAB_ORDER.indexOf(next) >= TAB_ORDER.indexOf(tab) ? 1 : -1)
    setTabState(next)
  }
  const flash = (eid: string) => {
    setFresh(eid)
    if (freshTimer.current) clearTimeout(freshTimer.current)
    freshTimer.current = setTimeout(() => setFresh(null), 2000)
  }

  const v = useVoice(store, t, {
    pending: (p: PendingView | null) => {
      if (p) { setCid(null); setSheet(null); setEntry(null); setTyping(false); setListView(null); setReady(null) } // the question card must be visible
    },
    show: (s: ShowMsg) => {
      // one view at a time: the new one replaces whatever was open
      setReady(null) // a card from an earlier turn must not stay tappable
      if (s.view !== 'customer') setCid(null)
      if (s.view !== 'history' && s.view !== 'search' && s.view !== 'top_debtors') setListView(null)
      switch (s.view) {
        case 'customer': setListView(null); setSheet(null); setCid(s.cid); break
        case 'dues': setSheet(null); setParty('customer'); setMinAge(null); setTab('dues'); break
        case 'overdue': setSheet(null); setParty('customer'); setSort('age'); setMinAge(s.days); setTab('dues'); break
        case 'suppliers': setSheet(null); setParty('supplier'); setMinAge(null); setTab('dues'); break
        case 'summary': case 'today': setSheet(null); setTab('today'); break
        case 'cashbook': setSheet(null); setTab('cashbook'); break
        case 'collect': setSheet('collect'); break
        case 'privacy': setSheet('privacy'); break
        case 'settings': setSheet('menu'); break
        case 'history': setSheet(null); setListView({ k: 'history', from: s.from, to: s.to, cid: s.cid }); break
        case 'search': setSheet(null); setListView({ k: 'search', text: s.text, cids: s.cids, eids: s.eids }); break
        case 'top_debtors': setSheet(null); setListView({ k: 'top', count: s.count }); break
        case 'close': setSheet(null); setListView(null); setEntry(null); setTyping(false); setReady(null); setQr(null); setCash(null); break
      }
    },
    // the counter QR opens its own sheet; the other cards sit in the dock
    ready: (r) => { if (r?.kind === 'qr') { setReady(null); setQr({ cid: r.cid, paise: r.paise }) } else setReady(r) },
    saved: flash,
  })
  const { metrics, pending, snapshot, sendTyped, voice: voiceRef, stop } = v

  /** who a WhatsApp card goes to: the customer's name and number, or a note that WhatsApp will ask */
  const recipient = (c?: string) => {
    const cu = c ? store.state.customers.get(c) : undefined
    if (!cu) return t.noNumber
    return cu.phone ? `${cu.name} · ${cu.phone}` : `${cu.name} · ${t.noNumber}`
  }
  const openEntry = (eid: string) => { setEntryFrom(cid); setCid(null); setEntry({ kind: 'edit', eid }) }
  const closeEntry = () => { setEntry(null); if (entryFrom) setCid(entryFrom); setEntryFrom(null) }
  const onSaved = (eid: string, how: 'new' | 'edit' | 'removed') => {
    const e = store.state.entries.get(eid)
    const nm = e ? store.state.customers.get(e.cid)?.name ?? '' : ''
    if (how === 'removed') { toast(`${t.removed}: ${nm}`); return }
    savedFeedback()
    flash(eid)
    toast(`${t.saved}: ${nm} ${e ? rs(e.paise) : ''}`, {
      action: how === 'new' ? { label: t.undo, onClick: () => void store.voidEntry(eid, 'tap undo').then(() => snapshot()) } : undefined,
      actionButtonStyle: UNDO_STYLE,
      duration: 8000,
    })
  }

  // Razorpay payments and customer replies come back into the khata; opted-in customers go up for reminders
  useEffect(() => startSync(store, (n) => {
    const tt = ui(store.settings.lang)
    const name = store.state.customers.get(n.cid)?.name ?? ''
    if (n.kind === 'payment') {
      const paise = n.paise ?? 0
      // in the same tick the payment lands: the collect row ticks, an open QR for it closes
      setCollectSt((m) => ({ ...m, [n.cid]: 'paid' }))
      setLastPaid(n)
      savedFeedback()
      toast.success(`${name}: ${rs(paise)} ${tt.payGot}`, { description: n.balancePaise !== undefined ? `${tt.balance}: ${n.balancePaise < 0 ? '−' : ''}${rs(n.balancePaise)}` : tt.paidOnline, duration: 8000 })
      if (announceOn(store.settings)) {
        // the soundbox moment: spoken by the agent in the shop's language, or by the phone if the socket is down
        const sent = voiceRef.current?.announce?.({ kind: 'payment', cid: n.cid, paise, balancePaise: n.balancePaise, partial: n.partial }) ?? false
        if (!sent && 'speechSynthesis' in window) {
          const u = new SpeechSynthesisUtterance(`${name}, ${rs(paise)} ${tt.payGot}`)
          u.lang = tt.loc
          speechSynthesis.speak(u)
        }
      }
    } else if (n.kind === 'promise_suggestion') setSuggestion(n)
    else if (n.kind === 'dispute') toast.warning(`${name} ${tt.disputeSays}${n.text ? `: “${n.text}”` : ''}`)
    else if (n.kind === 'optout') toast(`${name} ${tt.stoppedReminders}`)
  }), [store, voiceRef])

  // automatic WhatsApp reminders: on open and every 6 h while the app stays open
  useEffect(() => {
    const run = () => void runAutoReminders(store).then(({ sent }) => { if (sent) toast.success(`${ui(store.settings.lang).remindSent} × ${sent}`) })
    run()
    const id = setInterval(run, 6 * 3600_000)
    return () => clearInterval(id)
  }, [store])

  useEffect(() => () => { if (freshTimer.current) clearTimeout(freshTimer.current) }, [])
  const onFooterHeight = useCallback((h: number) => setFooterH(h), [])

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

  /** "Sabko yaad dilao" in the collect queue: opted-in adults with a number, one by one; a row shows 'sent' while it goes */
  const remindQueue = async (cids: string[]) => {
    let sent = 0
    for (const c of cids.filter((x) => canRemind(store.state, x))) {
      setCollectSt((m) => ({ ...m, [c]: m[c] === 'paid' ? 'paid' : 'sent' }))
      const r = await sendReminder(store, c)
      if (r.ok) sent++
      else setCollectSt((m) => { const { [c]: _drop, ...rest } = m; return rest })
    }
    if (sent) toast.success(`${t.remindSent} × ${sent}`)
  }

  /** WhatsApp button on a dues row: send now, or open the customer to add the number / consent. */
  const quickRemind = (c: string) => {
    const cu = store.state.customers.get(c)
    if (!cu?.phone || !cu.adult || !cu.remindersOptIn) {
      setCid(c)
      toast(!cu?.phone ? t.noPhone : t.notAllowed)
      return
    }
    void sendReminder(store, c, { interactive: true }).then((r) => toastRemind(t, r))
  }

  // reading an old khata aloud needed the old voice session's import mode (the agent has none): typed and photo import remain
  const importReading = async (_on: boolean): Promise<boolean> => false

  const setLanguage = (l: 'auto' | Lang) => {
    const auto = l === 'auto'
    void store.updateSettings(auto ? { autoLang: true } : { lang: l, autoLang: false }).then(() => { if (voiceRef.current) stop() })
  }

  const all = useMemo(() => state.order.map((id) => state.entries.get(id)!), [state])
  const due = useMemo(() => dues(state), [state])

  // Android back button: close the topmost layer, else let the app minimise
  const back = useRef<() => boolean>(() => false)
  useEffect(() => {
    back.current = () => {
      if (qr) setQr(null)
      else if (cash) setCash(null)
      else if (entry) closeEntry()
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
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mx-auto h-full max-w-md overflow-y-auto px-5 pb-8" style={{ paddingTop: SAFE_TOP }}>
        <Wordmark size={48} />
        <h1 className="mt-6 text-3xl font-semibold tracking-tight">{t.signupTitle}</h1>
        <div className="gold-rule mt-3 mb-5" />
        <ProfileForm t={t} initial={settings} submit={t.continueBtn} onSave={(p) => void store.updateSettings({ ...p, profileDone: true })} />
      </motion.div>
    )
  }

  if (isNative && !settings.micAsked) return <MicStep t={t} onDone={() => void store.updateSettings({ micAsked: true })} />

  const { lenaPaise, denaPaise } = lenaDena(state)
  const owedCount = due.length + supplierDues(state).length
  const name = (c: string) => displayName(state, c)
  // add a tab here (and to TAB_ORDER) to give Home another view
  const tabs: SegmentedItem<Tab>[] = [
    { value: 'today', label: t.history },
    { value: 'dues', label: t.dues, count: owedCount },
    { value: 'cashbook', label: t.cashTab },
  ]
  /** payments recorded from the QR sheet: cash, or UPI the shopkeeper saw arrive (counted as bank) */
  const paidAtCounter = (c: string, paise: number, upi: boolean) => void store.applyOps([{
    op: 'entry', eid: crypto.randomUUID(), cid: c, paise, direction: 'payment', dayOffset: 0, promise: false,
    source: { transcript: upi ? 'UPI QR' : '(paid in cash at the QR)', confidence: 'high', reasons: upi ? ['qr'] : [], lang: settings.lang ?? 'hi', path: 'fast' },
  }]).then(() => { savedFeedback(); setCollectSt((m) => ({ ...m, [c]: 'paid' })); snapshot() })
  const acceptPromise = (n: SyncNotice) => {
    if (!n.day) return
    const paise = n.paise ?? balance(store.state, n.cid)
    setSuggestion(null)
    if (paise <= 0) return
    void store.applyOps([{
      op: 'entry', eid: crypto.randomUUID(), cid: n.cid, paise, direction: 'payment', promise: true, dayOffset: Math.max(0, daysBetween(today(), n.day)),
      source: { transcript: n.text ?? 'WhatsApp', confidence: 'high', reasons: ['whatsapp'], lang: settings.lang ?? 'hi', path: 'fast' },
    }]).then(snapshot)
  }
  const suggestionCard = suggestion?.kind === 'promise_suggestion' && suggestion.day ? (
    <PromiseSuggestionCard
      notice={{ cid: suggestion.cid, day: suggestion.day, paise: suggestion.paise, text: suggestion.text }}
      name={name(suggestion.cid)} lang={settings.lang} className="shadow-none ring-0 p-0 bg-transparent"
      onAccept={() => acceptPromise(suggestion)} onDismiss={() => setSuggestion(null)}
    />
  ) : null
  // the dock's one-tap card: WhatsApp / backup; the counter QR ('qr') opens QrSheet instead
  const readyCard = !ready ? null : ready.kind === 'qr' ? null : (
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
  )

  return (
    <div className="mx-auto flex h-full max-w-md flex-col">
      <Header t={t} settings={settings} dueCount={due.length} onMenu={() => setSheet('menu')} onBell={() => setSheet('collect')} onLanguage={setLanguage} />
      <AnimatePresence initial={false}>
        {!online && (
          <motion.div role="status" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mx-4 mt-2 flex items-center gap-2 rounded-xl bg-warn/12 px-3 py-2 text-sm font-medium text-warn">
              <WifiOff className="size-4 shrink-0" /><span>{t.offlineStrip}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <StatsRow t={t} lena={lenaPaise} dena={denaPaise} />

      <div className="mx-4 mt-3 flex gap-2">
        <Segmented className="flex-1" label={t.history} items={tabs} value={tab} onChange={setTab} panelId="home-panel" />
        <button aria-label={t.addEntry} onClick={() => setEntry({ kind: 'new' })} className="grid size-14 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-2 active:scale-95"><Plus className="size-6" /></button>
      </div>

      <main id="home-panel" role="tabpanel" className="no-scrollbar flex-1 overflow-x-hidden overflow-y-auto px-4 pt-2" style={{ paddingBottom: footerH + 16 }}>
        {settings.showLatency && metrics && <div className="mb-2"><Waterfall m={metrics} /></div>}
        <AnimatePresence mode="wait" initial={false} custom={tabDir}>
          <motion.div
            key={tab} custom={tabDir} className="space-y-2"
            variants={{ enter: (d: number) => ({ opacity: 0, x: 28 * d }), center: { opacity: 1, x: 0 }, leave: (d: number) => ({ opacity: 0, x: -28 * d }) }}
            initial="enter" animate="center" exit="leave" transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            {tab === 'today' ? (
              <TodayTab t={t} lang={settings.lang} state={state} entries={all} name={name} fresh={fresh} onEntry={(eid) => setEntry({ kind: 'edit', eid })} onImport={() => setSheet('import')} onExample={(x) => void sendTyped(x)} />
            ) : tab === 'dues' ? (
              <DuesTab t={t} lang={settings.lang} state={state} name={name} q={q} setQ={setQ} sort={sort} setSort={setSort}
                party={party} setParty={setParty} minAge={minAge} setMinAge={setMinAge} onCustomer={setCid} onRemind={quickRemind} />
            ) : (
              <CashbookTab state={state} day={today()} lang={settings.lang} onAdd={() => setCash('new')}
                onRow={(r) => (r.derived ? setEntry({ kind: 'edit', eid: r.eid }) : setCash({ eid: r.eid }))} />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      <VoiceDock v={v} t={t} handsFree={settings.handsFree} ready={pending ? null : readyCard ?? suggestionCard} onTyping={() => setTyping(true)} onHeight={onFooterHeight}
        onTag={(c, tag) => { const cu = store.state.customers.get(c); if (cu) void store.setConsent(c, { adult: cu.adult, remindersOptIn: cu.remindersOptIn, phone: cu.phone, tag }).then(snapshot) }} />

      <CustomerSheet store={store} cid={cid} t={t} backup={backup} onClose={() => setCid(null)} onChanged={snapshot} onEntry={openEntry}
        onQr={(c, paise) => { setCid(null); setQr({ cid: c, paise }) }} />
      {qr && (
        <QrSheet
          open onOpenChange={(o) => { if (!o) setQr(null) }}
          cid={qr.cid} paise={qr.paise} name={name(qr.cid)} lang={settings.lang}
          shopUpi={settings.shopUpi} shopName={settings.shopName} paidNotice={lastPaid}
          onPaidCash={() => paidAtCounter(qr.cid, qr.paise, false)}
          onPaidUpi={() => paidAtCounter(qr.cid, qr.paise, true)}
        />
      )}
      <CollectSheet
        open={sheet === 'collect'} onOpenChange={(o) => { if (!o) setSheet(null) }}
        state={state} lang={settings.lang} statuses={collectSt}
        onOpenCustomer={(c) => { setSheet(null); setCid(c) }}
        onRemindAll={(cids) => void remindQueue(cids)}
      />
      <CashSheet store={store} mode={cash} t={t} onClose={() => setCash(null)} onChanged={snapshot} />
      <EntrySheet store={store} t={t} mode={entry} onClose={closeEntry} onChanged={snapshot} onSaved={onSaved}
        onCustomer={(c) => { setEntry(null); setEntryFrom(null); setCid(c) }} />
      <TypeSheet open={typing} t={t} onClose={() => setTyping(false)} onSend={sendTyped} />
      <RemindSheet store={store} open={sheet === 'remind'} t={t} onClose={() => setSheet(null)} onChanged={snapshot} />
      <ImportSheet store={store} open={sheet === 'import'} t={t} sink={importSink} onReading={importReading} onClose={() => setSheet(null)} onChanged={snapshot} />
      <MenuSheet store={store} open={sheet === 'menu'} t={t} onClose={() => setSheet(null)} onPrivacy={() => setSheet('privacy')} onImport={() => setSheet('import')} onRemindAll={() => void remindAll()} onReminders={() => setSheet('remind')}
        onChanged={(p) => { if (p.handsFree !== undefined) voiceRef.current?.setHandsFree(p.handsFree); if (p.fastSpeech !== undefined) { const speed = p.fastSpeech ? 1.2 : 1; void store.updateSettings({ speed }); voiceRef.current?.setSpeed(speed) } }} />
      <ListSheet store={store} view={listView} t={t} onClose={() => setListView(null)}
        onCustomer={(c) => { setListView(null); setCid(c) }} onEntry={(eid) => { setListView(null); setEntry({ kind: 'edit', eid }) }} />
      <PrivacySheet store={store} open={sheet === 'privacy'} t={t} backup={backup} onClose={() => setSheet(null)} onChanged={snapshot} />
      <Toaster position="top-center" offset={{ top: 'calc(env(safe-area-inset-top) + 16px)' }} />
    </div>
  )
}

/** Page top padding that clears the status bar when the app draws edge-to-edge (Android 15+). */
export const SAFE_TOP = 'max(2rem, calc(env(safe-area-inset-top) + 1rem))'
