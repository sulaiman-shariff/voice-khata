import { Check, Pencil, Sparkles, Trash2, X } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import type { Entry } from '../../shared/ledger.js'
import type { PendingView, TurnMetrics } from '../../shared/protocol.js'
import { cn } from '@/lib/utils'
import { relDay, rs, time } from './format'
import { NameTag, inputCls } from './kit'
import type { UiStrings } from './strings'

export function DirChip({ dir, promise, t }: { dir: 'credit' | 'payment'; promise?: boolean; t: UiStrings }) {
  if (promise) return <span className="rounded-full bg-warn/15 px-2 py-0.5 text-xs font-medium text-warn">{t.promise}</span>
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', dir === 'credit' ? 'bg-credit/12 text-credit' : 'bg-payment/12 text-payment')}>
      {dir === 'credit' ? t.credit : t.payment}
    </span>
  )
}

export function EntryRow({ e, name, t, onClick, fresh, chips }: { e: Entry; name: string; t: UiStrings; onClick?: () => void; fresh?: boolean; chips?: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn('flex min-h-16 w-full items-center gap-3 rounded-2xl bg-card px-4 py-3 text-left shadow-1 ring-1 ring-foreground/6 transition-colors active:bg-muted/60', fresh && (e.direction === 'credit' ? 'flash-credit' : 'flash-payment'), e.voided && 'opacity-50')}
    >
      <div className="min-w-0 flex-1">
        <NameTag label={name} className={cn('text-lg font-semibold leading-snug', e.voided && 'line-through')} />
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-muted-foreground">
          <DirChip dir={e.direction} promise={e.promise} t={t} />
          {e.promise ? <span className="text-warn">{t.due} {relDay(e.day, t)}</span> : <span className="num">{time(e.ts)}</span>}
          {e.amended && !e.voided && <span className="flex items-center gap-0.5 text-xs"><Pencil className="size-3" />{t.edited}</span>}
          {e.voided && <span className="text-xs">{t.removed}</span>}
          {e.source?.path === 'llm' && <Sparkles className="size-3" aria-label={t.aiRead} />}
          {e.status === 'confirmed' && <Check className="size-3.5 text-payment" aria-label={t.confirmed} />}
          {e.status === 'disputed' && <X className="size-3.5 text-destructive" aria-label={t.disputed} />}
        </div>
        {chips}
      </div>
      <div className={cn('num text-xl font-semibold', e.voided ? 'line-through' : e.promise ? 'text-warn' : e.direction === 'credit' ? 'text-credit' : 'text-payment')}>
        {e.direction === 'payment' && !e.promise ? '−' : ''}{rs(e.paise)}
      </div>
    </button>
  )
}

type Tone = 'yes' | 'no' | 'credit' | 'payment'
const TONE: Record<Tone, string> = {
  yes: 'bg-primary text-primary-foreground shadow-1',
  no: 'bg-secondary text-secondary-foreground ring-1 ring-foreground/10',
  credit: 'bg-credit text-credit-foreground shadow-1',
  payment: 'bg-payment text-payment-foreground shadow-1',
}

/**
 * The agent's open question, with tap answers so a noisy shop never blocks. One card for every
 * kind: a head (who / how much / which lines) and a grid of answers.
 */
