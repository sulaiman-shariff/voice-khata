import { BellRing, CalendarClock, MessageCircle, PartyPopper, Search, SearchX, Truck, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { type LedgerState, ageing, balance, dues, promises, supplierDues } from '../../../shared/ledger.js'
import type { Lang } from '../../../shared/replies.js'
import { cn } from '@/lib/utils'
import { AgePill } from '../AgePill'
import { ago, dayOfTs, relDay, rs, today } from '../format'
import { Avatar, EmptyState, ListRow, NameTag, Segmented } from '../kit'
import type { UiStrings } from '../strings'
import { fx } from '../strings-features'

export type DuesSort = 'amount' | 'age' | 'due'
export type Party = 'customer' | 'supplier'

const rowMotion = {
  layout: true,
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, scale: 0.96, transition: { duration: 0.16 } },
  transition: { type: 'spring', stiffness: 500, damping: 40 },
} as const

/**
 * Who owes what. Customers: search, sort by amount / age / due date, an age pill and a WhatsApp nudge
 * per row, promises below; `minAge` narrows to dues at least that old ("30 din se purane").
 * Suppliers: what the shop owes ("dena hai"), in the supplier colour.
 */
export function DuesTab({ t, lang, state, name, q, setQ, sort, setSort, party, setParty, minAge, setMinAge, onCustomer, onRemind }: {
  t: UiStrings; lang?: Lang | null; state: LedgerState; name: (cid: string) => string
  q: string; setQ: (v: string) => void; sort: DuesSort; setSort: (s: DuesSort) => void
  party: Party; setParty: (p: Party) => void; minAge: number | null; setMinAge: (n: number | null) => void
  onCustomer: (cid: string) => void; onRemind: (cid: string) => void
}) {
  const f = fx(lang)
  const due = dues(state)
  const owed = supplierDues(state)
  const proms = promises(state)
  const age = new Map(ageing(state).rows.map((r) => [r.cid, r]))
  const hasSuppliers = [...state.customers.values()].some((c) => c.kind === 'supplier')

  const needle = q.trim().toLowerCase()
  const matches = (cid: string) => {
    const c = state.customers.get(cid)
    return !needle || !!c && (c.name.toLowerCase().includes(needle) || c.aliases.some((a) => a.toLowerCase().includes(needle)) || !!c.tag?.toLowerCase().includes(needle))
  }
  const NONE = '9999-99-99'
  const shown = due
    .filter((d) => matches(d.cid) && (minAge == null || (age.get(d.cid)?.days ?? 0) >= minAge))
    .sort((a, b) => {
      const x = age.get(a.cid)
      const y = age.get(b.cid)
      if (sort === 'age') return (y?.days ?? 0) - (x?.days ?? 0) || b.paise - a.paise
      if (sort === 'due') return (x?.dueDay ?? NONE).localeCompare(y?.dueDay ?? NONE) || b.paise - a.paise
      return b.paise - a.paise
    })
  const suppliersShown = owed.filter((d) => matches(d.cid))

  const lastDay = new Map<string, string>()
  for (const e of state.entries.values()) if (!e.voided) { const d = e.promise ? dayOfTs(e.ts) : e.day; if (d > (lastDay.get(e.cid) ?? '')) lastDay.set(e.cid, d) }

  const partyToggle = (hasSuppliers || party === 'supplier') && (
    <Segmented<Party> size="sm" label={t.dues} value={party} onChange={setParty}
      items={[{ value: 'customer', label: t.customers, count: due.length }, { value: 'supplier', label: t.suppliers, count: owed.length }]} />
  )
  const searchBox = (
    <label className="flex h-11 min-w-0 items-center gap-2 rounded-xl bg-card px-3 shadow-1 ring-1 ring-foreground/8 focus-within:ring-2 focus-within:ring-primary">
      <Search className="size-4 shrink-0 text-muted-foreground" />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.search} aria-label={t.search} className="min-w-0 flex-1 bg-transparent text-base outline-none focus-visible:outline-none" />
    </label>
  )

  if (party === 'supplier') {
    return (
      <>
        {partyToggle}
        {owed.length > 0 && searchBox}
        {!owed.length && <EmptyState icon={Truck} title={t.noSuppliers} />}
        <AnimatePresence initial={false} mode="popLayout">
          {suppliersShown.map((d) => (
            <motion.div key={d.cid} {...rowMotion}>
              <ListRow
                onClick={() => onCustomer(d.cid)}
                leading={<Avatar name={name(d.cid)} id={d.cid} />}
                title={name(d.cid)}
                subtitle={lastDay.get(d.cid) ? ago(lastDay.get(d.cid)!, t) : undefined}
                trailing={
                  <span className="shrink-0 text-right">
                    <span className="num block text-xl font-semibold text-supplier">{rs(d.paise)}</span>
                    <span className="block text-xs font-medium text-supplier/80">{t.denaHai}</span>
                  </span>
                }
              />
            </motion.div>
          ))}
        </AnimatePresence>
        {q && owed.length > 0 && suppliersShown.length === 0 && <EmptyState icon={SearchX} title={t.noMatch} />}
      </>
    )
  }

  if (!due.length && !proms.length) return <>{partyToggle}<EmptyState icon={PartyPopper} title={t.allClear} hint={t.allClearHint} /></>

  return (
    <>
      {partyToggle}
      {searchBox}
      <Segmented size="sm" label={t.sortBy} className="rounded-xl" value={sort} onChange={setSort}
        items={[{ value: 'amount', label: t.sortBig }, { value: 'age', label: t.sortAge }, { value: 'due', label: t.sortDue }]} />
      {minAge != null && (
        <button onClick={() => setMinAge(null)} aria-label={`${t.clearFilter}: ${minAge} ${f.days} ${t.olderThan}`}
          className="flex h-9 items-center gap-1.5 rounded-full bg-credit/10 px-3 text-sm font-semibold text-credit ring-1 ring-credit/20 active:scale-95">
          <span className="num">{minAge} {f.days}</span> {t.olderThan}<X className="size-4" />
        </button>
      )}
      <AnimatePresence initial={false} mode="popLayout">
        {shown.map((d) => {
          const a = age.get(d.cid)
          return (
            <motion.div key={d.cid} {...rowMotion}>
              <ListRow
                onClick={() => onCustomer(d.cid)}
                leading={<Avatar name={name(d.cid)} id={d.cid} />}
                title={name(d.cid)}
                subtitle={
                  <span className="flex min-w-0 items-center gap-1.5">
                    {a && <AgePill days={a.days} lang={lang} />}
                    {state.plans.has(d.cid) && <span role="img" aria-label={f.plan} title={f.plan} className="inline-grid size-6 shrink-0 place-items-center rounded-full bg-primary/8 text-primary"><CalendarClock className="size-3.5" aria-hidden /></span>}
                    {a?.pastDue && <span className="shrink-0 text-xs font-semibold text-credit">{f.overdue}</span>}
                    {!a?.pastDue && lastDay.get(d.cid) && <span className="truncate">{ago(lastDay.get(d.cid)!, t)}</span>}
                  </span>
                }
                trailing={
                  <span className="flex shrink-0 items-center gap-2">
                    {state.customers.get(d.cid)?.remindersOptIn && <BellRing className="size-4 text-muted-foreground" aria-label={t.reminders} />}
                    <span className="num text-xl font-semibold text-credit">{rs(d.paise)}</span>
                  </span>
                }
                action={
                  <button aria-label={`${t.remindNow}: ${name(d.cid)}`} onClick={() => onRemind(d.cid)}
                    className="grid size-11 shrink-0 place-items-center rounded-xl text-primary hover:bg-primary/8 active:scale-95">
                    <MessageCircle className="size-5" />
                  </button>
                }
              />
            </motion.div>
          )
        })}
      </AnimatePresence>
      {(q || minAge != null) && shown.length === 0 && <EmptyState icon={SearchX} title={t.noMatch} />}
      {proms.length > 0 && minAge == null && <div className="pt-3 text-xs font-bold tracking-widest text-muted-foreground uppercase">{t.promise}</div>}
      <AnimatePresence initial={false} mode="popLayout">
        {minAge == null && proms.map((p) => (
          <motion.div key={p.eid} {...rowMotion}>
            <ListRow
              tone="warn" onClick={() => onCustomer(p.cid)}
              title={<NameTag label={name(p.cid)} />}
              subtitle={<span className={cn(p.day < today() ? 'font-semibold text-destructive' : 'text-warn')}>{t.due} {relDay(p.day, t)}</span>}
              trailing={
                <span className="shrink-0 text-right">
                  <span className="num block text-xl font-bold text-warn">{rs(p.paise)}</span>
                  <span className="num block text-xs text-muted-foreground">/ {rs(balance(state, p.cid))}</span>
                </span>
              }
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </>
  )
}
