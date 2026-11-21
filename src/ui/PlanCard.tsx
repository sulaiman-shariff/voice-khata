import { CalendarClock, TriangleAlert } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { dayFromOffset, planStatus, type LedgerState } from '../../shared/ledger.js'
import type { Lang } from '../../shared/replies.js'
import { cn } from '@/lib/utils'
import { rs } from './format'
import { AnimatedAmount, ConfirmDialog } from './kit'
import { dayWord, fx } from './strings-features'

/**
 * A customer's instalment plan: one segment per instalment (filled as payments cover them, oldest
 * first), the next one due, and a warning when an instalment's day has passed unpaid.
 * Renders nothing when the customer has no plan.
 */
export function PlanCard({ state, cid, onCancel, lang, today = dayFromOffset(0), className }: {
  state: LedgerState; cid: string; onCancel: () => void; lang?: Lang | null; today?: string; className?: string
}) {
  const f = fx(lang)
  const [asking, setAsking] = useState(false)
  const ps = planStatus(state, cid, today)
  if (!ps) return null
  const { plan, schedule } = ps
  // what each instalment has received (payments fill the oldest first)
  let left = ps.paidPaise
  const filled = schedule.map((p) => { const c = Math.min(left, p.paise); left -= c; return c / p.paise })

  return (
    <section aria-label={f.plan} className={cn('rounded-2xl bg-card p-4 shadow-1 ring-1 ring-foreground/6', className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            <CalendarClock className="size-4" aria-hidden />{f.plan}
          </h3>
          <div className="num mt-0.5 text-base">
            <span className="font-semibold">{rs(plan.totalPaise)}</span>
            <span className="text-muted-foreground"> · {plan.parts} {f.parts} · {f.every} {plan.everyDays} {f.days}</span>
          </div>
        </div>
        <button type="button" onClick={() => setAsking(true)} className="h-9 shrink-0 rounded-xl px-2.5 text-sm font-medium text-muted-foreground ring-1 ring-foreground/10 hover:bg-muted active:scale-[.98]">
          {f.cancelPlan}
        </button>
      </div>

      <div
        className="mt-3 flex gap-1" role="progressbar" aria-label={f.plan}
        aria-valuemin={0} aria-valuemax={plan.parts} aria-valuenow={ps.paidParts} aria-valuetext={`${ps.paidParts}/${plan.parts}`}
      >
        {schedule.map((p, i) => {
          const late = p.day < today && filled[i] < 1
          return (
            <div key={i} title={`${dayWord(p.day, f)} · ${rs(p.paise)}`}
              className={cn('relative h-3 flex-1 overflow-hidden rounded-full', late ? 'bg-credit/15 ring-1 ring-credit/40' : 'bg-foreground/8')}>
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full bg-payment"
                initial={{ width: 0 }} animate={{ width: `${filled[i] * 100}%` }}
                transition={{ type: 'spring', stiffness: 200, damping: 28, delay: i * 0.05 }}
              />
            </div>
          )
        })}
      </div>

      <div className="mt-2 flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">
          <AnimatedAmount paise={ps.paidPaise} className="font-semibold text-payment" /> {f.paidOf}
          <span className="num"> · {ps.paidParts}/{plan.parts}</span>
        </span>
        {ps.next && (
          <span className="num text-right">
            <span className="text-muted-foreground">{f.nextPart}: </span>
            <span className="font-semibold">{rs(ps.next.paise)}</span>
            <span className="text-muted-foreground"> · {dayWord(ps.next.day, f)}</span>
          </span>
        )}
      </div>

      {ps.done && <div className="mt-2 text-sm font-semibold text-payment">{f.planDone}</div>}
      {ps.behind && (
        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
          className="mt-3 flex items-center gap-2 rounded-xl bg-warn/10 px-3 py-2 text-sm text-warn ring-1 ring-warn/20" role="status">
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          <span className="num font-semibold">{rs(ps.behindPaise)} {f.behind}</span>
        </motion.div>
      )}

      <ConfirmDialog
        open={asking} onOpenChange={setAsking} title={f.cancelPlanQ} body={f.cancelPlanBody}
        confirmLabel={f.cancelPlan} cancelLabel={f.keep} destructive onConfirm={onCancel}
      />
    </section>
  )
}
