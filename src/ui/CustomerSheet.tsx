import { Merge, MessageCircle, QrCode, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { balance, displayName, owedLabel } from '../../shared/ledger.js'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import type { BackupClient, KhataStore } from '@/lib/contracts'
import { clientLog } from '@/lib/log'
import { isUpiId } from '@/lib/pay'
import { reminderMessage, sendReminder } from '@/lib/remind'
import { cn } from '@/lib/utils'
import { dayLabel, rs } from './format'
import { AnimatedAmount, ConfirmDialog, PhoneInput, inputCls } from './kit'
import { Passbook } from './Ledger'
import { PlanCard } from './PlanCard'
import { dropBackup, shareWhatsApp, toastRemind } from './share'
import { StatementButton } from './StatementButton'
import type { UiStrings } from './strings'
import { fx } from './strings-features'

const LINKS_KEY = 'vk-confirm-links'
const loadLinks = (): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(LINKS_KEY) ?? '{}') } catch { return {} }
}
const saveLinks = (m: Record<string, string>) => {
  try { localStorage.setItem(LINKS_KEY, JSON.stringify(m)) } catch { /* private mode */ }
}

const digits = (p?: string) => (p ?? '').replace(/\D/g, '').slice(-10)

/** One customer: balance, WhatsApp reminder settings, plan, passbook, statement, confirmation links. */
export function CustomerSheet({ store, cid, t, backup, onClose, onChanged, onEntry, onQr }: {
  store: KhataStore; cid: string | null; t: UiStrings; backup: BackupClient; onClose: () => void; onChanged: () => void; onEntry: (eid: string) => void
  /** open the counter QR for this amount */
  onQr?: (cid: string, paise: number) => void
}) {
  const s = store.state
  const c = cid ? s.customers.get(cid) : undefined
  const [phone, setPhone] = useState('')
  const [tag, setTag] = useState('')
  const [busy, setBusy] = useState(false)
  const [forgetting, setForgetting] = useState(false)
  const [merging, setMerging] = useState<string | null>(null)
  // prefilled with what is saved for this customer
  const savedKey = `${c?.cid}|${c?.phone ?? ''}|${c?.tag ?? ''}`
  const [seen, setSeen] = useState('')
  if (seen !== savedKey) { setSeen(savedKey); setPhone(c?.phone ?? ''); setTag(c?.tag ?? '') }
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
  const f = fx(store.settings.lang)
  const supplier = c.kind === 'supplier'
  const owed = owedLabel(c.kind, bal)
  // a same-name account on the same number is probably this person twice: offer the join, never do it unasked
  const twin = digits(c.phone).length === 10 ? [...s.customers.values()].find((o) =>
    o.cid !== c.cid && o.kind === c.kind && o.name.trim().toLowerCase() === c.name.trim().toLowerCase() && digits(o.phone) === digits(c.phone)) : undefined
  const save = (patch: Partial<{ remindersOptIn: boolean; adult: boolean; phone: string; tag: string }>) =>
    store.setConsent(c.cid, { remindersOptIn: c.remindersOptIn, adult: c.adult, phone: phone.trim() || undefined, tag: tag.trim() || undefined, ...patch }).then(onChanged)
  const phoneOk = !phone.trim() || phone.replace(/\D/g, '').length >= 10
  const last = store.settings.reminded?.[c.cid]

  const askConfirm = async (eid: string) => {
    const e = s.entries.get(eid)!
    try {
      const { token, url } = await backup.createConfirmLink({
        eid, shopName: store.settings.shopName, paise: e.paise, direction: e.direction, day: e.day, lang: store.settings.lang ?? 'hi',
      })
      saveLinks({ ...loadLinks(), [eid]: token })
      shareWhatsApp(`${store.settings.shopName}: ${rs(e.paise)} (${dayLabel(e.day)}). ${url}`, c.phone)
    } catch (err) {
      clientLog.warn('confirm_link_failed', { error: String(err) })
      toast.error(t.linkFailed)
    }
  }

  const remind = async () => {
    setBusy(true)
    try { toastRemind(t, await sendReminder(store, c.cid, { interactive: true })) } finally { setBusy(false) }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent closeLabel={t.dismiss}>
        <SheetHeader className="pb-0">
          <SheetTitle className="pr-10 text-2xl">{title}</SheetTitle>
          {c.aliases.length > 0 && <div className="text-sm text-muted-foreground">{c.aliases.join(' · ')}</div>}
        </SheetHeader>
        <div className="space-y-5 px-4">
          <div>
            <AnimatedAmount paise={bal} className={cn('block text-5xl font-semibold tracking-tight', owed.side === 'none' ? 'text-foreground' : supplier ? 'text-supplier' : bal > 0 ? 'text-credit' : 'text-payment')} />
            <div className="mt-0.5 text-sm text-muted-foreground">{owed.side === 'lena' ? t.lenaHai : owed.side === 'dena' ? (supplier ? t.denaHai : f.advance) : t.allClear}</div>
          </div>

          {twin && (
            <button onClick={() => setMerging(twin.cid)}
              className="flex min-h-11 w-full items-center gap-2 rounded-xl bg-gold/10 px-3 py-2 text-left text-sm ring-1 ring-gold/30 active:scale-[.99]">
              <Merge className="size-4 shrink-0 text-gold" aria-hidden />
              <span className="min-w-0 flex-1"><span className="text-muted-foreground">{t.sameNumber}</span> <span className="font-semibold">{displayName(s, twin.cid)}</span></span>
              <span className="shrink-0 font-semibold text-primary">{t.mergeAsk}</span>
            </button>
          )}

          <PlanCard state={s} cid={c.cid} lang={store.settings.lang} onCancel={() => void store.cancelPlan(c.cid).then(onChanged)} />

          {/* WhatsApp reminder: number, consent, send — all in one place (never for suppliers) */}
          {!supplier && <section className="space-y-3 rounded-2xl bg-card p-4 text-sm shadow-1 ring-1 ring-foreground/6">
            <div className="flex items-center gap-2 font-semibold"><MessageCircle className="size-5 text-primary" />{t.waReminders}</div>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted-foreground">{t.phone}</span>
              <PhoneInput value={phone} onChange={setPhone} label={t.phone} invalid={!phoneOk}
                onBlur={() => { if (phone.trim() !== (c.phone ?? '') && phoneOk) void save({}) }} />
            </label>
            <label className="flex min-h-11 items-center justify-between gap-3">
              <span>{t.adult}</span>
              <Switch checked={c.adult} onCheckedChange={(v) => void save({ adult: v, remindersOptIn: v && c.remindersOptIn })} />
            </label>
            <label className="flex min-h-11 items-center justify-between gap-3">
              <span>{t.reminders}</span>
              <Switch disabled={!c.adult} checked={c.remindersOptIn} onCheckedChange={(v) => void save({ remindersOptIn: v })} />
            </label>
            <div className="flex gap-2">
              <button onClick={() => void (phone.trim() !== (c.phone ?? '') && phoneOk ? save({}) : Promise.resolve()).then(remind)} disabled={busy || bal <= 0}
                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-primary-foreground shadow-1 active:scale-[.98] disabled:opacity-40">
                <MessageCircle className="size-5" />{t.remindNow}
              </button>
              {onQr && bal > 0 && (
                <button onClick={() => onQr(c.cid, bal)} aria-label={`${f.qrTitle}: ${rs(bal)}`}
                  className="flex h-12 shrink-0 items-center gap-2 rounded-xl bg-card px-4 font-semibold text-primary shadow-1 ring-1 ring-primary/25 active:scale-[.98]">
                  <QrCode className="size-5" />{t.qr}
                </button>
              )}
            </div>
            {!isUpiId(store.settings.shopUpi) && <div className="rounded-xl bg-gold/10 px-3 py-2 text-xs">{t.addUpiHint}</div>}
            {bal > 0 && (
              <details className="rounded-xl bg-background ring-1 ring-foreground/8">
                <summary className="flex min-h-11 cursor-pointer items-center px-3 text-xs font-semibold text-muted-foreground">{t.msgPreview}</summary>
                <pre className="px-3 pb-3 font-sans text-[13px] leading-snug whitespace-pre-wrap">{reminderMessage(s, store.settings, c.cid)}</pre>
              </details>
            )}
            <div className="text-xs text-muted-foreground">
              {bal <= 0 ? t.nothingDue : !phone.trim() ? t.noPhone : !c.adult || !c.remindersOptIn ? t.notAllowed
                : last ? `${t.lastReminded}: ${new Date(last).toLocaleString(t.loc, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}
            </div>
          </section>}

          <label className="block text-sm">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">{t.tag}</span>
            <input
              value={tag} onChange={(e) => setTag(e.target.value)} onBlur={() => { if (tag.trim() !== (c.tag ?? '')) void save({}) }} maxLength={30}
              aria-label={t.tag} placeholder="Gali 3 / doodhwala" className={cn(inputCls, 'h-11')}
            />
            <span className="mt-1 block text-xs text-muted-foreground">{t.tagHint}</span>
          </label>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-bold tracking-widest text-muted-foreground uppercase">{t.history}</span>
              <StatementButton state={s} cid={c.cid} settings={store.settings} className="h-11 px-3 text-sm text-primary ring-primary/25" />
            </div>
            <Passbook entries={entries} t={t} onEntry={onEntry} onConfirm={(eid) => void askConfirm(eid)} state={s} lang={store.settings.lang} />
          </div>

          <button onClick={() => setForgetting(true)} className="flex min-h-11 items-center gap-2 text-sm text-destructive">
            <Trash2 className="size-4" />{t.forget}
          </button>
        </div>
        <ConfirmDialog
          open={forgetting} onOpenChange={setForgetting} destructive
          title={`${t.forget}: ${title}?`} body={t.forgetBody} confirmLabel={t.forget} cancelLabel={t.cancel}
          onConfirm={() => void store.forgetCustomer(c.cid).then(() => { void dropBackup(backup); onChanged(); onClose() })}
        />
        <ConfirmDialog
          open={!!merging} onOpenChange={(o) => { if (!o) setMerging(null) }}
          title={merging ? `${t.mergeAsk}: ${displayName(s, merging)} → ${title}?` : ''} body={`${t.sameNumber} ${c.phone ?? ''}`}
          confirmLabel={t.mergeAsk} cancelLabel={t.cancel}
          // the same op the voice flow writes after its question, and only ever from this explicit tap
          onConfirm={() => { const from = merging; setMerging(null); if (from) void store.applyOps([{ op: 'merge_customers', from, into: c.cid }]).then(onChanged) }}
        />
      </SheetContent>
    </Sheet>
  )
}
