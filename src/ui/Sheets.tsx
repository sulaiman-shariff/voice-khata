import { Download, MessageCircle, Share2, ShieldCheck, ShieldAlert, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { balance, displayName } from '../../shared/ledger.js'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import type { BackupClient, KhataStore } from '@/lib/contracts'
import { isUpiId } from '@/lib/pay'
import { type RemindResult, reminderMessage, sendReminder } from '@/lib/remind'
import { cn } from '@/lib/utils'
import { dayLabel, rs } from './format'
import { Passbook } from './Ledger'
import type { UiStrings } from './strings'

const NOTES_EN = [
  'Your khata is stored only on this phone, encrypted (AES-256). Each customer has their own key.',
  'Your voice goes to Gnani for speech-to-text and back as speech. Hard sentences, and photos of your old khata if you import one, go to an AI model (Google Gemini) to be read. Nothing is kept on our server.',
  'Every entry is chained with a fingerprint, so any change shows up. Corrections are added, never overwritten.',
  "Reminders: only for adult customers who agreed. They go on WhatsApp from your shop's Twilio number (or you send them yourself); only the number and the message leave the phone.",
]
const NOTES_HI = [
  'आपका खाता सिर्फ़ इसी फ़ोन पर, ताले (AES-256) में रहता है। हर ग्राहक की अलग चाबी।',
  'आपकी आवाज़ लिखने और बोलने के लिए Gnani को जाती है। मुश्किल वाक्य, और पुराने खाते की फ़ोटो (अगर आप जोड़ें), पढ़ने के लिए AI मॉडल (Google Gemini) को जाते हैं। हमारे सर्वर पर कुछ नहीं रुकता।',
  'हर एंट्री पर एक निशान जुड़ता है, इसलिए कोई भी बदलाव पकड़ में आता है। सुधार नई लाइन में जुड़ते हैं, पुराना मिटता नहीं।',
  'याद दिलाना: सिर्फ़ उन वयस्क ग्राहकों को जिन्होंने हाँ कहा। संदेश WhatsApp पर आपकी दुकान के Twilio नंबर से जाता है (या आप ख़ुद भेजते हैं); फ़ोन से सिर्फ़ नंबर और संदेश जाता है।',
]
const LINKS_KEY = 'vk-confirm-links'
const loadLinks = (): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(LINKS_KEY) ?? '{}') } catch { return {} }
}
const saveLinks = (m: Record<string, string>) => {
  try { localStorage.setItem(LINKS_KEY, JSON.stringify(m)) } catch { /* private mode */ }
}

