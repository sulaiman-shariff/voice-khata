import { SearchX } from 'lucide-react'
import { balance, dues } from '../../shared/ledger.js'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { KhataStore } from '@/lib/contracts'
import { cn } from '@/lib/utils'
import { dayLabel, entryDay, rs } from './format'
import { Avatar, EmptyState, ListRow } from './kit'
import { EntryRow } from './parts'
import type { UiStrings } from './strings'

/** What a spoken "show ..." opens: a day's entries, a search, or the biggest dues. */
export type ListView = { k: 'history'; from: string; to: string; cid?: string } | { k: 'search'; text: string; cids?: string[]; eids?: string[] } | { k: 'top'; count?: number }

export function ListSheet({ store, view, t, onClose, onCustomer, onEntry }: {
  store: KhataStore; view: ListView | null; t: UiStrings; onClose: () => void; onCustomer: (cid: string) => void; onEntry: (eid: string) => void
}) {
  if (!view) return null
  const s = store.state
  const name = (cid: string) => s.customers.get(cid)?.name ?? '—'
  const all = s.order.map((id) => s.entries.get(id)!).filter((e) => !e.voided)
  const empty = <EmptyState icon={SearchX} title={t.noEntriesHere} />
  let title = ''
  let body: React.ReactNode = null
  if (view.k === 'top') {
    title = t.topDebtors
    const top = dues(s).sort((a, b) => b.paise - a.paise).slice(0, Math.min(5, view.count ?? 5))
    body = top.length ? top.map((d) => <PersonRow key={d.cid} name={name(d.cid)} paise={d.paise} onClick={() => onCustomer(d.cid)} />) : empty
  } else if (view.k === 'history') {
    title = (view.cid ? `${name(view.cid)} · ` : '') + (view.from === view.to ? dayLabel(view.from) : `${dayLabel(view.from)} ${t.rangeTo} ${dayLabel(view.to)}`)
    const es = all.filter((e) => { const d = entryDay(e); return d >= view.from && d <= view.to && (!view.cid || e.cid === view.cid) }).sort((a, b) => b.ts - a.ts)
    body = es.length ? es.map((e) => <EntryRow key={e.eid} e={e} name={name(e.cid)} t={t} onClick={() => onEntry(e.eid)} />) : empty
  } else {
    title = `${t.searchResults}: ${view.text}`
    const q = view.text.trim().toLowerCase()
    const nums = (view.text.match(/\d+(\.\d+)?/g) ?? []).map((x) => Math.round(Number(x) * 100))
    const people = [...s.customers.values()].filter((c) => view.cids ? view.cids.includes(c.cid) : q && (c.name.toLowerCase().includes(q) || c.aliases.some((a) => a.toLowerCase().includes(q))))
    const es = view.eids ? all.filter((e) => view.eids!.includes(e.eid)) : nums.length ? all.filter((e) => nums.includes(e.paise)).sort((a, b) => b.ts - a.ts) : []
    body = people.length || es.length ? (
      <>
        {people.map((c) => <PersonRow key={c.cid} name={c.name} paise={balance(s, c.cid)} onClick={() => onCustomer(c.cid)} />)}
        {es.map((e) => <EntryRow key={e.eid} e={e} name={name(e.cid)} t={t} onClick={() => onEntry(e.eid)} />)}
      </>
    ) : empty
  }
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent closeLabel={t.dismiss}>
        <SheetHeader><SheetTitle className="pr-10 text-2xl">{title}</SheetTitle></SheetHeader>
        <div className="space-y-2 px-4">{body}</div>
      </SheetContent>
    </Sheet>
  )
}

function PersonRow({ name, paise, onClick }: { name: string; paise: number; onClick: () => void }) {
  return (
    <ListRow
      onClick={onClick} leading={<Avatar name={name} />} title={name}
      trailing={<span className={cn('num text-xl font-bold', paise > 0 ? 'text-credit' : 'text-payment')}>{rs(paise)}</span>}
    />
  )
}
