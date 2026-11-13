import { Check, Mic, MicOff, Sparkles, WifiOff, X } from 'lucide-react'
import type { Entry } from '../../shared/ledger.js'
import type { PendingView, TurnMetrics } from '../../shared/protocol.js'
import { cn } from '@/lib/utils'
import type { VoiceStatus } from '@/lib/contracts'
import { rs, time } from './format'
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
      className={cn('flex w-full items-center gap-3 rounded-2xl bg-card px-4 py-3 text-left shadow-sm ring-1 ring-black/5', fresh && 'stamp', e.voided && 'opacity-45')}
    >
      <div className="min-w-0 flex-1">
        <div className={cn('truncate text-base font-semibold', e.voided && 'line-through')}>{name}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <DirChip dir={e.direction} promise={e.promise} t={t} />
          <span>{time(e.ts)}</span>
          {e.source?.path === 'llm' && <Sparkles className="size-3" aria-label="AI read" />}
          {e.status === 'confirmed' && <Check className="size-3.5 text-payment" />}
          {e.status === 'disputed' && <X className="size-3.5 text-destructive" />}
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
      <div className="mt-4 grid grid-cols-2 gap-2">
        {p.kind === 'direction' ? (
          <>
            <Answer className="bg-credit text-white" onClick={() => onAnswer('udhaar')}>{t.credit}</Answer>
            <Answer className="bg-payment text-white" onClick={() => onAnswer('jama')}>{t.payment}</Answer>
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

/** Big mic: rings breathe with the input level; colour shows who is talking. */
export function MicButton({ status, level, on, onPress, onRelease }: {
  status: VoiceStatus; level: number; on: boolean; onPress: () => void; onRelease: () => void
}) {
  const s = 1 + Math.min(level * 3, 0.6)
  const live = on && status !== 'offline'
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
        aria-label="mic"
        onPointerDown={(e) => { e.preventDefault(); onPress() }}
        onPointerUp={onRelease}
        onPointerLeave={onRelease}
        onContextMenu={(e) => e.preventDefault()}
        className={cn(
          'relative grid size-24 touch-none select-none place-items-center rounded-full shadow-xl transition-colors',
          !on ? 'bg-primary text-primary-foreground' : status === 'speaking' ? 'bg-payment text-white' : status === 'offline' ? 'bg-muted text-muted-foreground' : 'bg-primary text-primary-foreground',
        )}
      >
        {status === 'offline' && on ? <WifiOff className="size-9" /> : on ? <Mic className="size-10" /> : <MicOff className="size-10 opacity-90" />}
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
