import { Download, MessageCircle, Share2, ShieldCheck, ShieldAlert, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { balance } from '../../shared/ledger.js'
import { LANG_NAME, LANGS, type Lang } from '../../shared/replies.js'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import type { BackupClient, KhataStore } from '@/lib/contracts'
import { clientLog } from '@/lib/log'
import { cn } from '@/lib/utils'
import { dayLabel, rs } from './format'
import { Passbook } from './Ledger'
import type { UiStrings } from './strings'

const NOTES_EN = [
  'Your khata is stored only on this phone, encrypted (AES-256). Each customer has their own key.',
  'Your voice goes to Gnani for speech-to-text and back as speech. Hard sentences go to Claude (Anthropic) as text. Nothing is kept on our server.',
  'Every entry is chained with a fingerprint, so any change shows up. Corrections are added, never overwritten.',
  'Reminders: only for adult customers who agreed, and you send them yourself.',
]
const NOTES_HI = [
  'आपका खाता सिर्फ़ इसी फ़ोन पर, ताले (AES-256) में रहता है। हर ग्राहक की अलग चाबी।',
  'आपकी आवाज़ लिखने और बोलने के लिए Gnani को जाती है। मुश्किल वाक्य शब्दों में Claude (Anthropic) को। हमारे सर्वर पर कुछ नहीं रुकता।',
  'हर एंट्री पर एक निशान जुड़ता है, इसलिए कोई भी बदलाव पकड़ में आता है। सुधार नई लाइन में जुड़ते हैं, पुराना मिटता नहीं।',
  'याद दिलाना: सिर्फ़ उन वयस्क ग्राहकों को जिन्होंने हाँ कहा, और भेजते आप ख़ुद हैं।',
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
  useEffect(() => setPhone(c?.phone ?? ''), [c?.cid, c?.phone])
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
  const consent = (patch: Partial<{ remindersOptIn: boolean; adult: boolean; phone: string }>) =>
    store.setConsent(c.cid, { remindersOptIn: c.remindersOptIn, adult: c.adult, phone: phone || undefined, ...patch }).then(onChanged)

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

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto rounded-t-3xl pb-8">
        <SheetHeader>
          <SheetTitle className="text-2xl">{c.name}</SheetTitle>
          {c.aliases.length > 0 && <div className="text-sm text-muted-foreground">{c.aliases.join(' · ')}</div>}
        </SheetHeader>
        <div className="px-4">
          <div className={cn('num text-5xl font-extrabold', bal > 0 ? 'text-credit' : 'text-payment')}>{rs(bal)}</div>
          <div className="text-sm text-muted-foreground">{bal > 0 ? t.dues : bal < 0 ? t.payment : '✓'}</div>

          <div className="mt-5 space-y-3 rounded-2xl bg-muted/50 p-3 text-sm">
            <label className="flex items-center justify-between gap-3">
              <span>{t.adult}</span>
              <Switch checked={c.adult} onCheckedChange={(v) => void consent({ adult: v, remindersOptIn: v && c.remindersOptIn })} />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span>{t.reminders}</span>
              <Switch disabled={!c.adult} checked={c.remindersOptIn} onCheckedChange={(v) => void consent({ remindersOptIn: v })} />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span>{t.phone}</span>
              <input
                inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={() => phone !== (c.phone ?? '') && void consent({})}
                aria-label={t.phone} className="h-11 w-40 rounded-lg border bg-background px-2 text-right" placeholder="98xxxxxxxx"
              />
            </label>
          </div>

          <div className="mt-5 mb-1 flex items-center justify-between">
            <span className="text-sm font-semibold text-muted-foreground">{t.history}</span>
            <button onClick={shareStatement} className="flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-primary ring-1 ring-primary/30">
              <Share2 className="size-4" />{t.shareStatement}
            </button>
          </div>
          <Passbook entries={entries} t={t} onEntry={onEntry} onConfirm={(eid) => void askConfirm(eid)} />

          <button
            onClick={() => { if (confirm(`${t.forget}: ${c.name}?`)) void store.forgetCustomer(c.cid).then(() => { void dropBackup(backup); onChanged(); onClose() }) }}
            className="mt-6 flex min-h-11 items-center gap-2 text-sm text-destructive"
          >
            <Trash2 className="size-4" />{t.forget}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function SettingsSheet({ store, open, t, onClose, onChanged }: {
  store: KhataStore; open: boolean; t: UiStrings; onClose: () => void; onChanged: (p: { lang?: Lang; handsFree?: boolean; fastSpeech?: boolean; readBackAll?: boolean }) => void
}) {
  const st = store.settings
  const [name, setName] = useState(st.shopName)
  const [debugLogs, setDebugLogs] = useState(clientLog.enabled)
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="rounded-t-3xl pb-8">
        <SheetHeader><SheetTitle>{t.settings}</SheetTitle></SheetHeader>
        <div className="space-y-4 px-4 text-sm">
          <label className="flex items-center justify-between gap-3">
            <span>{t.shopName}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => void store.updateSettings({ shopName: name.trim() || st.shopName })}
              aria-label={t.shopName} className="h-11 w-44 rounded-lg border bg-background px-2 text-right" maxLength={40} />
          </label>
          <label className="flex items-center justify-between">
            <span>{t.handsFree}</span>
            <Switch checked={st.handsFree} onCheckedChange={(v) => void store.updateSettings({ handsFree: v }).then(() => onChanged({ handsFree: v }))} />
          </label>
          <label className="flex items-center justify-between">
            <span>{t.fastSpeech}</span>
            <Switch checked={!!st.fastSpeech} onCheckedChange={(v) => void store.updateSettings({ fastSpeech: v }).then(() => onChanged({ fastSpeech: v }))} />
          </label>
          <label className="flex items-center justify-between">
            <span>{t.readBackAll}</span>
            <Switch checked={!!st.readBackAll} onCheckedChange={(v) => void store.updateSettings({ readBackAll: v }).then(() => onChanged({ readBackAll: v }))} />
          </label>
          <label className="flex items-center justify-between">
            <span>{t.debugLogs}</span>
            <Switch checked={debugLogs} onCheckedChange={(v) => { clientLog.set(v); setDebugLogs(v) }} />
          </label>
          <label className="flex items-center justify-between">
            <span>{t.latency}</span>
            <Switch checked={st.showLatency} onCheckedChange={(v) => void store.updateSettings({ showLatency: v })} />
          </label>
          <div role="group" aria-label={t.language} className="grid grid-cols-5 gap-1.5">
            {LANGS.map((l) => (
              <button key={l} aria-pressed={st.lang === l} onClick={() => void store.updateSettings({ lang: l }).then(() => onChanged({ lang: l }))}
                className={cn('min-h-11 rounded-xl py-2 text-sm ring-1 ring-black/10', st.lang === l && 'bg-primary text-primary-foreground')}>
                {LANG_NAME[l]}
              </button>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
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
              <button onClick={() => void doRestore()} className="min-h-11 shrink-0 rounded-lg px-3 ring-1 ring-black/15">{t.restore}</button>
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

export function remindLink(store: KhataStore, cid: string, text: string) {
  shareWhatsApp(text, store.state.customers.get(cid)?.phone)
}
export { MessageCircle }
