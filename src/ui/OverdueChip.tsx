import { AlarmClock } from 'lucide-react'
import { daysBetween, dayFromOffset, isPastDue, type LedgerState } from '../../shared/ledger.js'
import type { Lang } from '../../shared/replies.js'
import { cn } from '@/lib/utils'
import { fx } from './strings-features'

/**
 * "Overdue · 3 din" on an entry whose due date has passed and is still (partly) unpaid.
 * Renders nothing otherwise, so it can sit on every entry row.
 */
export function OverdueChip({ state, eid, lang, today = dayFromOffset(0), className }: {
  state: LedgerState; eid: string; lang?: Lang | null; today?: string; className?: string
}) {
  const e = state.entries.get(eid)
  if (!e?.due || !isPastDue(state, eid, today)) return null
  const f = fx(lang)
  const late = daysBetween(e.due, today)
  return (
    <span className={cn('inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-credit/12 px-2 text-xs font-semibold text-credit', className)}>
      <AlarmClock className="size-3.5" aria-hidden />
      {f.overdue}
      {late > 0 && <span className="num opacity-80">· {late} {f.days}</span>}
    </span>
  )
}
