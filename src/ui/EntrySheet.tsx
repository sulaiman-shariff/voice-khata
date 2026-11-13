import { Check, Keyboard, Pencil, Plus, Send, Trash2 } from 'lucide-react'
import { NAME_NEAR, NAME_SURE, matchName } from '../../shared/names.js'
import { useMemo, useState } from 'react'
import type { Direction } from '../../shared/ledger.js'
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
    <button type="button" onClick={onClick} className={cn('flex h-12 items-center justify-center rounded-xl px-2 text-base font-semibold ring-1 ring-black/10', on && className)}>
      {children}
    </button>
  )
}

function Chip({ on, dashed, children, onClick }: { on: boolean; dashed?: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn('flex min-h-11 items-center gap-1 rounded-full px-4 text-base font-medium ring-1', on ? 'bg-primary text-primary-foreground ring-primary' : 'ring-black/15', dashed && 'text-primary ring-primary/50')}>
      {children}
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
  const [day, setDay] = useState(e?.day ?? today())
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)

  const customers = useMemo(() => {
    const last = new Map<string, number>()
    for (const id of s.order) { const x = s.entries.get(id); if (x) last.set(x.cid, x.ts) }
    const needle = q.trim().toLowerCase()
    // sounds-alike across scripts too: typing "Ramesh" finds "रमेश", so nobody gets two accounts
    const near = new Set(needle.length >= 3
      ? matchName(needle, [...s.customers.values()].map((c) => ({ id: c.cid, names: [c.name, ...c.aliases] })))
        .filter((m) => m.score >= NAME_NEAR).map((m) => m.id)
      : [])
    return [...s.customers.values()]
      .filter((c) => !needle || near.has(c.cid) || c.name.toLowerCase().includes(needle) || c.aliases.some((a) => a.toLowerCase().includes(needle)))
      .sort((a, b) => (last.get(b.cid) ?? 0) - (last.get(a.cid) ?? 0))
  }, [s, q])

  const paise = Math.round(parseFloat(amt) * 100)
  const qn = q.trim()
  const exact = [...s.customers.values()].some((c) => c.name.toLowerCase() === qn.toLowerCase()) ||
    (qn.length >= 3 && (matchName(qn, [...s.customers.values()].map((c) => ({ id: c.cid, names: [c.name, ...c.aliases] })))[0]?.score ?? 0) >= NAME_SURE)
  const valid = paise > 0 && !!(newName || cid) && !!day
  const removed = !!e?.voided

  const dirty = !!e && (paise !== e.paise || dir !== e.direction || !!newName || (!!cid && cid !== e.cid) || day !== e.day)

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
  return (
    <>
      <SheetHeader className="pb-0">
        <SheetTitle className="flex flex-wrap items-center gap-x-2 text-xl">
          {e ? <Pencil className="size-5" /> : <Plus className="size-5" />}{e ? t.editEntry : t.addEntry}
          {e && <span className="num text-sm font-normal text-muted-foreground">{relDay(e.day, t)} · {time(e.ts)}</span>}
        </SheetTitle>
      </SheetHeader>
      <div className="space-y-4 px-4">
        {removed && <div className="rounded-xl bg-muted p-3 text-base text-muted-foreground">{t.removed}</div>}

        <label className="flex items-center gap-2 rounded-2xl bg-muted/50 px-4 py-2">
          <span className="text-4xl font-extrabold text-muted-foreground">₹</span>
          <input
            aria-label={t.amount} inputMode="decimal" value={amt} placeholder="0" disabled={removed}
            onChange={(ev) => setAmt(ev.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1').slice(0, 9))}
            className="num min-w-0 flex-1 bg-transparent text-5xl font-extrabold outline-none placeholder:text-muted-foreground/40"
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <Seg on={dir === 'credit'} className="bg-credit text-white" onClick={() => setDir('credit')}>{t.credit}</Seg>
          <Seg on={dir === 'payment'} className="bg-payment text-white" onClick={() => setDir('payment')}>{t.payment}</Seg>
        </div>

        <div>
          <div className="mb-1 text-sm font-semibold text-muted-foreground">{t.customer}</div>
          <input
            value={q} onChange={(ev) => setQ(ev.target.value)} placeholder={t.findOrNew} aria-label={t.customer} disabled={removed}
            className="h-12 w-full rounded-xl border bg-background px-3 text-base"
          />
          <div className="mt-2 flex max-h-36 flex-wrap gap-2 overflow-y-auto">
            {newName && <Chip on onClick={() => {}}><Plus className="size-4" />{newName}</Chip>}
            {qn && !exact && qn !== newName && (
              <Chip on={false} dashed onClick={() => { setNewName(qn); setCid(null); setQ('') }}><Plus className="size-4" />{t.newCustomer}: {qn}</Chip>
            )}
            {customers.map((c) => (
              <Chip key={c.cid} on={!newName && cid === c.cid} onClick={() => { setCid(c.cid); setNewName('') }}>{c.name}</Chip>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1 text-sm font-semibold text-muted-foreground">{t.day}</div>
          <div className="grid grid-cols-3 gap-2">
            <Seg on={day === today()} className="bg-primary text-primary-foreground" onClick={() => setDay(today())}>{t.today}</Seg>
            <Seg on={day === shiftDay(-1)} className="bg-primary text-primary-foreground" onClick={() => setDay(shiftDay(-1))}>{t.yesterday}</Seg>
            <input
              type="date" aria-label={t.pickDate} value={day} max={e?.promise ? undefined : today()}
              onChange={(ev) => ev.target.value && setDay(ev.target.value)}
              className={cn('h-12 min-w-0 rounded-xl px-1 text-center text-sm font-semibold ring-1 ring-black/10', day !== today() && day !== shiftDay(-1) && 'bg-primary text-primary-foreground')}
            />
          </div>
        </div>

        <button
          onClick={() => void save()} disabled={!valid || busy || removed || (!!e && !dirty)}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-lg font-bold text-primary-foreground disabled:opacity-40"
        >
          <Check className="size-5" />{e ? t.saveChanges : t.saveEntry}{valid && <span className="num">· {rs(paise)}</span>}
        </button>
        {e && <div className="-mt-2 text-center text-xs text-muted-foreground">{t.keepsHistory}</div>}

        {e && !removed && (
          <button onClick={() => void remove()} className={cn('flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-base font-semibold ring-1', armed ? 'bg-destructive text-white ring-destructive' : 'text-destructive ring-destructive/40')}>
            <Trash2 className="size-5" />{armed ? t.tapAgain : t.removeEntry}
          </button>
        )}

        {e && (e.source || e.amended) && (
          <div className="space-y-1 rounded-2xl bg-muted/50 p-3 text-sm">
            {e.source && (
              <div>
                <div className="text-xs font-semibold text-muted-foreground">{t.spoken}</div>
                <div className="text-base">{typedByHand ? `(${t.typedByHand})` : `“${e.source.transcript}”`}</div>
              </div>
            )}
            {e.amended && <div className="flex items-center gap-1.5 text-muted-foreground"><Pencil className="size-3.5 shrink-0" />{t.editedNote} · {t.keepsHistory}</div>}
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
