import { Link2, Pencil } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import type { Entry, LedgerState } from '../../shared/ledger.js'
import type { Lang } from '../../shared/replies.js'
import { itemsOf } from '@/lib/statement'
import { cn } from '@/lib/utils'
import { entryDay, relDay, rs, shiftDay, time } from './format'
import { OverdueChip } from './OverdueChip'
import { EntryRow } from './parts'
import type { UiStrings } from './strings'

const live = (e: Entry) => !e.voided && !e.promise

/** "Overdue · 3 din" and the items said ("doodh, bread"), under an entry. Nothing when there is neither. */
export function EntryChips({ e, state, lang, className }: { e: Entry; state?: LedgerState; lang?: Lang | null; className?: string }) {
  const items = itemsOf(e.note)
  const overdue = state && !e.voided ? <OverdueChip state={state} eid={e.eid} lang={lang} /> : null
  if (!items.length && !overdue) return null
  return (
    <div className={cn('mt-1 flex flex-wrap items-center gap-1', className)}>
      {overdue}
      {items.slice(0, 6).map((it, i) => (
        <span key={`${it}-${i}`} className="inline-flex h-6 max-w-40 items-center truncate rounded-full bg-muted px-2 text-xs font-medium text-muted-foreground">{it}</span>
      ))}
    </div>
  )
}
const byTsDesc = (a: Entry, b: Entry) => b.ts - a.ts

function group(entries: Entry[]) {
  const m = new Map<string, Entry[]>()
  for (const e of entries) {
    const k = entryDay(e)
    m.set(k, [...(m.get(k) ?? []), e])
  }
  return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]))
}

function totals(es: Entry[]) {
  let credit = 0
  let paid = 0
  for (const e of es) if (live(e)) { if (e.direction === 'credit') credit += e.paise; else paid += e.paise }
  return { credit, paid }
}

function DayHeader({ day, t, es, className }: { day: string; t: UiStrings; es: Entry[]; className?: string }) {
  const s = totals(es)
  return (
    <div className={cn('sticky top-0 z-10 -mx-4 flex items-baseline justify-between gap-2 bg-background/95 px-4 py-1.5 backdrop-blur', className)}>
      <span className="text-base font-bold">{relDay(day, t)}</span>
      <span className="num flex gap-2.5 text-sm font-semibold">
        {s.credit > 0 && <span className="text-credit">{rs(s.credit)}</span>}
        {s.paid > 0 && <span className="text-payment">−{rs(s.paid)}</span>}
      </span>
    </div>
  )
}

