import { Check, Mic, Pencil, MicOff, Sparkles, Square, WifiOff, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Entry } from '../../shared/ledger.js'
import type { PendingView, TurnMetrics } from '../../shared/protocol.js'
import { cn } from '@/lib/utils'
import type { VoiceStatus } from '@/lib/contracts'
import { relDay, rs, time } from './format'
import type { UiStrings } from './strings'

export function DirChip({ dir, promise, t }: { dir: 'credit' | 'payment'; promise?: boolean; t: UiStrings }) {
  if (promise) return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">{t.promise}</span>
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', dir === 'credit' ? 'bg-credit/12 text-credit' : 'bg-payment/12 text-payment')}>
      {dir === 'credit' ? t.credit : t.payment}
    </span>
  )
}

export function EntryRow({ e, name, t, onClick, fresh }: { e: Entry; name: string; t: UiStrings; onClick?: () => void; fresh?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn('flex min-h-16 w-full items-center gap-3 rounded-2xl bg-card px-4 py-3 text-left shadow-sm ring-1 ring-black/5 active:bg-muted/60', fresh && 'stamp', e.voided && 'opacity-50')}
    >
      <div className="min-w-0 flex-1">
        <div className={cn('truncate text-lg font-semibold leading-snug', e.voided && 'line-through')}>{name}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-muted-foreground">
          <DirChip dir={e.direction} promise={e.promise} t={t} />
          {e.promise ? <span className="text-amber-800">{t.due} {relDay(e.day, t)}</span> : <span className="num">{time(e.ts)}</span>}
          {e.amended && !e.voided && <span className="flex items-center gap-0.5 text-xs"><Pencil className="size-3" />{t.edited}</span>}
          {e.voided && <span className="text-xs">{t.removed}</span>}
          {e.source?.path === 'llm' && <Sparkles className="size-3" aria-label={t.aiRead} />}
          {e.status === 'confirmed' && <Check className="size-3.5 text-payment" aria-label={t.confirmed} />}
          {e.status === 'disputed' && <X className="size-3.5 text-destructive" aria-label={t.disputed} />}
        </div>
      </div>
      <div className={cn('num text-2xl font-bold', e.voided ? 'line-through' : e.promise ? 'text-amber-700' : e.direction === 'credit' ? 'text-credit' : 'text-payment')}>
        {e.direction === 'payment' && !e.promise ? '−' : ''}{rs(e.paise)}
      </div>
    </button>
  )
}

