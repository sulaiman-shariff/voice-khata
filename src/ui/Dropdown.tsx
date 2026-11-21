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

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc) }
  }, [open])

  return (
    <div ref={root} className={cn('relative', className)}>
      <button
        type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={cn('flex h-11 w-full items-center justify-between gap-2 rounded-lg bg-card text-sm font-semibold ring-1 ring-foreground/15 active:scale-[.98]', compact ? 'px-2.5' : 'px-3')}
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
          id={id} role="listbox" aria-label={label}
          className={cn(
            'absolute top-full z-50 mt-1.5 max-h-[60dvh] min-w-full overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-xl ring-1 ring-foreground/10',
            align === 'right' ? 'right-0' : 'left-0', panelClassName,
          )}
        >
          {options.map((o) => (
            <li key={o.value} role="option" aria-selected={o.value === value}>
              <button
                type="button" onClick={() => { onChange(o.value); setOpen(false) }}
                className={cn('flex min-h-11 w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm hover:bg-muted', o.value === value && 'bg-muted font-semibold')}
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
