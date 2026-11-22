import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { CASH_CATEGORIES, type CashCategory } from '../../shared/ledger.js'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { KhataStore } from '@/lib/contracts'
import { cn } from '@/lib/utils'
import { rs } from './format'
import { Chip, Segmented, inputCls } from './kit'
import { type UiStrings, screenLang } from './strings'
import { fx } from './strings-features'

/** 'new' writes a galla row; an eid edits that cash row's amount, or removes it. */
export type CashMode = 'new' | { eid: string } | null

/** The galla form: in or out, amount, category, a note. Customer payments are never written here. */
export function CashSheet({ store, mode, t, onClose, onChanged }: {
  store: KhataStore; mode: CashMode; t: UiStrings; onClose: () => void; onChanged: () => void
}) {
  if (!mode) return null
  return <CashForm key={mode === 'new' ? 'new' : mode.eid} store={store} mode={mode} t={t} onClose={onClose} onChanged={onChanged} />
}

function CashForm({ store, mode, t, onClose, onChanged }: {
  store: KhataStore; mode: NonNullable<CashMode>; t: UiStrings; onClose: () => void; onChanged: () => void
}) {
  const f = fx(screenLang(store.settings))
  const row = mode === 'new' ? undefined : store.state.cash.get(mode.eid)
  const [dir, setDir] = useState<'in' | 'out'>(row?.dir ?? 'out')
  const [amt, setAmt] = useState(row ? String(row.paise / 100) : '')
  const [cat, setCat] = useState<CashCategory>(row?.category ?? 'other')
  const [note, setNote] = useState(row?.note ?? '')
  const [busy, setBusy] = useState(false)
  const paise = Math.round(parseFloat(amt) * 100)
  const ok = Number.isFinite(paise) && paise > 0 && (!row || paise !== row.paise)

  const save = async () => {
    if (!ok) return
    setBusy(true)
    try {
      if (row) await store.amendEntry(row.eid, { paise })
      else await store.addCash({ paise, dir, category: cat, ...(note.trim() ? { note: note.trim() } : {}) })
      onChanged()
      onClose()
    } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!row) return
    await store.voidEntry(row.eid, 'tap remove')
    onChanged()
    onClose()
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent closeLabel={t.dismiss}>
        <SheetHeader className="pb-0"><SheetTitle className="pr-10 text-2xl">{row ? f.cat[row.category] : f.addCash}</SheetTitle></SheetHeader>
        <div className="space-y-4 px-4 pb-6">
          {!row && (
            <Segmented<'in' | 'out'> label={f.galla} value={dir} onChange={setDir}
              items={[{ value: 'out', label: f.cashOut }, { value: 'in', label: f.cashIn }]} />
          )}
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">{t.amount}</span>
            <div className="flex h-14 items-center gap-2 rounded-xl bg-card px-4 shadow-1 ring-1 ring-foreground/8 focus-within:ring-2 focus-within:ring-primary">
              <span className="text-2xl font-semibold text-muted-foreground">₹</span>
              <input aria-label={t.amount} inputMode="decimal" value={amt} placeholder="0" autoFocus={!row}
                onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ''))}
                className={cn('num min-w-0 flex-1 bg-transparent text-3xl font-semibold outline-none', (row?.dir ?? dir) === 'in' ? 'text-payment' : 'text-foreground')} />
            </div>
            {row && <span className="mt-1 block text-xs text-muted-foreground">{row.dir === 'in' ? f.cashIn : f.cashOut} · {rs(row.paise)}</span>}
          </label>
          {!row && (
            <>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={f.galla}>
                {CASH_CATEGORIES.map((c) => (
                  <Chip key={c} on={cat === c} onClick={() => setCat(c)}>{f.cat[c]}</Chip>
                ))}
              </div>
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={60} aria-label={t.note} placeholder={t.note} className={cn(inputCls, 'h-12')} />
            </>
          )}
          <button onClick={() => void save()} disabled={!ok || busy}
            className="h-14 w-full rounded-2xl bg-primary text-lg font-semibold text-primary-foreground shadow-2 active:scale-[.98] disabled:opacity-40">
            {row ? t.saveChanges : f.addCash}
          </button>
          {row && (
            <button onClick={() => void remove()} className="flex min-h-11 items-center gap-2 text-sm text-destructive">
              <Trash2 className="size-4" />{t.removeCash}
            </button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
