import { UserPlus, Wallet } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import { daySummary, dayFromOffset, sevenDayTotals, type LedgerState } from '../../shared/ledger.js'
import type { Lang } from '../../shared/replies.js'
import { cn } from '@/lib/utils'
import { rs, rsShort } from './format'
import { AnimatedAmount } from './kit'
import { dayWord, fx, type FeatureStrings } from './strings-features'

type Day = { day: string; creditPaise: number; paymentPaise: number }

/**
 * Seven days of credit vs payment as paired bars (credit left, payment right: position carries the
 * series as well as colour). Inline SVG, a legend, a hover readout and a full aria-label.
 */
function Sparkline({ days, f }: { days: Day[]; f: FeatureStrings }) {
  const reduce = useReducedMotion()
  const [hover, setHover] = useState<number | null>(null)
  const H = 56
  const slot = 40
  const bar = 12
  const gap = 2
  const max = Math.max(1, ...days.flatMap((d) => [d.creditPaise, d.paymentPaise]))
  const h = (p: number) => (p > 0 ? Math.max(3, (p / max) * H) : 0)
  const label = (d: Day) => `${dayWord(d.day, f)}: ${f.creditWord} ${rs(d.creditPaise)}, ${f.paymentWord} ${rs(d.paymentPaise)}`
  const shown = hover ?? days.length - 1
  const W = slot * days.length

  return (
    <figure className="mt-3">
      <figcaption className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-semibold tracking-wide uppercase">{f.last7}</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1"><span aria-hidden className="size-2 rounded-[2px] bg-credit" />{f.creditWord}</span>
          <span className="flex items-center gap-1"><span aria-hidden className="size-2 rounded-[2px] bg-payment" />{f.paymentWord}</span>
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H + 16}`} className="block h-[72px] w-full overflow-visible" role="img"
        aria-label={`${f.last7}. ${days.map(label).join('. ')}`} onMouseLeave={() => setHover(null)}
      >
        <line x1={0} x2={W} y1={H + 0.5} y2={H + 0.5} className="stroke-foreground/10" strokeWidth={1} />
        {days.map((d, i) => {
          const x = i * slot + (slot - (bar * 2 + gap)) / 2
          const isToday = i === days.length - 1
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)}>
              <rect x={i * slot} y={0} width={slot} height={H + 16} fill="transparent" />
              {[{ p: d.creditPaise, c: 'fill-credit', dx: 0 }, { p: d.paymentPaise, c: 'fill-payment', dx: bar + gap }].map((b) => (
                <motion.rect
                  key={b.c} x={x + b.dx} width={bar} rx={3} y={H - h(b.p)} height={h(b.p)}
                  className={cn(b.c, hover !== null && hover !== i && 'opacity-35')}
                  style={{ transformBox: 'fill-box', transformOrigin: 'bottom' }}
                  initial={reduce ? false : { scaleY: 0 }} animate={{ scaleY: 1 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 26, delay: reduce ? 0 : i * 0.04 }}
                />
              ))}
              <text x={i * slot + slot / 2} y={H + 13} textAnchor="middle" className={cn('text-[10px]', isToday ? 'fill-foreground font-semibold' : 'fill-muted-foreground')}>
                {new Date(`${d.day}T00:00:00`).toLocaleDateString(f.loc, { weekday: 'narrow' })}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="num mt-1 min-h-5 text-xs text-muted-foreground" aria-hidden>
        {days[shown] && <>{dayWord(days[shown].day, f)} · {f.creditWord} <span className="font-semibold text-foreground">{rsShort(days[shown].creditPaise)}</span> · {f.paymentWord} <span className="font-semibold text-foreground">{rsShort(days[shown].paymentPaise)}</span></>}
      </div>
    </figure>
  )
}

/** "Aaj ka hisaab": credit given and money in (counting up), the galla, new customers, and 7 days of bars. */
export function TodaySummaryCard({ state, lang, day = dayFromOffset(0), className }: {
  state: LedgerState; lang?: Lang | null; day?: string; className?: string
}) {
  const f = fx(lang)
  const s = daySummary(state, day)
  const galla = (s.cashIn ?? 0) - (s.cashOut ?? 0)
  const week = sevenDayTotals(state, day)

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      aria-label={f.todaySummary}
      className={cn('rounded-2xl bg-card p-4 shadow-2 ring-1 ring-foreground/6', className)}
    >
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">{f.todaySummary}</h2>
        <span className="text-xs text-muted-foreground">{new Date(`${day}T00:00:00`).toLocaleDateString(f.loc, { day: 'numeric', month: 'short' })}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{f.creditGiven}</div>
          <AnimatedAmount paise={s.creditPaise} className="block truncate text-3xl leading-tight font-bold text-credit" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{f.collected}</div>
          <AnimatedAmount paise={s.paymentPaise} className="block truncate text-3xl leading-tight font-bold text-payment" />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <span className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-gold/12 px-2.5">
          <Wallet className="size-4 text-foreground/70" aria-hidden />
          <span className="text-muted-foreground">{f.galla}</span>
          <AnimatedAmount paise={galla} format={(p) => `${p < 0 ? '−' : ''}${rs(p)}`} className="font-semibold" />
        </span>
        {(s.bankIn ?? 0) > 0 && (
          <span className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-foreground/5 px-2.5">
            <span className="text-muted-foreground">{f.bank}</span><span className="num font-semibold">{rs(s.bankIn!)}</span>
          </span>
        )}
        {(s.newCustomers ?? 0) > 0 && (
          <span className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-primary/8 px-2.5 text-primary">
            <UserPlus className="size-4" aria-hidden /><span className="num font-semibold">+{s.newCustomers}</span><span>{f.newCustomers}</span>
          </span>
        )}
      </div>
      <Sparkline days={week} f={f} />
    </motion.section>
  )
}
