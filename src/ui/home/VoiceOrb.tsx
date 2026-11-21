import { Mic, MicOff, Moon } from 'lucide-react'
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from 'motion/react'
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import type { UiStrings, VoiceLook } from '../strings'

/** Press-and-hold longer than this is a hold (wake while held); shorter is a tap. */
const HOLD_MS = 350

/**
 * The voice orb: ONE control, a distinct look per state.
 * off: outline only · offline: grey, slashed mic · connecting/thinking: orbiting dots ·
 * asleep: slow breathing glow + moon · listening: a live level ring (a motion value, no re-renders) ·
 * speaking: equaliser bars · every "heard you" tick: a one-shot pulse.
 * Tap: wake / cut the reply short / sleep (the caller decides). Hold: awake while held.
 */
export function VoiceOrb({ look, levelSource, heardPulse, handsFree, t, onTap, onHoldStart, onHoldEnd }: {
  look: VoiceLook
  levelSource: Set<(v: number) => void>
  heardPulse: number
  handsFree: boolean
  t: UiStrings
  onTap: () => void
  onHoldStart: () => void
  onHoldEnd: () => void
}) {
  // the ~30 Hz mic level drives a motion value: the ring moves without re-rendering React
  const level = useMotionValue(0)
  const smooth = useSpring(level, { stiffness: 420, damping: 30 })
  const ring = useTransform(smooth, [0, 0.25], [1, 1.45], { clamp: true })
  const ringOpacity = useTransform(smooth, [0, 0.25], [0.18, 0.4], { clamp: true })
  useEffect(() => {
    const f = (v: number) => level.set(v)
    levelSource.add(f)
    return () => { levelSource.delete(f) }
  }, [levelSource, level])

  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 'down' = pressed, not yet a hold; 'hold' = hold started; null = not pressed */
  const press = useRef<'down' | 'hold' | null>(null)
  const down = () => {
    if (press.current) return
    if (!handsFree) { press.current = 'hold'; onHoldStart(); return } // push-to-talk: every press is a hold
    press.current = 'down'
    holdTimer.current = setTimeout(() => { holdTimer.current = null; press.current = 'hold'; onHoldStart() }, HOLD_MS)
  }
  const up = () => {
    const p = press.current
    press.current = null
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null }
    if (p === 'hold') onHoldEnd()
    else if (p === 'down') onTap()
  }
  useEffect(() => () => { if (holdTimer.current) clearTimeout(holdTimer.current) }, [])

  const filled = look === 'listening' || look === 'thinking' || look === 'speaking'
  const busy = look === 'thinking' || look === 'speaking'
  const label = look === 'offline' ? t.reconnect : busy ? t.interrupt : look === 'listening' ? t.micStop : t.micStart
  return (
    <div className="relative grid size-28 place-items-center">
      {/* halo layers */}
      {look === 'asleep' && <span aria-hidden className="breathe absolute inset-1 rounded-full bg-primary/20" />}
      {look === 'listening' && (
        <motion.span aria-hidden className="absolute inset-2 rounded-full bg-primary" style={{ scale: ring, opacity: ringOpacity }} />
      )}
      {(look === 'thinking' || look === 'connecting') && (
        <span aria-hidden className="orbit absolute -inset-0.5">
          <span className={cn('absolute top-0 left-1/2 size-2.5 -translate-x-1/2 rounded-full', look === 'thinking' ? 'bg-primary' : 'bg-muted-foreground/60')} />
          <span className={cn('absolute bottom-[14%] left-[8%] size-2 rounded-full', look === 'thinking' ? 'bg-primary/60' : 'bg-muted-foreground/40')} />
          <span className={cn('absolute right-[8%] bottom-[14%] size-1.5 rounded-full', look === 'thinking' ? 'bg-primary/35' : 'bg-muted-foreground/25')} />
        </span>
      )}
      <AnimatePresence>
        {heardPulse > 0 && (
          <motion.span
            key={heardPulse} aria-hidden className="absolute inset-2 rounded-full ring-4 ring-primary/50"
            initial={{ scale: 1, opacity: 0.9 }} animate={{ scale: 1.5, opacity: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          />
        )}
      </AnimatePresence>
      <motion.button
        type="button"
        aria-label={label}
        // one toggle: pressed = awake
        aria-pressed={look === 'listening' || look === 'thinking'}
        whileTap={{ scale: 0.94 }}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); if (handsFree) onTap(); else down() } }}
        onKeyUp={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !handsFree) up() }}
        onPointerDown={(e) => { e.preventDefault(); down() }}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={up}
        onContextMenu={(e) => e.preventDefault()}
        className={cn(
          'relative grid size-24 touch-none select-none place-items-center rounded-full transition-[background-color,color,box-shadow] duration-300',
          filled && 'bg-primary text-primary-foreground shadow-3',
          look === 'off' && 'bg-card text-primary shadow-2 ring-2 ring-primary/35',
          look === 'asleep' && 'bg-card text-primary shadow-2 ring-2 ring-primary/25',
          look === 'connecting' && 'bg-card text-primary/70 shadow-2 ring-2 ring-primary/20',
          look === 'offline' && 'bg-muted text-muted-foreground shadow-1 ring-1 ring-foreground/15',
        )}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={look === 'speaking' ? 'eq' : look === 'offline' ? 'off' : 'mic'}
            initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className="grid place-items-center"
          >
            {look === 'speaking' ? (
              <span aria-hidden className="eq flex h-9 items-center gap-1">
                {[0.6, 1, 0.8, 0.5].map((h, i) => <span key={i} className="w-1.5 rounded-full bg-current" style={{ height: `${h * 100}%` }} />)}
              </span>
            ) : look === 'offline' ? <MicOff className="size-9" /> : <Mic className="size-10" />}
          </motion.span>
        </AnimatePresence>
        {look === 'asleep' && (
          <motion.span
            initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 25 }}
            aria-hidden className="absolute -top-0.5 -right-0.5 grid size-8 place-items-center rounded-full bg-primary text-primary-foreground shadow-2 ring-2 ring-background"
          >
            <Moon className="size-4" />
          </motion.span>
        )}
      </motion.button>
    </div>
  )
}
