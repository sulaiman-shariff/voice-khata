/**
 * KhataBhai's shared primitives. One place for the segmented control, inputs, chips, rows, empty
 * and loading states, the confirm dialog and the animated money figure, so every screen looks and
 * moves the same way. Radii: chips/inputs rounded-xl, cards rounded-2xl, sheets rounded-t-3xl.
 */
import { AlertDialog } from '@base-ui/react/alert-dialog'
import { cva, type VariantProps } from 'class-variance-authority'
import type { LucideIcon } from 'lucide-react'
import { motion, useReducedMotion, useSpring, useTransform } from 'motion/react'
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from 'react'
import { cn } from '@/lib/utils'
import { initials, rs } from './format'

/* ── Segmented ─────────────────────────────────────────────────────────────── */

export interface SegmentedItem<T extends string> {
  value: T
  label: ReactNode
  icon?: LucideIcon
  /** a small count after the label (e.g. dues) */
  count?: number
}

const segSize = { md: 'h-12 text-base', sm: 'h-11 text-sm' } as const

/**
 * A real tablist: arrow keys / Home / End move the selection, the active tab is the only tab stop,
 * and a pill slides between items. Add a tab by adding an item.
 */
export function Segmented<T extends string>({ items, value, onChange, label, size = 'md', panelId, className }: {
  items: SegmentedItem<T>[]
  value: T
  onChange: (v: T) => void
  /** accessible name of the tablist */
  label: string
  size?: keyof typeof segSize
  /** id of the panel the tabs control (aria-controls) */
  panelId?: string
  className?: string
}) {
  const id = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const onKey = (e: KeyboardEvent) => {
    const i = items.findIndex((x) => x.value === value)
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : null
    if (next === null) return
    e.preventDefault()
    const j = (next + items.length) % items.length
    onChange(items[j].value)
    refs.current[j]?.focus()
  }
  return (
    <div
      role="tablist" aria-label={label} onKeyDown={onKey}
      className={cn('grid gap-1 rounded-2xl bg-muted p-1 font-semibold', className)}
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((it, i) => {
        const on = it.value === value
        const Icon = it.icon
        return (
          <button
            key={it.value} ref={(el) => { refs.current[i] = el }}
            type="button" role="tab" id={`${id}-${it.value}`} aria-selected={on} aria-controls={panelId} tabIndex={on ? 0 : -1}
            onClick={() => onChange(it.value)}
            className={cn('relative flex min-w-0 items-center justify-center gap-1.5 rounded-xl px-2 transition-colors', segSize[size], on ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}
          >
            {on && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-xl bg-card shadow-1" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
            <span className="relative flex min-w-0 items-center gap-1.5">
              {Icon && <Icon className="size-4 shrink-0" />}
              <span className="truncate">{it.label}</span>
              {it.count !== undefined && <span className={cn('num rounded-full px-1.5 text-xs leading-5', on ? 'bg-primary/10 text-primary' : 'bg-foreground/5')}>{it.count}</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/* ── Toggle / Chip ─────────────────────────────────────────────────────────── */

const toggle = cva('flex min-w-0 items-center justify-center gap-1.5 rounded-xl px-3 font-semibold transition-[background-color,color,box-shadow] active:scale-[.98]', {
  variants: {
    tone: { primary: '', credit: '', payment: '' },
    size: { md: 'h-12 text-base', sm: 'h-11 text-sm' },
    on: { true: 'shadow-1', false: 'bg-card text-foreground ring-1 ring-foreground/12 hover:bg-muted/60' },
  },
  compoundVariants: [
    { tone: 'primary', on: true, className: 'bg-primary text-primary-foreground' },
    { tone: 'credit', on: true, className: 'bg-credit text-credit-foreground' },
    { tone: 'payment', on: true, className: 'bg-payment text-payment-foreground' },
  ],
  defaultVariants: { tone: 'primary', size: 'md', on: false },
})

/** A pressable on/off choice (credit vs paid, today vs yesterday). */
export function Toggle({ on, tone, size, onClick, children, className }: {
  on: boolean; onClick: () => void; children: ReactNode; className?: string
} & Omit<VariantProps<typeof toggle>, 'on'>) {
  return <button type="button" aria-pressed={on} onClick={onClick} className={cn(toggle({ tone, size, on }), className)}>{children}</button>
}

/** A small rounded choice: a customer to pick, a suggestion. */
export function Chip({ on = false, dashed, onClick, children, className }: { on?: boolean; dashed?: boolean; onClick?: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button" aria-pressed={onClick ? on : undefined} onClick={onClick}
      className={cn(
        'flex min-h-11 max-w-full items-center gap-1 rounded-xl px-3.5 text-base font-medium ring-1 transition-colors active:scale-[.98]',
        on ? 'bg-primary text-primary-foreground ring-primary' : 'bg-card ring-foreground/12 hover:bg-muted/60',
        dashed && !on && 'text-primary ring-primary/40 [border-style:dashed]',
        className,
      )}
    >
      <span className="flex min-w-0 items-center truncate">{children}</span>
    </button>
  )
}

/* ── Inputs ────────────────────────────────────────────────────────────────── */

export const inputCls = 'h-12 w-full rounded-xl bg-card px-3 text-base ring-1 ring-foreground/12 outline-none placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-primary focus-visible:outline-none aria-invalid:ring-destructive'

/** An Indian mobile number: +91 prefix, numeric keypad. */
export function PhoneInput({ value, onChange, onBlur, label, placeholder = '98765 43210', invalid, size = 'md', className }: {
  value: string; onChange: (v: string) => void; onBlur?: () => void; label: string; placeholder?: string; invalid?: boolean; size?: 'md' | 'sm'; className?: string
}) {
  return (
    <span className={cn(
      'flex items-center overflow-hidden rounded-xl bg-background ring-1 ring-foreground/12 focus-within:ring-2 focus-within:ring-primary',
      size === 'md' ? 'h-12' : 'h-11', invalid && 'ring-destructive', className,
    )}>
      <span className="num border-r border-border px-3 text-sm text-muted-foreground">+91</span>
      <input
        inputMode="tel" autoComplete="tel" value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur}
        aria-label={label} aria-invalid={invalid || undefined} placeholder={placeholder}
        className="num h-full min-w-0 flex-1 bg-transparent px-3 text-base outline-none focus-visible:outline-none"
      />
    </span>
  )
}

/* ── Money ─────────────────────────────────────────────────────────────────── */

/** A money figure that counts to its new value with a spring (instantly under reduced motion). */
export function AnimatedAmount({ paise, format = rs, className, from = 0 }: { paise: number; format?: (p: number) => string; className?: string; from?: number }) {
  const reduce = useReducedMotion()
  const target = useRef(paise)
  const spring = useSpring(reduce ? paise : from, { stiffness: 140, damping: 24, mass: 0.7 })
  // whole rupees while moving, the exact figure once it lands
  const text = useTransform(spring, (v) => format(Math.abs(v - target.current) < 1 ? target.current : Math.round(v / 100) * 100))
  useEffect(() => { target.current = paise; if (reduce) spring.jump(paise); else spring.set(paise) }, [paise, reduce, spring])
  return <motion.span className={cn('num', className)}>{text}</motion.span>
}

/** A headline number tile (today's credit, paid, total dues). */
export function StatTile({ label, paise, tone = 'neutral', format, emphasis, className }: {
  label: string; paise: number; tone?: 'credit' | 'payment' | 'supplier' | 'neutral'; format?: (p: number) => string; emphasis?: boolean; className?: string
}) {
  return (
    <div className={cn('min-w-0 rounded-2xl bg-card px-3 py-2.5 shadow-1 ring-1 ring-foreground/6', emphasis && 'bg-primary text-primary-foreground ring-0 shadow-2', className)}>
      <div className={cn('truncate text-xs font-medium', emphasis ? 'text-primary-foreground/70' : 'text-muted-foreground')}>{label}</div>
      <AnimatedAmount paise={paise} format={format}
        className={cn('block truncate text-2xl leading-tight font-bold', !emphasis && (tone === 'credit' ? 'text-credit' : tone === 'payment' ? 'text-payment' : tone === 'supplier' ? 'text-supplier' : 'text-foreground'))} />
    </div>
  )
}

/* ── Rows ──────────────────────────────────────────────────────────────────── */

/** A stable, calm hue per customer id, so the same person always wears the same colour. */
function avatarHue(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return [28, 62, 150, 190, 222, 262, 310, 350][h % 8]
}

export function Avatar({ name, id, className }: { name: string; /** customer id: picks the colour */ id?: string; className?: string }) {
  const hue = id ? avatarHue(id) : null
  return (
    <span
      aria-hidden className={cn('grid size-10 shrink-0 place-items-center rounded-full text-base font-semibold', hue === null && 'bg-primary/8 text-primary', className)}
      style={hue === null ? undefined : { background: `oklch(0.93 0.035 ${hue})`, color: `oklch(0.42 0.09 ${hue})` }}
    >
      {initials(name)}
    </span>
  )
}

/** "Ramesh · doodhwala" → the name, then the nickname as a small chip (how twins are told apart). */
export function NameTag({ label, className }: { label: string; className?: string }) {
  const i = label.indexOf(' · ')
  if (i < 0) return <span className={cn('block truncate', className)}>{label}</span>
  return (
    <span className={cn('flex min-w-0 items-center gap-1.5', className)}>
      <span className="truncate">{label.slice(0, i)}</span>
      <span className="shrink-0 truncate rounded-full bg-gold/15 px-2 py-0.5 text-xs font-semibold text-foreground/75">{label.slice(i + 3)}</span>
    </span>
  )
}

/** One tappable card row: leading avatar/icon, title + subtitle, trailing figure, optional side action. */
export function ListRow({ leading, title, subtitle, trailing, onClick, action, tone = 'default', className }: {
  leading?: ReactNode; title: ReactNode; subtitle?: ReactNode; trailing?: ReactNode; onClick?: () => void
  /** a separate button at the end (e.g. WhatsApp) */
  action?: ReactNode
  tone?: 'default' | 'warn'
  className?: string
}) {
  return (
    <div className={cn(
      'flex min-h-16 w-full items-center gap-1 rounded-2xl pr-1.5',
      tone === 'warn' ? 'bg-warn/8 ring-1 ring-warn/25' : 'bg-card shadow-1 ring-1 ring-foreground/6',
      !action && 'pr-0', className,
    )}>
      <button type="button" onClick={onClick} className="flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-2xl py-3 pr-3 pl-4 text-left active:opacity-70">
        {leading}
        <span className="min-w-0 flex-1">
          <span className="block min-w-0 truncate text-lg leading-snug font-semibold">{typeof title === 'string' ? <NameTag label={title} /> : title}</span>
          {subtitle && <span className="block truncate text-sm text-muted-foreground">{subtitle}</span>}
        </span>
        {trailing}
      </button>
      {action}
    </div>
  )
}

/* ── Empty / loading ───────────────────────────────────────────────────────── */

export function EmptyState({ icon: Icon, title, hint, action, className }: { icon?: LucideIcon; title: ReactNode; hint?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className={cn('flex flex-col items-center rounded-2xl px-5 py-8 text-center', className)}
    >
      {Icon && <span className="mb-3 grid size-14 place-items-center rounded-full bg-primary/8 text-primary"><Icon className="size-7" /></span>}
      <div className="text-lg font-semibold">{title}</div>
      {hint && <div className="mt-1 max-w-xs text-sm text-muted-foreground">{hint}</div>}
      {action && <div className="mt-5 w-full">{action}</div>}
    </motion.div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton rounded-xl', className)} />
}

/* ── Confirm dialog ────────────────────────────────────────────────────────── */

/** A translated yes/no question in place of the browser's confirm(). */
export function ConfirmDialog({ open, onOpenChange, title, body, confirmLabel, cancelLabel, destructive, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; body?: ReactNode
  confirmLabel: string; cancelLabel: string; destructive?: boolean; onConfirm: () => void
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-[60] bg-overlay transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-[60] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-popover p-5 text-popover-foreground shadow-3 outline-none transition-[opacity,scale] duration-200 ease-[var(--ease-spring)] data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
          <AlertDialog.Title className="text-lg font-semibold tracking-tight">{title}</AlertDialog.Title>
          {body && <AlertDialog.Description className="mt-1.5 text-sm text-muted-foreground">{body}</AlertDialog.Description>}
          <div className="mt-5 grid grid-cols-2 gap-2">
            <AlertDialog.Close className="h-12 rounded-xl bg-secondary font-semibold text-secondary-foreground ring-1 ring-foreground/10 active:scale-[.98]">{cancelLabel}</AlertDialog.Close>
            <button
              type="button" onClick={() => { onConfirm(); onOpenChange(false) }}
              className={cn('h-12 rounded-xl font-semibold active:scale-[.98]', destructive ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground')}
            >
              {confirmLabel}
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
