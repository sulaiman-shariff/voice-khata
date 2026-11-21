import { BellRing, Check, CheckCheck, PartyPopper } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { collectList, displayName, type CollectReason, type CollectRow, type LedgerState } from '../../shared/ledger.js'
import type { Lang } from '../../shared/replies.js'
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { expectPayments } from '@/lib/sync'
import { cn } from '@/lib/utils'
import { rs } from './format'
import { AgePill } from './AgePill'
import { AnimatedAmount, Avatar, EmptyState, NameTag } from './kit'
import { dayWord, fx, type FeatureStrings } from './strings-features'

export type CollectStatus = 'sent' | 'delivered' | 'paid'

/** how long a paid row stays ticked before it leaves the list */
const PAID_LINGER_MS = 1400

function ReasonChip({ r, row, f }: { r: CollectReason; row: CollectRow; f: FeatureStrings }) {
  if (r === 'old') return row.days !== undefined ? <AgePill days={row.days} /> : null
  const label = r === 'due' ? `${f.rDue}${row.dueDay ? ` · ${dayWord(row.dueDay, f)}` : ''}` : f.rPromise
  return (
    <span className={cn('inline-flex h-6 shrink-0 items-center rounded-full px-2 text-xs font-semibold', r === 'due' ? 'bg-warn/12 text-warn' : 'bg-primary/8 text-primary')}>
      {label}
    </span>
  )
}

function StatusMark({ s, f }: { s?: CollectStatus; f: FeatureStrings }) {
  if (s === 'paid') {
    return (
      <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 20 }}
        className="grid size-7 place-items-center rounded-full bg-payment text-payment-foreground" aria-label={f.paid}>
        <Check className="size-4" strokeWidth={3} />
      </motion.span>
    )
  }
  if (s === 'delivered') return <CheckCheck className="size-4 text-primary" aria-label={f.delivered} />
  if (s === 'sent') return <Check className="size-4 text-muted-foreground" aria-label={f.sent} />
  return null
}

/**
 * The collect-today queue: due dates reached, promises for today, dues older than 30 days.
 * "Sabko yaad dilao" hands every unpaid row's cid to onRemindAll (the caller keeps it to opted-in
 * adults). Rows show sent / delivered / paid; a paid row ticks, then animates out.
 */
export function CollectSheet({ open, onOpenChange, state, onRemindAll, onOpenCustomer, statuses, lang }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  state: LedgerState
  onRemindAll: (cids: string[]) => void
  onOpenCustomer: (cid: string) => void
  statuses: Record<string, CollectStatus>
  lang?: Lang | null
}) {
  const f = fx(lang)
  const live = collectList(state)
  // a paid customer drops out of collectList at once, but should tick first: keep the rows last
  // seen (derived during render, React's "adjust state on prop change" pattern)
  const sig = live.map((r) => `${r.cid}:${r.paise}`).join('|')
  const liveIds = new Set(live.map((r) => r.cid))
  const [prev, setPrev] = useState<{ sig: string; rows: CollectRow[] }>({ sig, rows: live })
  const lingering = prev.rows.filter((r) => !liveIds.has(r.cid) && statuses[r.cid] === 'paid')
  if (prev.sig !== sig) setPrev({ sig, rows: [...live, ...lingering] })
  const [gone, setGone] = useState<Set<string>>(() => new Set())
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (open) setGone(new Set())
  }

  useEffect(() => {
    const timers = Object.entries(statuses)
      .filter(([cid, s]) => s === 'paid' && !gone.has(cid))
      .map(([cid]) => setTimeout(() => setGone((g) => new Set(g).add(cid)), PAID_LINGER_MS))
    return () => timers.forEach(clearTimeout)
  }, [statuses, gone])

  // paid rows keep their place while they tick, then leave
  const order = new Map(prev.rows.map((r, i) => [r.cid, i]))
  const rows = [...live, ...lingering]
    .filter((r) => !gone.has(r.cid))
    .sort((a, b) => (order.get(a.cid) ?? 1e9) - (order.get(b.cid) ?? 1e9))
  const unpaid = rows.filter((r) => statuses[r.cid] !== 'paid')
  const total = unpaid.reduce((t, r) => t + r.paise, 0)

  const remindAll = () => {
    onRemindAll(unpaid.filter((r) => !statuses[r.cid]).map((r) => r.cid))
    expectPayments()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" closeLabel={f.notNow}>
        <SheetHeader>
          <SheetTitle>{f.collectTitle}</SheetTitle>
          {rows.length > 0 && (
            <div className="flex items-baseline gap-2 text-sm text-muted-foreground">
              <span>{f.toCollect}</span>
              <AnimatedAmount paise={total} className="text-2xl font-bold text-credit" />
              <span className="num">· {unpaid.length}</span>
            </div>
          )}
        </SheetHeader>

        <div className="flex flex-col gap-2 px-4">
          {!rows.length && <EmptyState icon={PartyPopper} title={f.collectNone} hint={f.collectNoneHint} />}
          <AnimatePresence initial={false} mode="popLayout">
            {rows.map((r) => {
              const st = statuses[r.cid]
              const label = displayName(state, r.cid)
              return (
                <motion.div
                  key={r.cid} layout
                  initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 60, height: 0, marginTop: 0, transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] } }}
                  transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                >
                  <button
                    type="button" onClick={() => onOpenCustomer(r.cid)}
                    className={cn(
                      'flex min-h-16 w-full items-center gap-3 rounded-2xl px-4 py-3 text-left shadow-1 ring-1 transition-colors active:opacity-70',
                      st === 'paid' ? 'bg-payment/8 ring-payment/25' : 'bg-card ring-foreground/6',
                    )}
                  >
                    <Avatar name={label} id={r.cid} />
                    <span className="min-w-0 flex-1">
                      <NameTag label={label} className={cn('text-lg leading-snug font-semibold', st === 'paid' && 'line-through decoration-payment/60')} />
                      <span className="mt-1 flex flex-wrap gap-1">
                        {r.reasons.map((x) => <ReasonChip key={x} r={x} row={r} f={f} />)}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <StatusMark s={st} f={f} />
                      <span className={cn('num text-xl font-semibold', st === 'paid' ? 'text-payment' : 'text-credit')}>{rs(r.paise)}</span>
                    </span>
                  </button>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>

        {unpaid.length > 0 && (
          <SheetFooter>
            <button
              type="button" onClick={remindAll} disabled={!unpaid.some((r) => !statuses[r.cid])}
              className="flex h-14 items-center justify-center gap-2 rounded-xl bg-primary text-lg font-semibold text-primary-foreground shadow-2 active:scale-[.98] disabled:opacity-50"
            >
              <BellRing className="size-5" />{f.remindAll}
            </button>
            <p className="text-center text-xs text-muted-foreground">{f.remindAllNote}</p>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  )
}
