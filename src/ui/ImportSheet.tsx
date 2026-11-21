import { Camera, Check, Keyboard, Loader2, Mic, Square, Trash2, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { type ImportRow, parseImport } from '../../shared/import.js'
import { type Direction, displayName } from '../../shared/ledger.js'
import { NAME_NEAR, NAME_SURE, matchName } from '../../shared/names.js'
import type { LedgerOp } from '../../shared/protocol.js'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { api } from '@/lib/api'
import type { KhataStore } from '@/lib/contracts'
import { cn } from '@/lib/utils'
import { Segmented, Toggle, inputCls } from './kit'
import { dayDiff, rs, today } from './format'
import type { UiStrings } from './strings'

type Via = 'read' | 'type' | 'photo'
interface Row extends ImportRow { id: number; via: Via; unsure?: boolean; /** cid, 'new', or 'choose' (several customers share the name: the shopkeeper picks) */ match: string }

/** Rows reach the sheet from the voice client while "read aloud" is on. */
/** rows read aloud reach the open sheet through this: the sheet binds its handler, and unbinds with null */
export type ImportSink = (fn: ((rows: ImportRow[], text: string) => void) | null) => void

/**
 * Bring an old paper khata in: read it aloud, type it, or photograph it. Every way fills one
 * review table; nothing is written until "Save all". Each row becomes an opening-balance entry
 * (credit = the customer owes, payment = an advance), dated "balance as of".
 */
export function ImportSheet({ store, open, t, sink, onReading, onClose, onChanged }: {
  store: KhataStore; open: boolean; t: UiStrings; sink: ImportSink
  /** start / stop the voice import mode (the app starts the mic if needed) */
  onReading: (on: boolean) => Promise<boolean>
  onClose: () => void
  onChanged: () => void
}) {
  const s = store.state
  const [tab, setTab] = useState<Via>('read')
  const [rows, setRows] = useState<Row[]>([])
  const [reading, setReading] = useState(false)
  const [heard, setHeard] = useState('')
  const [text, setText] = useState('')
  const [photoBusy, setPhotoBusy] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [asOf, setAsOf] = useState(today())
  const [saving, setSaving] = useState(false)
  const nextId = useRef(1)
  const file = useRef<HTMLInputElement>(null)

  const people = useMemo(() => [...s.customers.values()].map((c) => ({ id: c.cid, names: [c.name, ...c.aliases] })), [s])
  const exactly = (name: string) => [...s.customers.values()].filter((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase())
  /** every customer this name could be: all same-name twins first, then sound-alikes */
  const candidates = (name: string) => {
    const ids = [...exactly(name).map((c) => c.cid), ...matchName(name, people).filter((m) => m.score >= NAME_NEAR).map((m) => m.id)]
    return [...new Set(ids)].slice(0, 6)
  }
  const bestMatch = (name: string) => {
    const exact = exactly(name)
    if (exact.length === 1) return exact[0].cid
    // two customers share the name (two Rameshes): never guess, never open a third account by default
    if (exact.length > 1) return 'choose'
    const m = matchName(name, people).filter((x) => x.score >= NAME_NEAR)
    if (m[0] && m[1] && m[1].score >= m[0].score - 0.03 && m[0].score >= NAME_SURE) return 'choose'
    return m[0] && m[0].score >= NAME_SURE ? m[0].id : 'new'
  }
  const add = (list: (ImportRow & { unsure?: boolean })[], via: Via) =>
    setRows((r) => [...r, ...list.map((x) => { const match = bestMatch(x.name); return { ...x, id: nextId.current++, via, match, unsure: x.unsure || match === 'choose' } })])
  /** new accounts that share a name with an existing one: their nicknames are asked once, after saving */
  const [nicks, setNicks] = useState<{ cid: string; name: string; tag: string }[]>([])

  // voice rows arrive while reading aloud
  useEffect(() => {
    sink((r, said) => { setHeard(said); if (r.length) add(r, 'read') })
    return () => sink(null)
  }) // re-bound every render so `add` sees the current ledger

  const stopReading = () => { if (reading) { setReading(false); void onReading(false) } }
  const close = () => { stopReading(); onClose() }

  const photo = async (f: File) => {
    setPhotoBusy(true)
    try {
      const image = await shrink(f)
      setPreview(image)
      const res = await fetch(api('/api/import'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image }) })
      const j = (await res.json().catch(() => ({}))) as { rows?: (ImportRow & { unsure?: boolean })[]; error?: string }
      if (!res.ok || !j.rows) throw new Error(j.error ?? `HTTP ${res.status}`)
      if (!j.rows.length) toast(t.noRows)
      add(j.rows, 'photo')
    } catch (e) {
      toast.error(`${t.photoFailed}: ${(e as Error).message}`)
    } finally {
      setPhotoBusy(false)
      if (file.current) file.current.value = ''
    }
  }

  const set = (id: number, p: Partial<Row>) => setRows((r) => r.map((x) => (x.id === id ? { ...x, ...p } : x)))
  const valid = rows.filter((r) => r.name.trim() && r.amount > 0 && r.match !== 'choose')
  const toChoose = rows.filter((r) => r.match === 'choose').length
  const owed = valid.reduce((n, r) => n + (r.direction === 'credit' ? r.amount : -r.amount), 0)

  const save = async () => {
    if (!valid.length || saving) return
    setSaving(true)
    try {
      const ops: LedgerOp[] = []
      const opened = new Map<string, string>() // new name -> cid, so two rows for one new name share it
      const twins: { cid: string; name: string; tag: string }[] = []
      for (const r of valid) {
        let cid = r.match
        if (cid === 'new') {
          const key = r.name.trim().toLowerCase()
          cid = opened.get(key) ?? ''
          if (!cid) {
            cid = crypto.randomUUID()
            opened.set(key, cid)
            ops.push({ op: 'add_customer', cid, name: r.name.trim() })
            if (exactly(r.name).length) twins.push({ cid, name: r.name.trim(), tag: '' })
          }
        }
        ops.push({
          op: 'entry', eid: crypto.randomUUID(), cid, paise: Math.round(r.amount * 100), direction: r.direction,
          dayOffset: dayDiff(asOf), promise: false,
          source: { transcript: `opening balance (${r.via === 'photo' ? 'from photo' : r.via === 'read' ? 'read aloud' : 'typed'})`, confidence: r.unsure ? 'low' : 'high', reasons: ['import', ...(r.unsure ? ['unsure'] : [])], lang: 'import', path: 'fast' },
        })
      }
      await store.applyOps(ops)
      onChanged()
      toast.success(`${t.imported}: ${valid.length} · ${rs(Math.round(owed * 100))}`)
      setRows([])
      setText('')
      setPreview(null)
      if (twins.length) setNicks(twins)
      else close()
    } finally { setSaving(false) }
  }
  const saveNicks = async () => {
    for (const n of nicks) if (n.tag.trim()) await store.setConsent(n.cid, { adult: false, remindersOptIn: false, tag: n.tag.trim() })
    onChanged()
    setNicks([])
    close()
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) { setNicks([]); close() } }}>
      <SheetContent closeLabel={t.dismiss}>
        <SheetHeader className="pb-0">
          <SheetTitle className="pr-10 text-2xl">{t.importTitle}</SheetTitle>
        </SheetHeader>
        {nicks.length > 0 ? (
          <div className="space-y-3 px-4">
            <div className="rounded-2xl bg-gold/10 p-3.5">
              <div className="font-semibold">{t.nickLater}</div>
              <div className="mt-0.5 text-sm text-muted-foreground">{t.nickAlready}. {t.nickTitle}</div>
            </div>
            {nicks.map((n, i) => (
              <label key={n.cid} className="block">
                <span className="mb-1 block text-sm font-semibold">{n.name}</span>
                <input value={n.tag} maxLength={30} placeholder={t.nickEg} aria-label={`${t.nickNew}: ${n.name}`} className={inputCls}
                  onChange={(e) => setNicks((x) => x.map((y, j) => (j === i ? { ...y, tag: e.target.value } : y)))} />
              </label>
            ))}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button onClick={() => { setNicks([]); close() }} className="h-12 rounded-xl bg-secondary font-semibold ring-1 ring-foreground/10">{t.skip}</button>
              <button onClick={() => void saveNicks()} className="h-12 rounded-xl bg-primary font-semibold text-primary-foreground shadow-1">{t.saveNick}</button>
            </div>
          </div>
        ) : (
        <div className="space-y-4 px-4">
          {/* how to bring it in */}
          <Segmented<Via>
            size="sm" label={t.importHow} value={tab} onChange={(k) => { if (k !== 'read') stopReading(); setTab(k) }}
            items={[{ value: 'read', label: t.importRead, icon: Mic }, { value: 'type', label: t.importType, icon: Keyboard }, { value: 'photo', label: t.importPhoto, icon: Camera }]}
          />

          {tab === 'read' && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{t.importReadHint}</p>
              <button
                onClick={async () => {
                  if (reading) return stopReading()
                  setHeard('')
                  if (await onReading(true)) setReading(true)
                }}
                className={cn('flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-base font-bold shadow-2', reading ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground')}
              >
                {reading ? <><Square className="size-4 fill-current" />{t.stopReading}</> : <><Mic className="size-5" />{t.startReading}</>}
              </button>
              {reading && <div className="min-h-6 truncate text-center text-sm text-muted-foreground">{heard ? `“${heard}”` : '…'}</div>}
            </div>
          )}

          {tab === 'type' && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{t.importTypeHint}</p>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder={'Ramesh 500\nSuresh 1200\nGeeta 300 jama'}
                className="w-full resize-none rounded-xl bg-card p-3 text-base leading-snug shadow-1 ring-1 ring-foreground/10 outline-none focus:ring-2 focus:ring-primary" />
              <button disabled={!text.trim()} onClick={() => { const r = parseImport(text); if (!r.length) toast(t.noRows); else { add(r, 'type'); setText('') } }}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary font-bold text-primary-foreground shadow-1 disabled:opacity-40">
                <Check className="size-5" />{t.addRows}
              </button>
            </div>
          )}

          {tab === 'photo' && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{t.importPhotoHint}</p>
              <input ref={file} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void photo(f) }} />
              <button disabled={photoBusy} onClick={() => file.current?.click()}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-bold text-primary-foreground shadow-2 disabled:opacity-60">
                {photoBusy ? <><Loader2 className="size-5 animate-spin" />{t.readingPhoto}</> : <><Camera className="size-5" />{t.takePhoto}</>}
              </button>
              {preview && <img src={preview} alt="" className="max-h-40 w-full rounded-xl object-contain ring-1 ring-foreground/10" />}
            </div>
          )}

          {/* review */}
          <div className="gold-rule" />
          {rows.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">{t.noRows}</div>
          ) : (
            <div className="space-y-2">
              <label className="flex items-center justify-between gap-3 text-sm">
                <span className="font-semibold text-muted-foreground">{t.asOf}</span>
                <input type="date" value={asOf} max={today()} onChange={(e) => e.target.value && setAsOf(e.target.value)}
                  className="num h-11 rounded-xl bg-card px-2 ring-1 ring-foreground/12" />
              </label>
              <ul className="space-y-2">
                {rows.map((r) => {
                  const cands = candidates(r.name)
                  return (
                    <li key={r.id} className={cn('space-y-2 rounded-2xl bg-card p-3 shadow-1 ring-1', r.unsure ? 'ring-warn/60' : 'ring-foreground/6')}>
                      <div className="flex items-center gap-2">
                        <input value={r.name} onChange={(e) => set(r.id, { name: e.target.value, match: bestMatch(e.target.value) })} aria-label={t.customer}
                          className="h-11 min-w-0 flex-1 rounded-xl bg-background px-2 text-base font-semibold ring-1 ring-foreground/10" />
                        <span className="num text-lg text-muted-foreground">₹</span>
                        <input value={r.amount ? String(r.amount) : ''} inputMode="decimal" aria-label={t.amount}
                          onChange={(e) => set(r.id, { amount: Number.parseFloat(e.target.value.replace(/[^\d.]/g, '')) || 0 })}
                          className="num h-11 w-24 rounded-xl bg-background px-2 text-right text-lg font-bold ring-1 ring-foreground/10" />
                        <button aria-label={t.removeEntry} onClick={() => setRows((x) => x.filter((y) => y.id !== r.id))} className="grid size-11 shrink-0 place-items-center text-muted-foreground"><Trash2 className="size-4" /></button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Toggle size="sm" tone="credit" on={r.direction === 'credit'} onClick={() => set(r.id, { direction: 'credit' as Direction })}>{t.owes}</Toggle>
                        <Toggle size="sm" tone="payment" on={r.direction === 'payment'} onClick={() => set(r.id, { direction: 'payment' as Direction })}>{t.advance}</Toggle>
                        <select value={r.match} onChange={(e) => set(r.id, { match: e.target.value, unsure: e.target.value === 'choose' ? true : r.unsure && r.match !== 'choose' })} aria-label={t.customer}
                          className={cn('h-11 min-w-0 flex-1 rounded-xl bg-background px-2 text-sm ring-1', r.match === 'choose' ? 'ring-warn' : 'ring-foreground/10')}>
                          {r.match === 'choose' && <option value="choose">{t.chooseOne}…</option>}
                          {cands.map((id) => <option key={id} value={id}>{displayName(s, id)}</option>)}
                          <option value="new">+ {t.newCust}: {r.name}</option>
                        </select>
                        {r.unsure && <span className="flex items-center gap-1 text-warn"><TriangleAlert className="size-3.5" />{t.checkRow}</span>}
                      </div>
                    </li>
                  )
                })}
              </ul>
              {toChoose > 0 && <div className="flex items-center gap-1.5 text-sm text-warn"><TriangleAlert className="size-4" />{t.chooseOne}: {toChoose}</div>}
              <button onClick={() => void save()} disabled={!valid.length || saving}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-lg font-bold text-primary-foreground shadow-2 active:scale-[.98] disabled:opacity-40">
                <Check className="size-5" />{t.saveRows} · {valid.length} · <span className="num">{rs(Math.round(owed * 100))}</span>
              </button>
            </div>
          )}
        </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

/** Phone photos are several MB: send a ~1600 px JPEG instead (plenty for handwriting). */
async function shrink(f: File, max = 1600): Promise<string> {
  const bmp = await createImageBitmap(f)
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * k)
  c.height = Math.round(bmp.height * k)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  return c.toDataURL('image/jpeg', 0.85)
}
