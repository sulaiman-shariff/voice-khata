import { CalendarDays, Check, Keyboard, Plus, Search, Send, Trash2, User } from 'lucide-react'
import { NAME_NEAR, NAME_SURE, matchName } from '../../shared/names.js'
import { useMemo, useState } from 'react'
import { type Direction, displayName } from '../../shared/ledger.js'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { KhataStore } from '@/lib/contracts'
import { cn } from '@/lib/utils'
import { dayDiff, relDay, rs, shiftDay, time, today } from './format'
import type { UiStrings } from './strings'

export type EntryMode = { kind: 'edit'; eid: string } | { kind: 'new' } | null
type How = 'new' | 'edit' | 'removed'

export function EntrySheet({ store, t, mode, onClose, onChanged, onSaved }: {
  store: KhataStore; t: UiStrings; mode: EntryMode; onClose: () => void; onChanged: () => void
  /** after a save: eid + what happened, so the app can chime / toast */
  onSaved: (eid: string, how: How) => void
}) {
  if (!mode) return null
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-3xl pb-6">
        <EntryForm key={mode.kind === 'edit' ? mode.eid : 'new'} store={store} t={t} mode={mode} onClose={onClose} onChanged={onChanged} onSaved={onSaved} />
      </SheetContent>
    </Sheet>
  )
}

function Seg({ on, className, children, onClick }: { on: boolean; className?: string; children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cn('flex h-12 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 text-base font-semibold transition-colors', on ? className : 'bg-card ring-1 ring-foreground/15')}>
      {children}
    </button>
  )
}

function Chip({ on, dashed, children, onClick }: { on: boolean; dashed?: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn('flex min-h-11 max-w-full items-center gap-1 rounded-lg px-3.5 text-base font-medium ring-1', on ? 'bg-primary text-primary-foreground ring-primary' : 'bg-card ring-foreground/15', dashed && 'text-primary ring-primary/50')}>
      <span className="truncate">{children}</span>
    </button>
  )
}