/** The agent's open question, with tap answers so a noisy shop never blocks. */
export function PendingCard({ p, t, onAnswer }: { p: PendingView; t: UiStrings; onAnswer: (a: string) => void }) {
  const big = p.paise !== undefined && p.kind !== 'delete'
  const kind = p.kind as string
  if (kind === 'batch') {
    return (
      <div className="stamp rounded-3xl border-2 border-primary/30 bg-card p-4 shadow-lg">
        <div className="flex items-center gap-2">
          <span className="num text-sm text-muted-foreground">× {p.options?.length ?? 0}</span>
          <button onClick={() => onAnswer('udhaar')} className={cn('min-h-11 rounded-full px-3 text-sm font-semibold ring-1', p.direction === 'credit' ? 'bg-credit text-white ring-credit' : 'ring-black/15')}>{t.credit}</button>
          <button onClick={() => onAnswer('jama')} className={cn('min-h-11 rounded-full px-3 text-sm font-semibold ring-1', p.direction === 'payment' ? 'bg-payment text-white ring-payment' : 'ring-black/15')}>{t.payment}</button>
        </div>
        <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto text-lg font-semibold">
          {(p.options ?? []).map((o, i) => <li key={i} className="num truncate">{o}</li>)}
        </ul>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Answer className="bg-payment text-white" onClick={() => onAnswer('haan')}><Check className="size-5" />{t.yes}</Answer>
          <Answer className="bg-secondary text-secondary-foreground ring-1 ring-black/10" onClick={() => onAnswer('nahi')}><X className="size-5" />{t.no}</Answer>
        </div>
      </div>
    )
  }
  if (kind === 'modify') {
    return (
      <div className="stamp rounded-3xl border-2 border-primary/30 bg-card p-4 shadow-lg">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className={cn('truncate text-lg font-semibold', p.remove && 'line-through')}>{p.name ?? '?'}</div>
            <div className="flex items-center gap-1.5">
              {p.direction && <DirChip dir={p.direction} t={t} />}
              {p.remove && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">{t.removeEntry}</span>}
            </div>
          </div>
          {p.paise !== undefined && <div className={cn('num text-4xl font-extrabold', p.remove && 'line-through opacity-60')}>{rs(p.paise)}</div>}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Answer className="bg-payment text-white" onClick={() => onAnswer('haan')}><Check className="size-5" />{t.yes}</Answer>
          <Answer className="bg-secondary text-secondary-foreground ring-1 ring-black/10" onClick={() => onAnswer('nahi')}><X className="size-5" />{t.no}</Answer>
        </div>
      </div>
    )
  }
  return (
    <div className="stamp rounded-3xl border-2 border-primary/30 bg-card p-4 shadow-lg">
      {p.kind === 'delete' ? (
        <div className="text-lg font-semibold text-destructive">{t.deleteAll}?</div>
      ) : (
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold">{p.name ?? '?'}</div>
            {p.direction && <DirChip dir={p.direction} t={t} />}
          </div>
          {big && <div className="num text-4xl font-extrabold">{rs(p.paise!)}</div>}
        </div>
      )}
      <div className={cn('mt-4 grid gap-2', p.kind === 'direction' ? 'grid-cols-3' : 'grid-cols-2')}>
        {p.kind === 'direction' ? (
          <>
            <Answer className="bg-credit text-white" onClick={() => onAnswer('udhaar')}>{t.credit}</Answer>
            <Answer className="bg-payment text-white" onClick={() => onAnswer('jama')}>{t.payment}</Answer>
            <Answer className="bg-secondary text-secondary-foreground ring-1 ring-black/10" onClick={() => onAnswer('nahi')}><X className="size-5" />{t.wrong}</Answer>
          </>
        ) : (p.kind === 'which' || p.kind === 'confusable') && p.options ? (
          p.options.map((o) => (
            <Answer key={o} className="bg-secondary text-secondary-foreground ring-1 ring-black/10" onClick={() => onAnswer(o)}>
              {p.kind === 'confusable' ? `₹${o}` : o}
            </Answer>
          ))
        ) : p.kind === 'name' ? (
          <Answer className="col-span-2 bg-secondary" onClick={() => onAnswer('nahi')}>{t.no}</Answer>
        ) : (
          <>
            <Answer className="bg-payment text-white" onClick={() => onAnswer('haan')}><Check className="size-5" />{t.yes}</Answer>
            <Answer className="bg-secondary text-secondary-foreground ring-1 ring-black/10" onClick={() => onAnswer('nahi')}><X className="size-5" />{t.no}</Answer>
          </>
        )}
      </div>
    </div>
  )
}

function Answer({ className, children, onClick }: { className?: string; children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cn('flex h-14 items-center justify-center gap-2 rounded-2xl text-lg font-semibold active:scale-[.97]', className)}>
      {children}
    </button>
  )
}

/**
 * Big mic: ONE control. Hands-free: tap = start listening, tap again = stop (mute); while the app is
 * speaking the tap cuts the reply short instead (square icon). Push-to-talk: hold to talk.
 * Rings breathe with the input level; colour shows who is talking.
 */