export function shareWhatsApp(text: string, phone?: string) {
  const digits = phone?.replace(/\D/g, '') ?? ''
  const to = digits.length === 10 ? `91${digits}` : digits
  window.open(`https://wa.me/${to}?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
}

export function CustomerSheet({ store, cid, t, backup, onClose, onChanged, onEntry }: {
  store: KhataStore; cid: string | null; t: UiStrings; backup: BackupClient; onClose: () => void; onChanged: () => void; onEntry: (eid: string) => void
}) {
  const s = store.state
  const c = cid ? s.customers.get(cid) : undefined
  const [phone, setPhone] = useState('')
  const [tag, setTag] = useState('')
  const [busy, setBusy] = useState(false)
  // prefilled with what is saved for this customer
  useEffect(() => { setPhone(c?.phone ?? ''); setTag(c?.tag ?? '') }, [c?.cid, c?.phone, c?.tag])
  // pick up customers' answers to confirmation links
  useEffect(() => {
    if (!c) return
    const links = loadLinks()
    for (const e of s.entries.values()) {
      const tok = links[e.eid]
      if (e.cid !== c.cid || !tok || e.status !== 'unconfirmed') continue
      backup.confirmStatus(tok).then((st) => {
        if (st === 'confirmed' || st === 'disputed') void store.setConfirmation(e.eid, st)
      }).catch(() => {})
    }
  }, [c?.cid]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!c) return null
  const entries = s.order.map((id) => s.entries.get(id)!).filter((e) => e.cid === c.cid)
  const bal = balance(s, c.cid)
  const title = displayName(s, c.cid)
  const save = (patch: Partial<{ remindersOptIn: boolean; adult: boolean; phone: string; tag: string }>) =>
    store.setConsent(c.cid, { remindersOptIn: c.remindersOptIn, adult: c.adult, phone: phone.trim() || undefined, tag: tag.trim() || undefined, ...patch }).then(onChanged)
  const phoneOk = !phone.trim() || phone.replace(/\D/g, '').length >= 10
  const last = store.settings.reminded?.[c.cid]

  const askConfirm = async (eid: string) => {
    const e = s.entries.get(eid)!
    const { token, url } = await backup.createConfirmLink({
      eid, shopName: store.settings.shopName, paise: e.paise, direction: e.direction, day: e.day, lang: store.settings.lang ?? 'hi',
    })
    saveLinks({ ...loadLinks(), [eid]: token })
    shareWhatsApp(`${store.settings.shopName}: ${rs(e.paise)} (${dayLabel(e.day)}). ${url}`, c.phone)
  }

  const shareStatement = () => {
    const rows = entries.filter((e) => !e.voided && !e.promise).sort((a, b) => b.day.localeCompare(a.day) || b.ts - a.ts).slice(0, 10)
    const lines = rows.map((e) => `${dayLabel(e.day)}  ${e.direction === 'credit' ? t.credit : t.payment}  ${rs(e.paise)}`)
    const text = [store.settings.shopName, `${t.stmtHello}: ${c.name}`, '', ...lines, '', `${t.stmtBalance}: ${bal < 0 ? '−' : ''}${rs(bal)}`, '', t.stmtThanks].join('\n')
    shareWhatsApp(text, c.phone)
  }

  const remind = async () => {
    setBusy(true)
    try { toastRemind(t, await sendReminder(store, c.cid, { interactive: true })) } finally { setBusy(false) }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto rounded-t-3xl pb-8">
        <SheetHeader className="pb-1">
          <SheetTitle className="pr-10 font-display text-2xl">{title}</SheetTitle>
          {c.aliases.length > 0 && <div className="text-sm text-muted-foreground">{c.aliases.join(' · ')}</div>}
        </SheetHeader>
        <div className="space-y-5 px-4">
          <div>
            <div className={cn('num text-5xl font-semibold tracking-tight', bal > 0 ? 'text-credit' : 'text-payment')}>{rs(bal)}</div>
            <div className="text-sm text-muted-foreground">{bal > 0 ? t.dues : bal < 0 ? t.payment : '✓'}</div>
          </div>

          {/* WhatsApp reminder: number, consent, send — all in one place */}
          <section className="space-y-3 rounded-lg bg-card p-3 text-sm ring-1 ring-foreground/10">
            <div className="flex items-center gap-2 font-semibold"><MessageCircle className="size-5 text-payment" />{t.waReminders}</div>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted-foreground">{t.phone}</span>
              <span className={cn('flex h-12 items-center rounded-lg bg-background ring-1 ring-foreground/15 focus-within:ring-2 focus-within:ring-primary', !phoneOk && 'ring-destructive')}>
                <span className="num border-r border-border px-3 text-base text-muted-foreground">+91</span>
                <input
                  inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={() => phone.trim() !== (c.phone ?? '') && phoneOk && void save({})}
                  aria-label={t.phone} aria-invalid={!phoneOk} placeholder="98765 43210"
                  className="num h-full min-w-0 flex-1 bg-transparent px-3 text-base outline-none focus-visible:outline-none"
                />
              </span>
            </label>
            <label className="flex min-h-11 items-center justify-between gap-3">
              <span>{t.adult}</span>
              <Switch checked={c.adult} onCheckedChange={(v) => void save({ adult: v, remindersOptIn: v && c.remindersOptIn })} />
            </label>
            <label className="flex min-h-11 items-center justify-between gap-3">
              <span>{t.reminders}</span>
              <Switch disabled={!c.adult} checked={c.remindersOptIn} onCheckedChange={(v) => void save({ remindersOptIn: v })} />
            </label>
            <button onClick={() => void (phone.trim() !== (c.phone ?? '') && phoneOk ? save({}) : Promise.resolve()).then(remind)} disabled={busy || bal <= 0}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-payment font-semibold text-white shadow-sm disabled:opacity-40">
              <MessageCircle className="size-5" />{t.remindNow}
            </button>
            {!isUpiId(store.settings.shopUpi) && <div className="rounded-md bg-gold/10 px-2.5 py-2 text-xs">{t.addUpiHint}</div>}
            {bal > 0 && (
              <details className="rounded-md bg-background ring-1 ring-foreground/10">
                <summary className="flex min-h-11 cursor-pointer items-center px-3 text-xs font-semibold text-muted-foreground">{t.msgPreview}</summary>
                <pre className="px-3 pb-3 font-sans text-[13px] leading-snug whitespace-pre-wrap">{reminderMessage(s, store.settings, c.cid)}</pre>
              </details>
            )}
            <div className="text-xs text-muted-foreground">
              {bal <= 0 ? t.nothingDue : !phone.trim() ? t.noPhone : !c.adult || !c.remindersOptIn ? t.notAllowed
                : last ? `${t.lastReminded}: ${new Date(last).toLocaleString(t.loc, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}
            </div>
          </section>

          <label className="block text-sm">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">{t.tag}</span>
            <input
              value={tag} onChange={(e) => setTag(e.target.value)} onBlur={() => tag.trim() !== (c.tag ?? '') && void save({})} maxLength={30}
              aria-label={t.tag} placeholder="Gali 3 / doodhwala"
              className="h-11 w-full rounded-lg bg-card px-3 text-base ring-1 ring-foreground/15"
            />
            <span className="mt-1 block text-xs text-muted-foreground">{t.tagHint}</span>
          </label>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-bold tracking-widest text-muted-foreground uppercase">{t.history}</span>
              <button onClick={shareStatement} className="flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-primary ring-1 ring-primary/30">
                <Share2 className="size-4" />{t.shareStatement}
              </button>
            </div>
            <Passbook entries={entries} t={t} onEntry={onEntry} onConfirm={(eid) => void askConfirm(eid)} />
          </div>

          <button
            onClick={() => { if (confirm(`${t.forget}: ${title}?`)) void store.forgetCustomer(c.cid).then(() => { void dropBackup(backup); onChanged(); onClose() }) }}
            className="flex min-h-11 items-center gap-2 text-sm text-destructive"
          >
            <Trash2 className="size-4" />{t.forget}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** Twilio's codes that a shop on the free trial actually meets, in plain words. */
const TWILIO_HINT: Record<number, string> = {
  63015: 'This number has not joined your Twilio WhatsApp trial. From that phone, send the join code (e.g. "join twilio-trial") to your Twilio number.',
  63016: 'More than 24 h since this number last messaged your Twilio number. From that phone, send the join code again, then retry.',
  21211: 'Twilio says this phone number is not valid.',
  21608: 'On the Twilio trial you can only message your verified number.',
  21610: 'This customer replied STOP, so Twilio will not message them.',
  63007: 'The Twilio WhatsApp sender in .env (TWILIO_WHATSAPP_FROM) is not right.',
  20003: 'Twilio rejected the Account SID / Auth Token in .env.',
}

/** One toast per reminder attempt, in the shop's language; Twilio errors say why, and offer the shop's own WhatsApp. */
export function toastRemind(t: UiStrings, r: RemindResult) {
  if (r.ok) toast.success(r.via === 'twilio' ? t.remindSent : t.remindShared)
  else if (r.reason === 'no-phone') toast.error(t.noPhone)
  else if (r.reason === 'not-allowed') toast.error(t.notAllowed)
  else if (r.reason === 'nothing-due') toast(t.nothingDue)
  else {
    const why = (r.code && TWILIO_HINT[r.code]) || r.error || ''
    toast.error(`${t.remindFailed}${r.code ? ` (Twilio ${r.code})` : ''}`, {
      description: why,
      duration: 15000,
      action: r.share ? { label: 'WhatsApp', onClick: r.share } : undefined,
    })
  }
}

/** "Mera data kahan hai?": where the data lives, proof it is untampered, export, backup, erase. */
export function PrivacySheet({ store, open, t, backup, onClose, onChanged }: {
  store: KhataStore; open: boolean; t: UiStrings; backup: BackupClient; onClose: () => void; onChanged: () => void
}) {
  const [chain, setChain] = useState<{ ok: boolean; records: number } | null>(null)
  const [pin, setPin] = useState('')
  const [restoreId, setRestoreId] = useState('')
  const [msg, setMsg] = useState('')
  useEffect(() => { if (open) void store.verify().then(setChain) }, [open, store, store.state])
  const lastId = (() => { try { return localStorage.getItem('vk-backup-id') ?? '' } catch { return '' } })()

  const download = async () => {
    const blob = new Blob([await store.exportReadable()], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `khata-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
  }
  const doBackup = async () => {
    if (pin.length < 4) return setMsg(t.pinShort)
    try {
      const r = await backup.backup(pin, await store.exportRecords())
      try { localStorage.setItem('vk-backup-id', r.id) } catch { /* ignore */ }
      setMsg(`✓ ${r.id.slice(0, 8)}… (${Math.round(r.bytes / 1024)} KB)`)
    } catch (e) { setMsg(String((e as Error).message)) }
  }
  const doRestore = async () => {
    try {
      await store.importRecords(await backup.restore(restoreId || lastId, pin))
      setMsg('✓'); onChanged()
    } catch (e) { setMsg(String((e as Error).message)) }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-3xl pb-8">
        <SheetHeader><SheetTitle>{t.myData}</SheetTitle></SheetHeader>
        <div className="space-y-4 px-4 text-sm">
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {(store.settings.lang === 'hi' || store.settings.lang === 'mr' ? NOTES_HI : NOTES_EN).map((n) => <li key={n}>{n}</li>)}
          </ul>
          {chain && (
            <div className={cn('flex items-center gap-2 rounded-xl p-3 font-medium', chain.ok ? 'bg-payment/10 text-payment' : 'bg-destructive/10 text-destructive')}>
              {chain.ok ? <ShieldCheck className="size-5" /> : <ShieldAlert className="size-5" />}
              {chain.ok ? t.chainOk : t.chainBad} · {chain.records}
            </div>
          )}
          <button onClick={() => void download()} className="flex min-h-11 items-center gap-2 font-medium text-primary"><Download className="size-4" />{t.export}</button>

          <div className="space-y-2 rounded-2xl bg-muted/50 p-3">
            <div className="font-semibold">{t.backup}</div>
            <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" type="password" placeholder="PIN" aria-label="PIN"
              className="h-11 w-full rounded-lg border bg-background px-2" />
            <div className="flex gap-2">
              <button onClick={() => void doBackup()} className="min-h-11 shrink-0 rounded-lg bg-primary px-3 text-primary-foreground">{t.backupBtn}</button>
              <input value={restoreId} onChange={(e) => setRestoreId(e.target.value.trim())} placeholder={lastId ? `${lastId.slice(0, 8)}…` : t.backupId} aria-label={t.backupId}
                className="h-11 min-w-0 flex-1 rounded-lg border bg-background px-2" />
              <button onClick={() => void doRestore()} className="min-h-11 shrink-0 rounded-lg px-3 ring-1 ring-foreground/15">{t.restore}</button>
            </div>
            {msg && <div className="text-xs text-muted-foreground">{msg}</div>}
            <div className="text-xs text-muted-foreground">{t.backupNote}</div>
          </div>

          <button onClick={() => { if (confirm(`${t.deleteAll}?`)) void store.deleteAll().then(() => { void dropBackup(backup); onChanged() }) }}
            className="flex min-h-11 items-center gap-2 text-destructive"><Trash2 className="size-4" />{t.deleteAll}</button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** Remove the server backup too, so erased data cannot be restored from it. */
async function dropBackup(b: BackupClient) {
  try { await (b as unknown as { deleteBackup?: () => Promise<void> }).deleteBackup?.() } catch { /* best effort */ }
}

