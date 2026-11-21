import { Download, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { eraseWord } from '../../shared/replies.js'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { BackupClient, KhataStore } from '@/lib/contracts'
import { cn } from '@/lib/utils'
import { ConfirmDialog, inputCls } from './kit'
import { EraseTyped } from './parts'
import { dropBackup } from './share'
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

/** "Mera data kahan hai?": where the data lives, proof it is untampered, export, backup, erase. */
export function PrivacySheet({ store, open, t, backup, onClose, onChanged }: {
  store: KhataStore; open: boolean; t: UiStrings; backup: BackupClient; onClose: () => void; onChanged: () => void
}) {
  const [chain, setChain] = useState<{ ok: boolean; records: number } | null>(null)
  const [pin, setPin] = useState('')
  const [restoreId, setRestoreId] = useState('')
  const [msg, setMsg] = useState('')
  const [erasing, setErasing] = useState(false)
  /** the first tap shows the typed-word confirmation; the reset runs only when the word is typed */
  const [resetArmed, setResetArmed] = useState(false)
  useEffect(() => { if (open) void store.verify().then(setChain) }, [open, store, store.state])
  const lastId = (() => { try { return localStorage.getItem('vk-backup-id') ?? '' } catch { return '' } })()
  const word = eraseWord(store.settings.lang ?? 'hi')

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
    <Sheet open={open} onOpenChange={(o) => { if (!o) { setResetArmed(false); onClose() } }}>
      <SheetContent closeLabel={t.dismiss}>
        <SheetHeader><SheetTitle className="pr-10 text-2xl">{t.myData}</SheetTitle></SheetHeader>
        <div className="space-y-4 px-4 text-sm">
          <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
            {(store.settings.lang === 'hi' || store.settings.lang === 'mr' ? NOTES_HI : NOTES_EN).map((n) => <li key={n}>{n}</li>)}
          </ul>
          {chain && (
            <div className={cn('flex items-center gap-2 rounded-2xl p-3 font-medium', chain.ok ? 'bg-primary/6 text-primary' : 'bg-destructive/10 text-destructive')}>
              {chain.ok ? <ShieldCheck className="size-5" /> : <ShieldAlert className="size-5" />}
              {chain.ok ? t.chainOk : t.chainBad} · <span className="num">{chain.records}</span>
            </div>
          )}
          <button onClick={() => void download()} className="flex min-h-11 items-center gap-2 font-medium text-primary"><Download className="size-4" />{t.export}</button>

          <div className="space-y-2 rounded-2xl bg-muted/60 p-3">
            <div className="font-semibold">{t.backup}</div>
            <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" type="password" placeholder="PIN" aria-label="PIN" className={cn(inputCls, 'h-11')} />
            <div className="flex gap-2">
              <button onClick={() => void doBackup()} className="h-11 shrink-0 rounded-xl bg-primary px-4 font-semibold text-primary-foreground">{t.backupBtn}</button>
              <input value={restoreId} onChange={(e) => setRestoreId(e.target.value.trim())} placeholder={lastId ? `${lastId.slice(0, 8)}…` : t.backupId} aria-label={t.backupId} className={cn(inputCls, 'h-11 min-w-0 flex-1')} />
              <button onClick={() => void doRestore()} className="h-11 shrink-0 rounded-xl bg-card px-3 font-semibold ring-1 ring-foreground/12">{t.restore}</button>
            </div>
            {msg && <div role="status" className="text-xs text-muted-foreground">{msg}</div>}
            <div className="text-xs text-muted-foreground">{t.backupNote}</div>
          </div>

          <button onClick={() => setErasing(true)} className="flex min-h-11 items-center gap-2 text-destructive"><Trash2 className="size-4" />{t.deleteAll}</button>

          {/* tucked away: wipes this browser's ledger and settings and starts from the first screen */}
          <div className="pt-1 text-center">
            {!resetArmed ? (
              <button onClick={() => setResetArmed(true)} className="min-h-11 px-3 text-xs text-muted-foreground underline underline-offset-4">{t.resetBrowser}</button>
            ) : (
              <div className="space-y-1 text-left">
                <div className="text-sm font-semibold text-destructive">{t.resetBrowser}</div>
                <div className="text-sm text-muted-foreground">{t.typeToErase} <b className="text-foreground">{word}</b></div>
                <EraseTyped word={word} t={t} onErase={() => location.assign(`${location.pathname}?reset=1`)} />
              </div>
            )}
          </div>
        </div>
        <ConfirmDialog
          open={erasing} onOpenChange={setErasing} destructive
          title={`${t.deleteAll}?`} body={t.deleteAllBody} confirmLabel={t.deleteAll} cancelLabel={t.cancel}
          onConfirm={() => void store.deleteAll().then(() => { void dropBackup(backup); onChanged() })}
        />
      </SheetContent>
    </Sheet>
  )
}