export function MicButton({ status, levelSource, on, handsFree, t, onPress, onRelease }: {
  status: VoiceStatus; levelSource: Set<(v: number) => void>; on: boolean; handsFree: boolean; t: UiStrings; onPress: () => void; onRelease: () => void
}) {
  // the ~30 Hz mic level lives here, so it re-renders only this button, not the whole screen
  const [level, setLevel] = useState(0)
  useEffect(() => {
    levelSource.add(setLevel)
    return () => { levelSource.delete(setLevel) }
  }, [levelSource])
  const s = 1 + Math.min(level * 3, 0.6)
  const live = on && status !== 'offline'
  const interrupt = handsFree && live && status === 'speaking'
  const label = !on ? (handsFree ? t.micStart : t.hold) : interrupt ? t.interrupt : handsFree ? t.micStop : t.hold
  return (
    <div className="relative grid size-28 place-items-center">
      {live && status === 'listening' && (
        <>
          <span className="ripple absolute inset-0 rounded-full bg-primary/25" />
          <span className="absolute inset-0 rounded-full bg-primary/20 transition-transform duration-75" style={{ transform: `scale(${s})` }} />
        </>
      )}
      {live && status === 'speaking' && <span className="absolute inset-0 animate-pulse rounded-full bg-payment/25" />}
      {live && status === 'thinking' && <span className="absolute -inset-1 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />}
      <button
        type="button"
        aria-label={label}
        // a toggle in hands-free mode (pressed = listening); push-to-talk is a hold button, not a toggle
        aria-pressed={handsFree ? on && !interrupt : undefined}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); onPress() } }}
        onKeyUp={(e) => { if (e.key === 'Enter' || e.key === ' ') onRelease() }}
        onPointerDown={(e) => { e.preventDefault(); onPress() }}
        onPointerUp={onRelease}
        onPointerLeave={onRelease}
        onContextMenu={(e) => e.preventDefault()}
        className={cn(
          'relative grid size-24 touch-none select-none place-items-center rounded-full shadow-xl transition-colors',
          !on ? 'bg-card text-primary ring-4 ring-primary/40' : status === 'speaking' ? 'bg-payment text-white' : status === 'offline' ? 'bg-muted text-muted-foreground' : 'bg-primary text-primary-foreground',
        )}
      >
        {status === 'offline' && on ? <WifiOff className="size-9" /> : interrupt ? <Square className="size-8 fill-current" /> : on ? <Mic className="size-10" /> : <MicOff className="size-10" />}
      </button>
    </div>
  )
}

/** Per-turn latency: where the time went after the shopkeeper stopped talking. */
export function Waterfall({ m }: { m: TurnMetrics & { clientFirstAudioMs: number | null } }) {
  const max = 2000
  const rows: [string, number | null, string][] = [
    ['end of turn', m.commitAt ?? m.finalAt, 'bg-sky-500'],
    ['transcript', m.finalAt, 'bg-indigo-500'],
    [m.path === 'llm' ? `understood (AI ${Math.round(m.llmMs ?? 0)} ms)` : 'understood (rules)', m.finalAt + m.parseMs, 'bg-violet-500'],
    ['first reply audio', m.firstAudioAt, 'bg-payment'],
  ]
  return (
    <div className="rounded-2xl bg-card p-3 text-xs shadow-sm ring-1 ring-black/5">
      <div className="mb-2 flex justify-between font-medium">
        <span>after you stopped speaking</span>
        <span className="num">{m.firstAudioAt !== null ? `${Math.round(m.firstAudioAt)} ms` : '—'}{m.earlyCommit ? ' · early' : ''}{m.snrDb !== null ? ` · SNR ${Math.round(m.snrDb)} dB` : ''}</span>
      </div>
      {rows.map(([label, v, c]) => (
        <div key={label} className="mb-1 flex items-center gap-2">
          <span className="w-36 shrink-0 truncate text-muted-foreground">{label}</span>
          <div className="relative h-2.5 flex-1 rounded-full bg-muted">
            {v !== null && <div className={cn('absolute inset-y-0 left-0 rounded-full', c)} style={{ width: `${Math.min(100, (Math.max(v, 0) / max) * 100)}%` }} />}
          </div>
          <span className="num w-12 text-right">{v !== null ? Math.round(v) : '—'}</span>
        </div>
      ))}
    </div>
  )
}
