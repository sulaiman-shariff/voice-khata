import { Keyboard } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { PendingCard } from '../parts'
import { type UiStrings, statusLabel, voiceLook } from '../strings'
import type { Voice } from '../useVoice'
import { VoiceOrb } from './VoiceOrb'

const cardSpring = { type: 'spring', stiffness: 420, damping: 34, mass: 0.9 } as const
const cardMotion = {
  initial: { opacity: 0, y: 32, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 24, scale: 0.97, transition: { duration: 0.18 } },
  transition: cardSpring,
}

/**
 * The bottom panel floating over the list: the open question or a ready card, the network
 * banner, the live transcript, the orb and its status line. Reports its height so the list
 * above can pad itself.
 */
export function VoiceDock({ v, t, handsFree, ready, onTyping, onHeight, onTag }: {
  v: Voice; t: UiStrings; handsFree: boolean
  /** save a nickname on the phone (the nickname card's other twins) */
  onTag: (cid: string, tag: string) => void
  /** a tool's one-tap card (hidden while a question is open) */
  ready: ReactNode
  onTyping: () => void
  onHeight: (h: number) => void
}) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => onHeight(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [onHeight])

  const look = voiceLook(v)
  const offline = v.on && (v.net === 'offline' || v.status === 'offline')
  const words = v.heard ? v.heard.split(/\s+/) : []
  return (
    // solid behind the cards, captions and orb (the list scrolls under them), with only a thin fade above
    <footer ref={ref} className="pointer-events-none fixed inset-x-0 bottom-0 z-10 mx-auto max-w-md bg-background px-4 pt-3 pb-[max(1rem,calc(env(safe-area-inset-bottom)+0.75rem))]">
      <div aria-hidden className="absolute inset-x-0 -top-8 h-8 bg-gradient-to-t from-background to-transparent" />
      <div className="pointer-events-auto relative space-y-3">
        <AnimatePresence mode="popLayout" initial={false}>
          {v.pending ? (
            <motion.div key="pending" layout {...cardMotion}>
              <PendingCard p={v.pending} t={t} onAnswer={v.answer} onTag={onTag} />
            </motion.div>
          ) : ready ? (
            <motion.div key="ready" layout {...cardMotion}>{ready}</motion.div>
          ) : null}
        </AnimatePresence>
        <AnimatePresence initial={false}>
          {v.on && (v.net !== 'good' || v.status === 'offline') && (
            <motion.div
              key="net" role="status" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className={cn('overflow-hidden rounded-xl px-3 py-1.5 text-center text-sm font-medium', offline ? 'bg-destructive/10 text-destructive' : 'bg-warn/12 text-warn')}
            >
              {offline ? t.netOffline : t.netSlow}
            </motion.div>
          )}
        </AnimatePresence>
        {v.on && (v.heard || v.said) && (
          <div className="space-y-1 text-center">
            {v.heard && (
              <motion.div
                layout
                animate={{ opacity: v.heardIgnored ? 0.6 : v.said ? 0.7 : 1, scale: v.said ? 0.94 : 1 }}
                className="flex flex-wrap items-center justify-center gap-1.5 text-sm text-muted-foreground"
              >
                <span className="line-clamp-2 min-w-0">
                  “{words.map((w, i) => (
                    <motion.span key={i} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>{i ? ' ' : ''}{w}</motion.span>
                  ))}”
                </span>
                {v.heardIgnored && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs">{t.notEntry}</span>}
                {v.heardIgnored && <button onClick={v.saveAnyway} className="h-11 shrink-0 rounded-full px-3 text-xs font-semibold text-primary ring-1 ring-primary/30">{t.saveAnyway}</button>}
              </motion.div>
            )}
            <AnimatePresence>
              {v.said && (
                <motion.div key="said" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-base font-medium text-balance">{v.said}</motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
        <div className="flex flex-col items-center">
          <div className="flex items-center justify-center gap-5">
            <span className="size-14" aria-hidden />
            <VoiceOrb
              look={look} levelSource={v.levelSource} heardPulse={v.heardPulse} handsFree={handsFree} t={t}
              onTap={v.micTap} onHoldStart={v.holdStart} onHoldEnd={v.holdEnd}
            />
            <button aria-label={t.typeInstead} onClick={onTyping} className="grid size-14 place-items-center rounded-full bg-card text-foreground shadow-2 ring-1 ring-foreground/8 active:scale-95"><Keyboard className="size-6" /></button>
          </div>
          <div className="mt-0.5 flex min-h-11 items-center gap-3 text-sm text-muted-foreground">
            <span role="status" aria-live="polite">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span key={look} className="inline-block" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}>
                  {statusLabel(t, look, handsFree)}
                </motion.span>
              </AnimatePresence>
            </span>
            {/* push-to-talk's button is hold-only, so it cannot also be the off switch; hands-free needs no extra control */}
            {v.on && !handsFree && <button onClick={v.stop} className="h-11 rounded-full px-3 text-sm ring-1 ring-foreground/10">{t.micStop}</button>}
          </div>
        </div>
      </div>
    </footer>
  )
}