function EntryForm({ store, t, mode, onClose, onChanged, onSaved }: {
  store: KhataStore; t: UiStrings; mode: NonNullable<EntryMode>; onClose: () => void; onChanged: () => void; onSaved: (eid: string, how: How) => void
}) {
  const s = store.state
  const e = mode.kind === 'edit' ? s.entries.get(mode.eid) : undefined
  const [amt, setAmt] = useState(e ? String(e.paise / 100) : '')
  const [dir, setDir] = useState<Direction>(e?.direction ?? 'credit')
  const [cid, setCid] = useState<string | null>(e?.cid ?? null)
  const [newName, setNewName] = useState('')
  const [q, setQ] = useState('')
  // editing keeps the customer folded into one line; a new entry starts by picking one
  const [picking, setPicking] = useState(!e)
  const [day, setDay] = useState(e?.day ?? today())
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)

  const people = useMemo(() => [...s.customers.values()].map((c) => ({ id: c.cid, names: [c.name, ...c.aliases] })), [s])
  const customers = useMemo(() => {
    const last = new Map<string, number>()
    for (const id of s.order) { const x = s.entries.get(id); if (x) last.set(x.cid, x.ts) }
    const needle = q.trim().toLowerCase()
    // sounds-alike across scripts too: typing "Ramesh" finds "रमेश", so nobody gets two accounts by mistake
    const near = new Set(needle.length >= 3 ? matchName(needle, people).filter((m) => m.score >= NAME_NEAR).map((m) => m.id) : [])
    return [...s.customers.values()]
      .filter((c) => !needle || near.has(c.cid) || c.name.toLowerCase().includes(needle) || c.aliases.some((a) => a.toLowerCase().includes(needle)) || !!c.tag?.toLowerCase().includes(needle))
      .sort((a, b) => (last.get(b.cid) ?? 0) - (last.get(a.cid) ?? 0))
      .slice(0, needle ? 12 : 8)
  }, [s, q, people])

  const paise = Math.round(parseFloat(amt) * 100)
  const qn = q.trim()
  const exact = [...s.customers.values()].some((c) => c.name.toLowerCase() === qn.toLowerCase()) ||
    (qn.length >= 3 && (matchName(qn, people)[0]?.score ?? 0) >= NAME_SURE)
  const valid = paise > 0 && !!(newName || cid) && !!day
  const removed = !!e?.voided
  const dirty = !!e && (paise !== e.paise || dir !== e.direction || !!newName || (!!cid && cid !== e.cid) || day !== e.day)
  const chosen = newName ? `${newName} · ${t.newCustomer}` : cid ? displayName(s, cid) : ''

  const pick = (id: string | null, name = '') => { setCid(id); setNewName(name); setQ(''); setPicking(false) }

  const save = async () => {
    if (!valid || busy) return
    setBusy(true)
    try {
      const target = newName ? await store.addCustomer(newName) : cid!
      if (e) {
        const ch: { paise?: number; direction?: Direction; cid?: string; day?: string } = {}
        if (paise !== e.paise) ch.paise = paise
        if (dir !== e.direction) ch.direction = dir
        if (target !== e.cid) ch.cid = target
        if (day !== e.day) ch.day = day
        if (Object.keys(ch).length) await store.amendEntry(e.eid, ch)
        onSaved(e.eid, 'edit')
      } else {
        const eid = crypto.randomUUID()
        await store.applyOps([{
          op: 'entry', eid, cid: target, paise, direction: dir, dayOffset: dayDiff(day), promise: false,
          source: { transcript: '(typed by hand)', confidence: 'high', reasons: [], lang: 'manual', path: 'fast' },
        }])
        onSaved(eid, 'new')
      }
      onChanged()
      onClose()
    } finally { setBusy(false) }
  }

  const remove = async () => {
    if (!e) return
    if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 4000); return }
    await store.voidEntry(e.eid, 'removed by hand')
    onSaved(e.eid, 'removed')
    onChanged()
    onClose()
  }

  const typedByHand = e?.source?.lang === 'manual'
  const otherDay = day !== today() && day !== shiftDay(-1)
  return (
    <>
      <SheetHeader className="pb-0">
        <SheetTitle className="flex items-baseline gap-2 pr-10 font-display text-xl">
          {e ? t.editEntry : t.addEntry}
          {e && <span className="num font-sans text-sm font-normal text-muted-foreground">{relDay(e.day, t)} · {time(e.ts)}</span>}
        </SheetTitle>
        {e?.source && !typedByHand && <div className="truncate text-sm text-muted-foreground">“{e.source.transcript}”</div>}
      </SheetHeader>
      <div className="space-y-4 px-4">
        {removed && <div className="rounded-lg bg-muted p-3 text-base text-muted-foreground">{t.removed}</div>}

        {/* amount */}
        <label className="flex items-baseline gap-2 border-b-2 border-gold/60 pb-1 focus-within:border-primary">
          <span className="num text-3xl text-muted-foreground">₹</span>
          <input
            aria-label={t.amount} inputMode="decimal" value={amt} placeholder="0" disabled={removed} autoFocus={!e}
            onChange={(ev) => setAmt(ev.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1').slice(0, 9))}
            className="num min-w-0 flex-1 bg-transparent text-5xl font-bold outline-none focus-visible:outline-none placeholder:text-muted-foreground/30"
          />
        </label>

        {/* credit / paid */}
        <div className="grid grid-cols-2 gap-2">
          <Seg on={dir === 'credit'} className="bg-credit text-white shadow-md" onClick={() => setDir('credit')}>{t.credit}</Seg>
          <Seg on={dir === 'payment'} className="bg-payment text-white shadow-md" onClick={() => setDir('payment')}>{t.payment}</Seg>
        </div>

        {/* customer: one line once chosen, a search while picking */}
        <div>
          <div className="mb-1.5 text-xs font-bold tracking-widest text-muted-foreground uppercase">{t.customer}</div>
          {!picking && chosen ? (
            <div className="flex min-h-12 items-center gap-3 rounded-lg bg-card px-3 ring-1 ring-foreground/15">
              <User className="size-5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-lg font-semibold">{chosen}</span>
              {!removed && <button type="button" onClick={() => setPicking(true)} className="min-h-11 shrink-0 px-2 text-sm font-semibold text-primary">{t.change}</button>}
            </div>
          ) : (
            <>
              <label className="flex h-12 items-center gap-2 rounded-lg bg-card px-3 ring-1 ring-foreground/15 focus-within:ring-2 focus-within:ring-primary">
                <Search className="size-4 shrink-0 text-muted-foreground" />
                <input
                  value={q} onChange={(ev) => setQ(ev.target.value)} placeholder={t.findOrNew} aria-label={t.customer} disabled={removed}
                  className="min-w-0 flex-1 bg-transparent text-base outline-none focus-visible:outline-none"
                />
              </label>
              <div className="mt-2 flex max-h-40 flex-wrap gap-2 overflow-y-auto">
                {qn && qn !== newName && (
                  <Chip on={false} dashed onClick={() => pick(null, qn)}>
                    <Plus className="mr-0.5 inline size-4" />{exact ? `${t.anotherSame} “${qn}”` : `${t.newCustomer}: ${qn}`}
                  </Chip>
                )}
                {customers.map((c) => (
                  <Chip key={c.cid} on={!newName && cid === c.cid} onClick={() => pick(c.cid)}>{displayName(s, c.cid)}</Chip>
                ))}
              </div>
            </>
          )}
        </div>

        {/* date */}
        <div>
          <div className="mb-1.5 text-xs font-bold tracking-widest text-muted-foreground uppercase">{t.day}</div>
          <div className="grid grid-cols-3 gap-2">
            <Seg on={day === today()} className="bg-primary text-primary-foreground" onClick={() => setDay(today())}>{t.today}</Seg>
            <Seg on={day === shiftDay(-1)} className="bg-primary text-primary-foreground" onClick={() => setDay(shiftDay(-1))}>{t.yesterday}</Seg>
            <label className={cn('relative flex h-12 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-semibold', otherDay ? 'bg-primary text-primary-foreground' : 'bg-card ring-1 ring-foreground/15')}>
              <CalendarDays className="size-4 shrink-0" />
              <span className="num truncate">{otherDay ? relDay(day, t) : t.pickDate}</span>
              <input
                type="date" aria-label={t.pickDate} value={day} max={e?.promise ? undefined : today()}
                onChange={(ev) => ev.target.value && setDay(ev.target.value)}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </label>
          </div>
        </div>

        <button
          onClick={() => void save()} disabled={!valid || busy || removed || (!!e && !dirty)}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-lg bg-primary text-lg font-bold text-primary-foreground shadow-md disabled:opacity-40"
        >
          <Check className="size-5" />{e ? t.saveChanges : t.saveEntry}{valid && <span className="num">· {rs(paise)}</span>}
        </button>

        {e && !removed && (
          <div className="flex flex-col items-center gap-0.5 pt-1">
            <button onClick={() => void remove()} className={cn('flex min-h-11 items-center gap-1.5 px-3 text-sm font-semibold', armed ? 'rounded-lg bg-destructive text-white' : 'text-destructive')}>
              <Trash2 className="size-4" />{armed ? t.tapAgain : t.removeEntry}
            </button>
            {(armed || e.amended) && <div className="text-xs text-muted-foreground">{e.amended ? `${t.editedNote} · ` : ''}{t.keepsHistory}</div>}
          </div>
        )}
      </div>
    </>
  )
}

/** Type instead of speaking: same pipeline as a spoken sentence, bulk lists welcome. */
export function TypeSheet({ open, t, onClose, onSend }: { open: boolean; t: UiStrings; onClose: () => void; onSend: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const rows = Math.min(6, Math.max(4, text.split('\n').length))
  const send = async () => {
    const v = text.trim()
    if (!v || busy) return
    setBusy(true)
    try { if (await onSend(v)) { setText(''); onClose() } } finally { setBusy(false) }
  }
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="rounded-t-3xl pb-6">
        <SheetHeader className="pb-0"><SheetTitle className="flex items-center gap-2 text-xl"><Keyboard className="size-5" />{t.typeInstead}</SheetTitle></SheetHeader>
        <div className="space-y-3 px-4">
          <textarea
            value={text} onChange={(ev) => setText(ev.target.value)} rows={rows} placeholder={t.typeHint} aria-label={t.typeInstead}
            className="w-full resize-none rounded-2xl border bg-background p-3 text-lg leading-snug placeholder:text-muted-foreground/60"
          />
          <button onClick={() => void send()} disabled={!text.trim() || busy} className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-lg font-bold text-primary-foreground disabled:opacity-40">
            <Send className="size-5" />{t.send}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
