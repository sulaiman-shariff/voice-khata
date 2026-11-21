import { Check, ChevronDown } from 'lucide-react'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export interface DropdownOption<T extends string> {
  value: T
  label: string
  hint?: string
  /** small colour chips shown before the label (theme picker) */
  swatch?: string[]
}

/**
 * A small listbox dropdown: opens below its button, closes on pick, outside tap or Escape.
 * `align` keeps the panel inside the screen (right for a top-right button).
 */
export function Dropdown<T extends string>({ value, options, onChange, label, align = 'left', button, className, panelClassName, compact }: {
  value: T
  options: DropdownOption<T>[]
  onChange: (v: T) => void
  label: string
  align?: 'left' | 'right'
  /** custom button content; default: the current option's label */
  button?: ReactNode
  className?: string
  panelClassName?: string
  /** a small top-bar button: no chevron, tight padding */
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const id = useId()
  const current = options.find((o) => o.value === value)
  const btn = useRef<HTMLButtonElement>(null)
  const items = useRef<(HTMLButtonElement | null)[]>([])
  const close = (refocus = false) => { setOpen(false); if (refocus) btn.current?.focus() }

  // opening moves focus to the current option; arrows / Home / End move between options
  useEffect(() => {
    if (!open) return
    const i = Math.max(0, options.findIndex((o) => o.value === value))
    items.current[i]?.focus()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const onListKey = (e: React.KeyboardEvent) => {
    const i = items.current.findIndex((el) => el === document.activeElement)
    const n = options.length
    const next = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null
    if (next === null) return
    e.preventDefault()
    items.current[(next + n) % n]?.focus()
  }

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(true) }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc) }
  }, [open])

  return (
    <div ref={root} className={cn('relative', className)}>
      <button
        ref={btn} type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) { e.preventDefault(); setOpen(true) } }}
        className={cn('flex h-11 w-full items-center justify-between gap-2 rounded-xl bg-card text-sm font-semibold shadow-1 ring-1 ring-foreground/10 active:scale-[.98]', compact ? 'px-2.5' : 'px-3')}
      >
        {button ?? (
          <span className="flex min-w-0 items-center gap-2">
            {current?.swatch && <Swatch colors={current.swatch} />}
            <span className="truncate">{current?.label ?? label}</span>
          </span>
        )}
        {!compact && <ChevronDown className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')} />}
      </button>
      {open && (
        <ul
          id={id} role="listbox" aria-label={label} onKeyDown={onListKey}
          className={cn(
            'absolute top-full z-50 mt-1.5 max-h-[60dvh] min-w-full origin-top overflow-y-auto rounded-xl bg-popover p-1 text-popover-foreground shadow-3 ring-1 ring-foreground/10 animate-in fade-in zoom-in-95 duration-150',
            align === 'right' ? 'right-0' : 'left-0', panelClassName,
          )}
        >
          {options.map((o, i) => (
            <li key={o.value} role="option" aria-selected={o.value === value}>
              <button
                ref={(el) => { items.current[i] = el }}
                type="button" onClick={() => { onChange(o.value); close(true) }}
                className={cn('flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted', o.value === value && 'bg-muted font-semibold')}
              >
                {o.swatch && <Swatch colors={o.swatch} />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{o.label}</span>
                  {o.hint && <span className="block truncate text-xs text-muted-foreground">{o.hint}</span>}
                </span>
                {o.value === value && <Check className="size-4 shrink-0 text-primary" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function Swatch({ colors }: { colors: string[] }) {
  return (
    <span className="flex shrink-0 -space-x-1.5" aria-hidden>
      {colors.map((c, i) => <span key={i} className="size-4 rounded-full ring-2 ring-card" style={{ background: c }} />)}
    </span>
  )
}