export function PendingCard({ p, t, onAnswer, onTag }: {
  p: PendingView; t: UiStrings; onAnswer: (a: string) => void
  /** save a nickname on the phone (the other same-name customers on the nickname card) */
  onTag?: (cid: string, tag: string) => void
}) {
  const kind = p.kind as string
  const A = (tone: Tone, value: string, children: React.ReactNode, className?: string, key = value) =>
    <Answer key={key} className={cn(TONE[tone], className)} onClick={() => onAnswer(value)}>{children}</Answer>
  const yes = (n?: number) => A('yes', 'haan', <><Check className="size-5" />{t.yes}{n ? <span className="num">× {n}</span> : null}</>)
  const no = (className?: string) => A('no', 'nahi', <><X className="size-5" />{t.no}</>, className)

  let head: React.ReactNode
  let answers: React.ReactNode
  let cols = 'grid-cols-2'
  if (kind === 'batch' && p.rows) {
    // several complete lines read back together: one yes saves them all
    head = (
      <ul className="max-h-48 space-y-1.5 overflow-y-auto">
        {p.rows.map((r, i) => (
          <li key={i} className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-lg font-semibold">{r.name}</span>
              {r.newCustomer && <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{t.newCustomer}</span>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <DirChip dir={r.direction} t={t} />
              <span className={cn('num text-xl font-bold', r.direction === 'credit' ? 'text-credit' : 'text-payment')}>{rs(r.paise)}</span>
            </div>
          </li>
        ))}
      </ul>
    )
    answers = <>{yes(p.rows.length)}{no()}</>
  } else if (kind === 'batch') {
    head = (
      <>
        <div className="flex items-center gap-2">
          <span className="num text-sm text-muted-foreground">× {p.options?.length ?? 0}</span>
          <button onClick={() => onAnswer('udhaar')} aria-pressed={p.direction === 'credit'} className={cn('min-h-11 rounded-full px-3 text-sm font-semibold ring-1', p.direction === 'credit' ? 'bg-credit text-credit-foreground ring-credit' : 'ring-foreground/15')}>{t.credit}</button>
          <button onClick={() => onAnswer('jama')} aria-pressed={p.direction === 'payment'} className={cn('min-h-11 rounded-full px-3 text-sm font-semibold ring-1', p.direction === 'payment' ? 'bg-payment text-payment-foreground ring-payment' : 'ring-foreground/15')}>{t.payment}</button>
        </div>
        <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto text-lg font-semibold">
          {(p.options ?? []).map((o, i) => <li key={i} className="num truncate">{o}</li>)}
        </ul>
      </>
    )
    answers = <>{yes()}{no()}</>
  } else if (kind === 'nickname' && p.cid) {
    // a second customer with this name was just opened: one nickname each tells them apart
    return <NicknameCard p={p} t={t} onAnswer={onAnswer} onTag={onTag} />
  } else if (kind === 'soundalike' && p.choices?.length) {
    // "Rakesh" heard, only "Ramesh" known: that one, or a new account with the same entry
    const known = p.choices.find((c) => c.id !== 'new')
    head = (
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-lg font-semibold"><NameTag label={p.name ?? known?.label ?? '?'} /></div>
          <div className="text-sm text-muted-foreground">{t.orNew}</div>
        </div>
        {p.paise !== undefined && (
          <div className="flex flex-col items-end gap-1">
            {p.direction && <DirChip dir={p.direction} t={t} />}
            <div className="num text-3xl font-semibold tracking-tight">{rs(p.paise)}</div>
          </div>
        )}
      </div>
    )
    answers = (
      <>
        {known && A('yes', known.id, <NameTag label={known.label} />, undefined, `c:${known.id}`)}
        {A('no', 'new', <span className="truncate">+ {t.newPrefix} {p.newName ?? ''}</span>, 'ring-primary/40 text-primary', 'c:new')}
        {no('col-span-full h-12 text-base')}
      </>
    )
  } else if (kind === 'which' && p.choices?.length) {
    // every same-name customer, each button carries its cid: a tap can never hit the wrong twin
    head = (
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold">{p.name ?? t.chooseOne}</div>
          {p.direction && <DirChip dir={p.direction} t={t} />}
        </div>
        {p.paise !== undefined && <div className="num text-4xl font-semibold tracking-tight">{rs(p.paise)}</div>}
      </div>
    )
    answers = (
      <>
        {p.choices.map((c) => A('no', c.id, <NameTag label={c.label} className="text-base" />, 'justify-start px-3', `c:${c.id}`))}
        {no('col-span-full h-12 text-base')}
      </>
    )
  } else if (kind === 'delete') {
    head = (
      <div>
        <div className="text-lg font-semibold text-destructive">{t.deleteAll}?</div>
        {p.requireType && <div className="mt-1 text-sm text-muted-foreground">{t.typeToErase} <b className="text-foreground">{p.requireType}</b></div>}
      </div>
    )
    answers = p.requireType ? <><EraseTyped word={p.requireType} t={t} onErase={onAnswer} />{no('col-span-full')}</> : <>{yes()}{no()}</>
  } else {
    const remove = kind === 'modify' && !!p.remove
    head = (
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className={cn('truncate text-lg font-semibold', remove && 'line-through')}>{p.name ?? '?'}</div>
          <div className="mt-0.5 flex items-center gap-1.5">
            {p.direction && <DirChip dir={p.direction} t={t} />}
            {remove && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">{t.removeEntry}</span>}
          </div>
        </div>
        {p.paise !== undefined && <div className={cn('num text-4xl font-semibold tracking-tight', remove && 'line-through opacity-60')}>{rs(p.paise)}</div>}
      </div>
    )
    if (p.kind === 'direction') {
      cols = 'grid-cols-3'
      answers = <>{A('credit', 'udhaar', t.credit)}{A('payment', 'jama', t.payment)}{A('no', 'nahi', <><X className="size-5" />{t.wrong}</>)}</>
    } else if ((p.kind === 'which' || p.kind === 'confusable') && p.options) {
      answers = p.options.map((o, i) => A('no', o, p.kind === 'confusable' ? <span className="num">₹{o}</span> : <span className="truncate">{o}</span>, undefined, `${i}:${o}`))
    } else if (p.kind === 'name') {
      answers = <><TextAnswer label={t.typeName} send={t.send} onSubmit={onAnswer} />{no('col-span-2')}</>
    } else if (p.kind === 'amount') {
      answers = (
        <>
          {(p.amounts ?? []).map((a) => A('no', String(a), <span className="num">₹{a}</span>))}
          {!p.amounts?.length && <TextAnswer label={t.amount} send={t.send} numeric onSubmit={onAnswer} />}
          {no('col-span-full')}
        </>
      )
    } else answers = <>{yes()}{no()}</>
  }
  return (
    <div className="rounded-3xl bg-card p-4 shadow-3 ring-1 ring-primary/15">
      {head}
      <div className={cn('mt-4 grid gap-2', cols)}>{answers}</div>
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
        className="h-14 min-w-0 flex-1 rounded-xl bg-background px-3 text-lg ring-1 ring-foreground/12 outline-none focus:ring-2 focus:ring-primary"
      />
      <button type="submit" disabled={!ok} className="flex h-14 shrink-0 items-center justify-center gap-2 rounded-xl bg-destructive px-4 text-lg font-semibold text-destructive-foreground disabled:opacity-40"><Trash2 className="size-5" />{t.tapToErase}</button>
    </form>
  )
}

/** A tool made something ready: one big button does it (nothing is sent or saved before the tap). */
export function ReadyCard({ label, text, to, onGo, onDismiss, t }: { label: string; text?: string; to?: string; onGo: () => void; onDismiss: () => void; t: UiStrings }) {
  return (
    <div className="rounded-3xl bg-card p-4 shadow-3 ring-1 ring-primary/15">
      {to && <div className="mb-1 text-base font-semibold">{t.toWho}: {to}</div>}
      {text && <pre className="mb-3 max-h-40 overflow-y-auto whitespace-pre-wrap font-sans text-sm text-muted-foreground">{text}</pre>}
      <button onClick={onGo} className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-lg font-bold text-primary-foreground shadow-2 active:scale-[.98]">{label}</button>
      <button onClick={onDismiss} className="mt-2 h-11 w-full rounded-2xl text-base text-muted-foreground">{t.dismiss}</button>
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
        className="h-14 min-w-0 flex-1 rounded-xl bg-background px-3 text-lg ring-1 ring-foreground/12 outline-none focus:ring-2 focus:ring-primary"
      />
      <button type="submit" disabled={!v.trim()} className="h-14 rounded-xl bg-primary px-5 text-lg font-semibold text-primary-foreground disabled:opacity-50">{send}</button>
    </form>
  )
}

function Answer({ className, children, onClick }: { className?: string; children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cn('flex h-14 min-w-0 items-center justify-center gap-2 rounded-xl px-2 text-lg font-semibold active:scale-[.97]', className)}>
      {children}
    </button>
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
    <div className="rounded-2xl bg-card p-3 text-xs shadow-1 ring-1 ring-foreground/6">
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

/** The nickname question: the new twin's nickname (sent as the answer), plus the older ones' if they have none. */
function NicknameCard({ p, t, onAnswer, onTag }: { p: PendingView; t: UiStrings; onAnswer: (a: string) => void; onTag?: (cid: string, tag: string) => void }) {
  const others = (p.twins ?? []).filter((x) => x.cid !== p.cid && !x.tag).slice(0, 2)
  const [mine, setMine] = useState('')
  const [theirs, setTheirs] = useState<Record<string, string>>({})
  const save = () => {
    for (const o of others) { const v = theirs[o.cid]?.trim(); if (v) onTag?.(o.cid, v) }
    onAnswer(mine.trim() || 'nahi')
  }
  return (
    <form className="rounded-3xl bg-card p-4 shadow-3 ring-1 ring-primary/15" onSubmit={(e) => { e.preventDefault(); save() }}>
      <div className="text-lg font-semibold">{p.name} · {t.nickTitle}</div>
      <div className="text-sm text-muted-foreground">{t.nickAlready}</div>
      <div className="mt-3 space-y-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">{t.nickNew}</span>
          <input autoFocus value={mine} onChange={(e) => setMine(e.target.value)} maxLength={30} placeholder={t.nickEg} aria-label={t.nickNew} className={inputCls} enterKeyHint="done" />
        </label>
        {onTag && others.map((o) => (
          <label key={o.cid} className="block">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">{t.nickOld} · {o.label}</span>
            <input value={theirs[o.cid] ?? ''} onChange={(e) => setTheirs((x) => ({ ...x, [o.cid]: e.target.value }))} maxLength={30} placeholder={t.nickEg} aria-label={`${t.nickOld}: ${o.label}`} className={inputCls} />
          </label>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Answer className={TONE.no} onClick={() => onAnswer('nahi')}>{t.skip}</Answer>
        <button type="submit" disabled={!mine.trim() && !Object.values(theirs).some((v) => v.trim())}
          className={cn('flex h-14 min-w-0 items-center justify-center gap-2 rounded-xl px-2 text-lg font-semibold active:scale-[.97] disabled:opacity-40', TONE.yes)}>
          <Check className="size-5" />{t.saveNick}
        </button>
      </div>
    </form>
  )
}
