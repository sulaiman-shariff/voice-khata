import { Check, Mic, Pencil, Sparkles, Square, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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
        <div>
          <div className="text-lg font-semibold text-destructive">{t.deleteAll}?</div>
          {p.requireType && <div className="mt-1 text-sm text-muted-foreground">{t.typeToErase} <b className="text-foreground">{p.requireType}</b></div>}
        </div>
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
          <>
            <TextAnswer label={t.typeName} send={t.send} onSubmit={onAnswer} />
            <Answer className="col-span-2 bg-secondary" onClick={() => onAnswer('nahi')}>{t.no}</Answer>
          </>
        ) : p.kind === 'amount' ? (
          <>
            {(p.amounts ?? []).map((a) => (
              <Answer key={a} className="bg-secondary text-secondary-foreground ring-1 ring-black/10" onClick={() => onAnswer(String(a))}><span className="num">₹{a}</span></Answer>
            ))}
            {!p.amounts?.length && <TextAnswer label={t.amount} send={t.send} numeric onSubmit={onAnswer} />}
            <Answer className="col-span-full bg-secondary text-secondary-foreground ring-1 ring-black/10" onClick={() => onAnswer('nahi')}><X className="size-5" />{t.no}</Answer>
          </>
        ) : p.kind === 'delete' && p.requireType ? (
          <>
            <EraseTyped word={p.requireType} t={t} onErase={onAnswer} />
            <Answer className="col-span-full bg-secondary text-secondary-foreground ring-1 ring-black/10" onClick={() => onAnswer('nahi')}><X className="size-5" />{t.no}</Answer>
          </>
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

/** Erase confirmation: the button stays disabled until the word is typed; it submits the word. */
export function EraseTyped({ word, t, onErase, className }: { word: string; t: UiStrings; onErase: (w: string) => void; className?: string }) {
  const [v, setV] = useState('')
  const ok = v.normalize('NFC').trim().toLowerCase() === word.normalize('NFC').toLowerCase()
  return (
    <form className={cn('col-span-full flex gap-2', className)} onSubmit={(e) => { e.preventDefault(); if (ok) onErase(word) }}>
      <input
        value={v} onChange={(e) => setV(e.target.value)} aria-label={word} placeholder={word} maxLength={20} autoComplete="off" autoCapitalize="off"
        className="h-14 min-w-0 flex-1 rounded-2xl border bg-background px-3 text-lg"
      />
      <button type="submit" disabled={!ok} className="flex h-14 shrink-0 items-center justify-center gap-2 rounded-2xl bg-destructive px-4 text-lg font-semibold text-white disabled:opacity-40"><Trash2 className="size-5" />{t.tapToErase}</button>
    </form>
  )
}

/** A tool made something ready: one big button does it (nothing is sent or saved before the tap). */
export function ReadyCard({ label, text, to, onGo, onDismiss, t }: { label: string; text?: string; to?: string; onGo: () => void; onDismiss: () => void; t: UiStrings }) {
  return (
    <div className="stamp rounded-3xl border-2 border-payment/40 bg-card p-4 shadow-lg">
      {to && <div className="mb-1 text-base font-semibold">{t.toWho}: {to}</div>}
      {text && <pre className="mb-3 max-h-40 overflow-y-auto whitespace-pre-wrap font-sans text-sm text-muted-foreground">{text}</pre>}
      <button onClick={onGo} className="flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-payment text-xl font-bold text-white active:scale-[.97]">{label}</button>
      <button onClick={onDismiss} className="mt-2 min-h-11 w-full rounded-2xl text-base text-muted-foreground">{t.dismiss}</button>
    </div>
  )
}

/** A text answer to the open question (a name, an amount), submitted with the keyboard or the button. */
function TextAnswer({ label, send, numeric, onSubmit }: { label: string; send: string; numeric?: boolean; onSubmit: (v: string) => void }) {
  const [v, setV] = useState('')
  const go = () => { const x = v.trim(); if (x) { onSubmit(x); setV('') } }
  return (
    <form className="col-span-full flex gap-2" onSubmit={(e) => { e.preventDefault(); go() }}>
      <input
        value={v} onChange={(e) => setV(e.target.value)} aria-label={label} placeholder={label} maxLength={40}
        inputMode={numeric ? 'numeric' : 'text'} enterKeyHint="send"
        className="h-14 min-w-0 flex-1 rounded-2xl border bg-background px-3 text-lg"
      />
      <button type="submit" disabled={!v.trim()} className="h-14 rounded-2xl bg-primary px-5 text-lg font-semibold text-primary-foreground disabled:opacity-50">{send}</button>
    </form>
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
/** Press-and-hold longer than this is a hold (wake while held); shorter is a tap. */
const HOLD_MS = 350

/**
 * Big mic: ONE control. Asleep (dim ring): tap wakes. Awake: tap puts it to sleep; while the app is
 * speaking the tap cuts the reply short instead (square icon). Hold = awake while held.
 * Rings breathe with the input level; colour shows who is talking.
 */
export function MicButton({ status, levelSource, on, handsFree, t, onTap, onHoldStart, onHoldEnd }: {
  status: VoiceStatus; levelSource: Set<(v: number) => void>; on: boolean; handsFree: boolean; t: UiStrings
  /** short press: wake / cut the reply short / go to sleep (the caller decides by state) */
  onTap: () => void
  /** pressed for a while (or any press in push-to-talk): awake while held */
  onHoldStart: () => void
  onHoldEnd: () => void
}) {
  // the ~30 Hz mic level lives here, so it re-renders only this button, not the whole screen
  const [level, setLevel] = useState(0)
  useEffect(() => {
    levelSource.add(setLevel)
    return () => { levelSource.delete(setLevel) }
  }, [levelSource])
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

  const s = 1 + Math.min(level * 3, 0.6)
  const live = on && status !== 'offline'
  const asleep = !on || status === 'asleep'
  const dim = asleep || status === 'offline' // offline: awake in name only, nothing is heard
  const interrupt = live && status === 'speaking'
  const label = asleep ? t.micStart : interrupt ? t.interrupt : t.micStop
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
        // one toggle: pressed = awake
        aria-pressed={!dim && !interrupt}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); if (handsFree) onTap(); else down() } }}
        onKeyUp={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !handsFree) up() }}
        onPointerDown={(e) => { e.preventDefault(); down() }}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={up}
        onContextMenu={(e) => e.preventDefault()}
        className={cn(
          'relative grid size-24 touch-none select-none place-items-center rounded-full shadow-xl transition-colors',
          dim ? 'bg-card text-primary/60 ring-4 ring-primary/20' : status === 'speaking' ? 'bg-payment text-white' : 'bg-primary text-primary-foreground',
        )}
      >
        {interrupt ? <Square className="size-8 fill-current" /> : <Mic className="size-10" />}
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
