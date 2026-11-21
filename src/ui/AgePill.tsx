import { ageBucket, type AgeBucket } from '../../shared/ledger.js'
import type { Lang } from '../../shared/replies.js'
import { cn } from '@/lib/utils'
import { fx } from './strings-features'

/** Calm for fresh dues, brass after a week, terracotta after a month. Never green: that is money. */
const tone: Record<AgeBucket, string> = {
  '0-7': 'bg-foreground/6 text-muted-foreground',
  '8-30': 'bg-warn/12 text-warn',
  '30+': 'bg-credit/12 text-credit',
}

/**
 * How old a customer's oldest unpaid credit is ("12 din"), coloured by bucket (0-7, 8-30, 30+).
 * Feed it `ageing(state).rows[i].days`.
 */
export function AgePill({ days, lang, className }: { days: number; lang?: Lang | null; className?: string }) {
  const f = fx(lang)
  const b = ageBucket(days)
  return (
    <span
      className={cn('num inline-flex h-6 shrink-0 items-center rounded-full px-2 text-xs font-semibold', tone[b], className)}
      title={b}
    >
      {days} {f.days}
    </span>
  )
}
