import { Handshake, MessageCircle } from 'lucide-react'
import { motion } from 'motion/react'
import type { Lang } from '../../shared/replies.js'
import { cn } from '@/lib/utils'
import { rs } from './format'
import { Avatar, NameTag } from './kit'
import { dayWord, fx } from './strings-features'

/**
 * A customer said on WhatsApp "kal de dunga": "Ramesh: 'kal de dunga' — vaada jodein?"
 * Nothing is written until the shopkeeper taps Add (onAccept records the promise).
 */
export function PromiseSuggestionCard({ notice, name, onAccept, onDismiss, lang, className }: {
  notice: { cid: string; day: string; paise?: number; text?: string }
  /** the customer's label (displayName) */
  name: string
  onAccept: () => void
  onDismiss: () => void
  lang?: Lang | null
  className?: string
}) {
  const f = fx(lang)
  return (
    <motion.div
      layout initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      role="alertdialog" aria-label={`${name}: ${f.promiseQ}`}
      className={cn('rounded-2xl bg-card p-4 shadow-3 ring-1 ring-foreground/8', className)}
    >
      <div className="flex items-start gap-3">
        <Avatar name={name} id={notice.cid} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
            <MessageCircle className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{f.onWhatsApp}</span>
          </div>
          <p className="mt-0.5 text-lg leading-snug">
            <NameTag label={name} className="inline-flex font-semibold" />
            {notice.text && <span className="text-foreground/80"> “{notice.text}”</span>}
            <span className="text-muted-foreground"> — {f.promiseQ}</span>
          </p>
          <div className="num mt-1.5 flex flex-wrap items-center gap-1.5 text-sm">
            <span className="inline-flex h-6 items-center gap-1 rounded-full bg-primary/8 px-2 font-semibold text-primary">
              <Handshake className="size-3.5" aria-hidden />{dayWord(notice.day, f)}
            </span>
            {notice.paise ? <span className="font-semibold">{rs(notice.paise)}</span> : null}
          </div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={onDismiss} className="h-12 rounded-xl bg-secondary font-semibold text-secondary-foreground ring-1 ring-foreground/10 active:scale-[.98]">{f.notNow}</button>
        <button type="button" onClick={onAccept} className="h-12 rounded-xl bg-primary font-semibold text-primary-foreground shadow-2 active:scale-[.98]">{f.add}</button>
      </div>
    </motion.div>
  )
}