/** Day-grouped history: last 14 days, "older" reveals 14 more; removed entries hidden unless asked. */
export function DayFeed({ entries, t, name, fresh, onEntry, state, lang }: {
  entries: Entry[]; t: UiStrings; name: (cid: string) => string; fresh: string | null; onEntry: (eid: string) => void
  state?: LedgerState; lang?: Lang | null
}) {
  const [days, setDays] = useState(14)
  const [showRemoved, setShowRemoved] = useState(false)
  const cutoff = shiftDay(-(days - 1))
  const { groups, older, removed } = useMemo(() => {
    const visible = entries.filter((e) => entryDay(e) >= cutoff)
    return {
      groups: group(visible.filter((e) => showRemoved || !e.voided).sort(byTsDesc)),
      older: entries.length - visible.length,
      removed: visible.filter((e) => e.voided).length,
    }
  }, [entries, cutoff, showRemoved])
  return (
    <div>
      {groups.map(([day, es]) => (
        <motion.section key={day} layout="position" className="pb-2">
          <DayHeader day={day} t={t} es={es} />
          <div className="space-y-2 pt-1">
            <AnimatePresence initial={false} mode="popLayout">
              {es.map((e) => (
                <motion.div
                  key={e.eid} layout
                  // a new entry rises from the dock below; edits and removals settle in place
                  initial={{ opacity: 0, y: e.eid === fresh ? 48 : 8, scale: e.eid === fresh ? 0.96 : 1 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.16 } }}
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                >
                  <EntryRow e={e} name={name(e.cid)} t={t} fresh={e.eid === fresh} onClick={() => onEntry(e.eid)} chips={<EntryChips e={e} state={state} lang={lang} />} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </motion.section>
      ))}
      {older > 0 && (
        <button onClick={() => setDays((d) => d + 14)} className="mt-2 h-12 w-full rounded-2xl text-base font-semibold text-primary ring-1 ring-primary/25 active:scale-[.98]">
          {t.older} · {older}
        </button>
      )}
      {removed > 0 && (
        <button onClick={() => setShowRemoved((v) => !v)} className="mx-auto mt-3 block min-h-11 px-4 text-sm text-muted-foreground underline underline-offset-4">
          {showRemoved ? t.hideRemoved : t.showRemoved} · {removed}
        </button>
      )}
    </div>
  )
}

const sign = (n: number) => (n < 0 ? '−' : '') + rs(n)

/** Passbook: date, time, credit, payment, running balance. Newest first. */
export function Passbook({ entries, t, onEntry, onConfirm, state, lang }: {
  entries: Entry[]; t: UiStrings; onEntry: (eid: string) => void; onConfirm: (eid: string) => void
  state?: LedgerState; lang?: Lang | null
}) {
  const [showRemoved, setShowRemoved] = useState(false)
  const { running, groups, removed } = useMemo(() => {
    const asc = [...entries].filter(live).sort((a, b) => a.day.localeCompare(b.day) || a.ts - b.ts)
    const running = new Map<string, number>()
    let b = 0
    for (const e of asc) { b += e.direction === 'credit' ? e.paise : -e.paise; running.set(e.eid, b) }
    return {
      running,
      groups: group(entries.filter((e) => showRemoved || !e.voided).sort(byTsDesc)),
      removed: entries.filter((e) => e.voided).length,
    }
  }, [entries, showRemoved])
  const col = 'grid grid-cols-[3.9rem_1fr_1fr_1fr] items-center gap-x-1'
  return (
    <div>
      <div className={cn(col, 'border-b pb-1 text-xs font-semibold text-muted-foreground')}>
        <span />
        <span className="text-right">{t.credit}</span>
        <span className="text-right">{t.payment}</span>
        <span className="text-right">{t.balance}</span>
      </div>
      {groups.map(([day, es]) => (
        <section key={day}>
          <div className="sticky top-0 z-10 -mx-4 bg-muted/95 px-4 py-1.5 text-sm font-bold backdrop-blur">{relDay(day, t)}</div>
          {es.map((e) => {
            const bal = running.get(e.eid)
            return (
              <motion.div key={e.eid} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="border-b border-foreground/5">
                <button onClick={() => onEntry(e.eid)} className={cn(col, 'min-h-14 w-full py-2 text-left active:bg-muted/60', e.voided && 'opacity-50')}>
                  <span className="num text-sm leading-tight text-muted-foreground">
                    {e.promise ? t.promise : time(e.ts)}
                    {e.amended && !e.voided && <span className="mt-0.5 flex items-center gap-0.5 text-[11px]"><Pencil className="size-2.5" />{t.edited}</span>}
                    {e.voided && <span className="block text-[11px]">{t.removed}</span>}
                  </span>
                  {(['credit', 'payment'] as const).map((d) => (
                    <span key={d} className={cn('num text-right text-lg font-bold', d === 'credit' ? 'text-credit' : 'text-payment', e.promise && 'font-medium text-warn', e.voided && 'line-through')}>
                      {e.direction === d ? rs(e.paise) : ''}
                    </span>
                  ))}
                  <span className={cn('num text-right text-base font-semibold', bal !== undefined && bal > 0 ? 'text-credit' : 'text-payment')}>
                    {bal === undefined ? '' : sign(bal)}
                  </span>
                </button>
                <EntryChips e={e} state={state} lang={lang} className="mt-0 mb-2" />
                {live(e) && e.status === 'unconfirmed' && (
                  <button onClick={() => onConfirm(e.eid)} className="mb-1 flex min-h-11 items-center gap-1 text-sm text-primary">
                    <Link2 className="size-4" />{t.confirmLink}
                  </button>
                )}
              </motion.div>
            )
          })}
        </section>
      ))}
      {removed > 0 && (
        <button onClick={() => setShowRemoved((v) => !v)} className="mx-auto mt-2 block min-h-11 px-4 text-sm text-muted-foreground underline underline-offset-4">
          {showRemoved ? t.hideRemoved : t.showRemoved} · {removed}
        </button>
      )}
    </div>
  )
}
