import { BellRing, Loader2, PartyPopper, Send } from 'lucide-react'
import { useEffect, useState } from 'react'
import { balance, displayName } from '../../shared/ledger.js'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import type { KhataStore } from '@/lib/contracts'
import { sendReminder, twilioReady } from '@/lib/remind'
import { cn } from '@/lib/utils'
import { rs } from './format'
import { Avatar, EmptyState, NameTag, PhoneInput, Segmented } from './kit'
import { toastRemind } from './share'
import type { UiStrings } from './strings'

/**
 * The bell at the top: every customer who owes, each with their WhatsApp number (typed right
 * here), one consent switch and a Send button, plus "Send to all". Works any time, next to the
 * automatic reminders (a customer who missed one, or a reminder the shop wants to send now).
 */
export function RemindSheet({ store, open, t, onClose, onChanged }: {
  store: KhataStore; open: boolean; t: UiStrings; onClose: () => void; onChanged: () => void
}) {
  const s = store.state
  const [all, setAll] = useState(false)
  const [twilio, setTwilio] = useState<boolean | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => { if (open) void twilioReady(true).then(setTwilio) }, [open])

  const rows = [...s.customers.values()]
    .map((c) => ({ c, owed: balance(s, c.cid) }))
    .filter((x) => all || x.owed > 0)
    .sort((a, b) => b.owed - a.owed || a.c.name.localeCompare(b.c.name))
  const ready = rows.filter((x) => x.owed > 0 && x.c.phone && x.c.adult && x.c.remindersOptIn)

  const send = async (cid: string) => {
    setBusy(cid)
    try { toastRemind(t, await sendReminder(store, cid, { interactive: true })) } finally { setBusy(null) }
  }
  const sendAll = async () => {
    setBusy('*')
    try {
      for (const x of ready) toastRemind(t, await sendReminder(store, x.c.cid, { interactive: false }))
    } finally { setBusy(null) }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent closeLabel={t.dismiss}>
        <SheetHeader className="pb-0">
          <SheetTitle className="flex items-center gap-2 pr-10 text-2xl font-semibold tracking-tight"><BellRing className="size-6 text-primary" />{t.remindersNav}</SheetTitle>
          <div className={cn('text-sm', twilio ? 'text-primary' : 'text-muted-foreground')}>{twilio === null ? '…' : twilio ? `✓ ${t.twilioOn}` : t.twilioOff}</div>
        </SheetHeader>
        <div className="space-y-3 px-4">
          <Segmented size="sm" label={t.remindersNav} value={all ? 'all' : 'dues'} onChange={(v) => setAll(v === 'all')}
            items={[{ value: 'dues', label: t.dues }, { value: 'all', label: t.everyone }]} />

          {rows.length === 0 && <EmptyState icon={PartyPopper} title={t.allClear} hint={t.noneDue} />}
          <ul className="space-y-2">
            {rows.map(({ c, owed }) => (
              <Row key={`${c.cid}:${c.phone ?? ''}`} store={store} t={t} cid={c.cid} owed={owed} busy={busy === c.cid || busy === '*'} onSend={() => void send(c.cid)} onChanged={onChanged} name={displayName(s, c.cid)} />
            ))}
          </ul>

          {ready.length > 1 && (
            <button onClick={() => void sendAll()} disabled={!!busy || !twilio}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-primary-foreground shadow-2 active:scale-[.98] disabled:opacity-40">
              {busy === '*' ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-5" />}{t.sendTo} ({ready.length})
            </button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Row({ store, t, cid, name, owed, busy, onSend, onChanged }: {
  store: KhataStore; t: UiStrings; cid: string; name: string; owed: number; busy: boolean; onSend: () => void; onChanged: () => void
}) {
  const c = store.state.customers.get(cid)!
  // the row is keyed by the saved phone, so a phone saved elsewhere remounts it with the new value
  const [phone, setPhone] = useState(c.phone ?? '')
  const phoneOk = !phone.trim() || phone.replace(/\D/g, '').length >= 10
  const save = (p: Partial<{ phone: string; consent: boolean }>) =>
    store.setConsent(cid, {
      adult: p.consent ?? c.adult, remindersOptIn: p.consent ?? c.remindersOptIn,
      phone: (p.phone ?? phone).trim() || undefined, tag: c.tag,
    }).then(onChanged)
  const consent = c.adult && c.remindersOptIn
  const last = store.settings.reminded?.[cid]
  const canSend = owed > 0 && !!phone.trim() && phoneOk && consent

  return (
    <li className="space-y-2 rounded-2xl bg-card p-3.5 shadow-1 ring-1 ring-foreground/6">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2.5"><Avatar name={name} id={cid} className="size-8 text-sm" /><NameTag label={name} className="text-base font-semibold" /></span>
        <span className={cn('num shrink-0 text-lg font-semibold', owed > 0 ? 'text-credit' : 'text-muted-foreground')}>{rs(Math.max(0, owed))}</span>
      </div>
      <div className="flex items-center gap-2">
        <PhoneInput size="sm" className="min-w-0 flex-1" value={phone} onChange={setPhone} placeholder={t.addNumber} label={`${t.phone}: ${name}`} invalid={!phoneOk}
          onBlur={() => { if (phone.trim() !== (c.phone ?? '') && phoneOk) void save({}) }} />
        <button
          aria-label={`${t.remindNow}: ${name}`} disabled={!canSend || busy}
          onClick={() => void (phone.trim() !== (c.phone ?? '') ? save({}) : Promise.resolve()).then(onSend)}
          className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-1 active:scale-[.98] disabled:opacity-35"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <BellRing className="size-4" />}{t.remindNow}
        </button>
      </div>
      <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{t.consentBoth}</span>
        <Switch checked={consent} onCheckedChange={(v) => void save({ consent: v })} />
      </label>
      {last && <div className="text-xs text-muted-foreground">{t.lastReminded}: {new Date(last).toLocaleString(t.loc, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</div>}
    </li>
  )
}
