import { ImageDown, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { balance, dayFromOffset, displayName, type LedgerState } from '../../shared/ledger.js'
import type { Settings } from '@/lib/contracts'
import { isUpiId, upiUri } from '@/lib/pay'
import { renderStatementPng, shareStatement, statementInputFor } from '@/lib/statement'
import { cn } from '@/lib/utils'
import { rs } from './format'
import { fx } from './strings-features'

/**
 * "Statement image": draws the customer's last 15 entries, running balance, item chips and a UPI
 * pay QR as a PNG on the phone, then shares it (WhatsApp via the share sheet, else download + wa.me).
 */
export function StatementButton({ state, cid, settings, className }: {
  state: LedgerState
  cid: string
  settings: Pick<Settings, 'shopName' | 'ownerName' | 'shopAddress' | 'shopPhone' | 'shopUpi' | 'lang'>
  className?: string
}) {
  const f = fx(settings.lang)
  const [busy, setBusy] = useState(false)
  const c = state.customers.get(cid)
  if (!c) return null

  const go = async () => {
    setBusy(true)
    try {
      const label = displayName(state, cid)
      const bal = balance(state, cid)
      const payUrl = isUpiId(settings.shopUpi) && bal > 0
        ? upiUri({ pa: settings.shopUpi!, pn: settings.shopName, am: bal / 100, tn: `Khata: ${c.name}` })
        : undefined
      const input = statementInputFor(state, cid, {
        shop: { name: settings.shopName, owner: settings.ownerName, address: settings.shopAddress, phone: settings.shopPhone },
        label, tag: c.tag, payUrl, locale: f.loc, asOf: dayFromOffset(0),
        labels: {
          statementFor: f.statementFor, opening: f.opening, totalDue: f.totalDue, advance: f.advance, settled: f.settled,
          credit: f.creditWord, payment: f.paymentWord, colDate: f.colDate, colDetail: f.colDetail, colAmount: f.colAmount,
          colBalance: f.colBalance, scanToPay: f.scanToPay, madeWith: f.madeWith,
        },
      })
      const blob = await renderStatementPng(input)
      const text = `${settings.shopName}: ${label} — ${bal > 0 ? f.totalDue : bal < 0 ? f.advance : f.settled} ${rs(bal)}`
      const how = await shareStatement(blob, text, { phone: c.phone, filename: `khata-${c.name.replace(/\s+/g, '-')}.png` })
      if (how === 'downloaded') toast(f.statementSaved)
    } catch {
      toast.error(f.statementFailed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button" onClick={() => void go()} disabled={busy} aria-busy={busy}
      className={cn('flex h-12 items-center justify-center gap-2 rounded-xl bg-card px-4 font-semibold shadow-1 ring-1 ring-foreground/10 active:scale-[.98] disabled:opacity-60', className)}
    >
      {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <ImageDown className="size-5" aria-hidden />}
      {f.statement}
    </button>
  )
}
