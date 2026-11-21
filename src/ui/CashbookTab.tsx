import { CircleEllipsis, House, Link2, type LucideIcon, Package, Plus, ReceiptText, Truck, UserRound, Users, Wallet } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { cashbook, displayName, isSupplier, type CashCategory, type CashRow, type LedgerState } from '../../shared/ledger.js'
import type { Lang } from '../../shared/replies.js'
import { cn } from '@/lib/utils'
import { rs, time } from './format'
import { EmptyState, StatTile } from './kit'
import { fx } from './strings-features'

const CASH_ICONS: Record<CashCategory, LucideIcon> = {
  stock: Package, bills: ReceiptText, rent: House, wages: Users, personal: UserRound, other: CircleEllipsis,
}

const signed = (p: number) => `${p < 0 ? '−' : ''}${rs(p)}`

/**
 * The galla for one day: cash in, cash out, what is left, and bank (Razorpay / QR) apart.
 * Rows carry a category icon; customer and supplier payments appear as derived rows ("from khata"),
 * computed from the entries and never stored twice.
 */
export function CashbookTab({ state, day, onAdd, onRow, lang }: {
  state: LedgerState
  /** YYYY-MM-DD */
  day: string
  /** opens the add-cash form */
  onAdd?: () => void
  /** a row tapped: a cash eid (amend / void) or, for a derived row, the entry's eid */
  onRow?: (row: CashRow) => void
  lang?: Lang | null
}) {
  const f = fx(lang)
  const cb = cashbook(state, day)

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <StatTile label={f.cashIn} paise={cb.inPaise} tone="payment" />
        <StatTile label={f.cashOut} paise={cb.outPaise} />
        <StatTile label={`${f.galla} · ${f.net}`} paise={cb.netPaise} format={signed} emphasis />
        <StatTile label={f.bank} paise={cb.bankInPaise} />
      </div>

      {onAdd && (
        <button type="button" onClick={onAdd}
          className="flex h-12 items-center justify-center gap-2 rounded-xl bg-card font-semibold text-primary shadow-1 ring-1 ring-primary/20 active:scale-[.98]">
          <Plus className="size-5" />{f.addCash}
        </button>
      )}

      {!cb.rows.length ? (
        <EmptyState icon={Wallet} title={f.cashEmpty} hint={f.cashEmptyHint} className="rounded-2xl border border-dashed border-foreground/15 bg-card/50" />
      ) : (
        <ul className="flex flex-col gap-2">
          <AnimatePresence initial={false} mode="popLayout">
            {cb.rows.map((r) => {
              const supplier = r.cid ? isSupplier(state, r.cid) : false
              const Icon = r.derived ? (supplier ? Truck : UserRound) : CASH_ICONS[r.category ?? 'other']
              const title = r.derived && r.cid ? displayName(state, r.cid) : f.cat[r.category ?? 'other']
              return (
                <motion.li
                  key={r.eid} layout
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                >
                  <button
                    type="button" onClick={onRow ? () => onRow(r) : undefined} disabled={!onRow}
                    className={cn(
                      'flex min-h-14 w-full items-center gap-3 rounded-2xl px-4 py-2.5 text-left active:opacity-70 disabled:active:opacity-100',
                      r.derived ? 'bg-card/50 ring-1 ring-foreground/10 [border-style:dashed]' : 'bg-card shadow-1 ring-1 ring-foreground/6',
                    )}
                  >
                    <span className={cn('grid size-10 shrink-0 place-items-center rounded-full', r.derived ? 'bg-foreground/5 text-muted-foreground' : supplier ? 'bg-supplier/10 text-supplier' : 'bg-gold/15 text-foreground/75')}>
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-semibold">{title}</span>
                      <span className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
                        <span className="num shrink-0">{time(r.ts)}</span>
                        {r.derived && <><span aria-hidden>·</span><Link2 className="size-3.5 shrink-0" aria-hidden /><span className="shrink-0">{f.fromKhata}</span></>}
                        {r.note && <><span aria-hidden>·</span><span className="truncate">{r.note}</span></>}
                      </span>
                    </span>
                    <span className={cn('num shrink-0 text-lg font-semibold', r.dir === 'in' ? 'text-payment' : 'text-foreground')}>
                      {r.dir === 'in' ? '+' : '−'}{rs(r.paise)}
                    </span>
                  </button>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ul>
      )}
    </div>
  )
}
