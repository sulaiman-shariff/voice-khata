import { BellRing, Loader2, Send } from 'lucide-react'
import { useEffect, useState } from 'react'
import { balance, displayName } from '../../shared/ledger.js'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import type { KhataStore } from '@/lib/contracts'
import { sendReminder, twilioReady } from '@/lib/remind'
import { cn } from '@/lib/utils'
import { rs } from './format'
import { toastRemind } from './Sheets'
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
      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-3xl pb-6">
        <SheetHeader className="pb-0">
          <SheetTitle className="flex items-center gap-2 pr-10 text-2xl font-semibold tracking-tight"><BellRing className="size-6 text-primary" />{t.remindersNav}</SheetTitle>
          <div className={cn('text-sm', twilio ? 'text-payment' : 'text-muted-foreground')}>{twilio === null ? '…' : twilio ? `✓ ${t.twilioOn}` : t.twilioOff}</div>
        </SheetHeader>
        <div className="space-y-3 px-4">
          <div role="tablist" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm font-semibold">
            <button role="tab" aria-selected={!all} onClick={() => setAll(false)} className={cn('min-h-10 rounded-md', !all && 'bg-card shadow-sm')}>{t.dues}</button>
            <button role="tab" aria-selected={all} onClick={() => setAll(true)} className={cn('min-h-10 rounded-md', all && 'bg-card shadow-sm')}>{t.everyone}</button>
          </div>

          {rows.length === 0 && <div className="py-8 text-center text-muted-foreground">{t.noneDue}</div>}
          <ul className="space-y-2">
            {rows.map(({ c, owed }) => (
              <Row key={c.cid} store={store} t={t} cid={c.cid} owed={owed} busy={busy === c.cid || busy === '*'} onSend={() => void send(c.cid)} onChanged={onChanged} name={displayName(s, c.cid)} />
            ))}
          </ul>

          {ready.length > 1 && (
            <button onClick={() => void sendAll()} disabled={!!busy || !twilio}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary font-semibold text-primary-foreground shadow-md disabled:opacity-40">
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
  const [phone, setPhone] = useState(c.phone ?? '')
  useEffect(() => setPhone(c.phone ?? ''), [c.phone])
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
    <li className="space-y-2 rounded-lg bg-card p-3 ring-1 ring-foreground/10">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-base font-semibold">{name}</span>
        <span className={cn('num shrink-0 text-lg font-semibold', owed > 0 ? 'text-credit' : 'text-muted-foreground')}>{rs(Math.max(0, owed))}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className={cn('flex h-11 min-w-0 flex-1 items-center rounded-lg bg-background ring-1 ring-foreground/15 focus-within:ring-2 focus-within:ring-primary', !phoneOk && 'ring-destructive')}>
          <span className="num border-r border-border px-2.5 text-sm text-muted-foreground">+91</span>
          <input
            inputMode="tel" autoComplete="tel" value={phone} placeholder={t.addNumber} aria-label={`${t.phone}: ${name}`} aria-invalid={!phoneOk}
            onChange={(e) => setPhone(e.target.value)} onBlur={() => phone.trim() !== (c.phone ?? '') && phoneOk && void save({})}
            className="num h-full min-w-0 flex-1 bg-transparent px-2.5 text-base outline-none focus-visible:outline-none"
          />
        </span>
        <button
          aria-label={`${t.remindNow}: ${name}`} disabled={!canSend || busy}
          onClick={() => void (phone.trim() !== (c.phone ?? '') ? save({}) : Promise.resolve()).then(onSend)}
          className="flex h-11 shrink-0 items-center gap-1.5 rounded-lg bg-payment px-3 text-sm font-semibold text-white disabled:opacity-35"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <BellRing className="size-4" />}{t.remindNow}
        </button>
      </div>
      <label className="flex min-h-9 items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{t.consentBoth}</span>
        <Switch checked={consent} onCheckedChange={(v) => void save({ consent: v })} />
      </label>
      {last && <div className="text-xs text-muted-foreground">{t.lastReminded}: {new Date(last).toLocaleString(t.loc, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</div>}
    </li>
  )
}
