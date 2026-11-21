import type { LucideIcon } from 'lucide-react'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { Logo } from '@/ui/Logo'
import { Skeleton } from '@/ui/kit'

/** The customer-facing pages (confirm link, pay link): the KhataBhai mark over one calm card. */
export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-10">
        <div className="mb-6 flex items-center gap-2.5">
          <Logo size={32} />
          <span className="font-semibold tracking-tight">KhataBhai</span>
        </div>
        <motion.main initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} className="flex flex-1 flex-col">
          {children}
        </motion.main>
        <div className="gold-rule mt-8" />
      </div>
    </div>
  )
}

export function PageLoading({ label }: { label: string }) {
  return (
    <div className="space-y-4" aria-busy="true">
      <span className="sr-only" role="status">{label}</span>
      <Skeleton className="mx-auto h-6 w-40" />
      <Skeleton className="mx-auto h-14 w-56" />
      <Skeleton className="mx-auto h-5 w-28" />
      <Skeleton className="mt-8 h-14 w-full rounded-2xl" />
      <Skeleton className="h-14 w-full rounded-2xl" />
    </div>
  )
}

const ICON_TONE = {
  muted: 'bg-muted text-muted-foreground',
  error: 'bg-destructive/10 text-destructive',
  ok: 'bg-primary text-primary-foreground shadow-2',
} as const

export function PageMessage({ icon: Icon, title, body, tone = 'muted', action }: {
  icon: LucideIcon; title: string; body?: string; tone?: keyof typeof ICON_TONE; action?: ReactNode
}) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className="flex flex-1 flex-col items-center justify-center text-center">
      <motion.span
        initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 22 }}
        className={`grid size-16 place-items-center rounded-full ${ICON_TONE[tone]}`}
      >
        <Icon className="size-8" />
      </motion.span>
      <h1 className="mt-4 text-xl font-semibold tracking-tight text-balance">{title}</h1>
      {body && <p className="mt-1.5 max-w-xs text-muted-foreground">{body}</p>}
      {action && <div className="mt-6 w-full">{action}</div>}
    </div>
  )
}
