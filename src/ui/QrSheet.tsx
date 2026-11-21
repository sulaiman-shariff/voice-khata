import { Banknote, Check, RefreshCw, ScanLine } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { Lang } from '../../shared/replies.js'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { isUpiId, upiUri } from '@/lib/pay'
import { closeQr, createQr, qrDataUrl, type QrResult } from '@/lib/qr'
import { cn } from '@/lib/utils'
import { rs } from './format'
import { AnimatedAmount, Avatar, NameTag, Skeleton } from './kit'
import { fx } from './strings-features'

const spring = { type: 'spring', stiffness: 420, damping: 30 } as const

/** Coins and a little confetti flying out of the check. Light: 18 spans, no library. */
function Burst() {
  const bits = Array.from({ length: 18 }, (_, i) => {
    const a = (i / 18) * Math.PI * 2 + (i % 2 ? 0.17 : 0)
    const r = 120 + (i % 3) * 38
    return { i, x: Math.cos(a) * r, y: Math.sin(a) * r - 30, coin: i % 3 === 0, rot: (i % 5) * 70 - 140 }
  })
  const confetti = ['bg-gold', 'bg-credit', 'bg-primary', 'bg-payment']
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
      {bits.map((b) => (
        <motion.span
          key={b.i}
          initial={{ x: 0, y: 0, scale: 0.4, opacity: 1, rotate: 0 }}
          animate={{ x: b.x, y: [0, b.y, b.y + 90], scale: 1, opacity: [1, 1, 0], rotate: b.rot }}
          transition={{ duration: 1.25, ease: [0.22, 1, 0.36, 1], times: [0, 0.55, 1] }}
          className={cn(
            'absolute',
            b.coin
              ? 'grid size-7 place-items-center rounded-full bg-gold text-[13px] font-bold text-white shadow-2 ring-2 ring-white/60'
              : cn('h-3 w-1.5 rounded-[1px]', confetti[b.i % confetti.length]),
          )}
        >
          {b.coin ? '₹' : null}
        </motion.span>
      ))}
    </div>
  )
}

function mmss(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * The counter QR: the amount, the customer, a QR and a countdown.
 * - Razorpay QR (`mode 'qr'`) or a payment link drawn as a QR (`mode 'link'`): the payment books itself;
 *   when `paidNotice.qrId` matches, the QR turns into a check, coins fly, and the sheet closes.
 * - No Razorpay (`fallback`): a plain upi:// QR to the shop's UPI ID, and a "Paid? ✓" button.
 * "Paid in cash" calls onPaidCash. Closing while unpaid closes the QR on the server (closeQr).
 */
export function QrSheet({ open, onOpenChange, cid, paise, name, onPaidCash, onPaidUpi, paidNotice, lang, shopUpi, shopName }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  cid: string
  paise: number
  /** the customer's label (displayName) */
  name: string
  /** record an ordinary cash payment of `paise` */
  onPaidCash: () => void
  /** fallback QR only: the shopkeeper says the UPI money arrived (record a bank payment); defaults to onPaidCash */
  onPaidUpi?: () => void
  /** the latest payment SyncNotice; closes the sheet when its qrId is this QR's */
  paidNotice?: { qrId?: string } | null
  lang?: Lang | null
  /** for the fallback upi:// QR */
  shopUpi?: string
  shopName?: string
}) {
  const f = fx(lang)
  const reduce = useReducedMotion()
  const [res, setRes] = useState<QrResult | null>(null)
  const [img, setImg] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [paidByHand, setPaid] = useState(false)
  const [nonce, setNonce] = useState(0)
  const paidRef = useRef(false)
  const idRef = useRef<string | null>(null)

  // a fresh QR for every open / customer / amount / retry: forget the last one while it is made
  const key = `${open}:${cid}:${paise}:${nonce}`
  const [lastKey, setLastKey] = useState(key)
  if (key !== lastKey) {
    setLastKey(key)
    setPaid(false)
    setRes(null)
    setImg(null)
  }

  // make the QR on open; close it on the server when the sheet goes away unpaid
  useEffect(() => {
    if (!open) return
    let live = true
    paidRef.current = false
    idRef.current = null
    void createQr(cid, paise, name).then(async (r) => {
      if (!live) {
        if ('id' in r) void closeQr(r.id)
        return
      }
      if ('id' in r) idRef.current = r.id
      setRes(r)
      let url: string | null = null
      if ('mode' in r) url = r.mode === 'qr' ? r.imageUrl : await qrDataUrl(r.linkUrl).catch(() => null)
      else if (shopUpi && isUpiId(shopUpi)) url = await qrDataUrl(upiUri({ pa: shopUpi, pn: shopName ?? '', am: paise / 100, tn: `Khata: ${name}` })).catch(() => null)
      if (live) setImg(url)
    })
    return () => {
      live = false
      if (idRef.current && !paidRef.current) void closeQr(idRef.current)
      idRef.current = null
    }
  }, [open, cid, paise, nonce]) // eslint-disable-line react-hooks/exhaustive-deps

  // paid: by hand (fallback), or the payment landed (a sync notice with this QR's id)
  const paid = paidByHand || (open && !!res && 'id' in res && !!paidNotice?.qrId && paidNotice.qrId === res.id)

  // countdown
  useEffect(() => {
    if (!open || !res || !('closeBy' in res) || paid) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [open, res, paid])

  // after the celebration, close
  useEffect(() => {
    if (!paid) return
    paidRef.current = true
    navigator.vibrate?.([30, 60, 30])
    const t = setTimeout(() => onOpenChange(false), reduce ? 900 : 1800)
    return () => clearTimeout(t)
  }, [paid]) // eslint-disable-line react-hooks/exhaustive-deps

  const fallback = !!res && 'fallback' in res
  const left = res && 'closeBy' in res ? res.closeBy - now : null
  const expired = left !== null && left <= 0 && !paid

  const cash = () => {
    paidRef.current = true
    if (idRef.current) void closeQr(idRef.current)
    onPaidCash()
    onOpenChange(false)
  }
  const manual = () => {
    paidRef.current = true
    setPaid(true)
    ;(onPaidUpi ?? onPaidCash)()
  }

  return (
    <Sheet open={open} onOpenChange={(o) => onOpenChange(o)}>
      <SheetContent side="bottom" className="min-h-[88dvh]" closeLabel={f.notNow}>
        <SheetHeader className="items-center pt-4 text-center">
          <SheetTitle className="sr-only">{f.qrTitle}</SheetTitle>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Avatar name={name} id={cid} className="size-8 text-sm" />
            <NameTag label={name} className="text-base font-medium text-foreground" />
          </div>
          <AnimatedAmount paise={paise} from={paise} className="mt-1 text-5xl font-bold tracking-tight" />
        </SheetHeader>

        <div className="relative mx-auto grid w-full max-w-xs place-items-center px-4">
          <div className="relative grid aspect-square w-full place-items-center rounded-3xl bg-card p-4 shadow-2 ring-1 ring-foreground/6">
            <AnimatePresence mode="wait" initial={false}>
              {paid ? (
                <motion.div
                  key="paid" initial={{ scale: 0.3, opacity: 0, rotate: -30 }} animate={{ scale: 1, opacity: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 360, damping: 18 }}
                  className="grid size-40 place-items-center rounded-full bg-payment text-payment-foreground shadow-3"
                  role="status" aria-live="assertive" aria-label={`${f.received} ${rs(paise)}`}
                >
                  <svg viewBox="0 0 24 24" className="size-20" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: reduce ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.15, duration: 0.45, ease: 'easeOut' }} />
                  </svg>
                </motion.div>
              ) : img && !expired ? (
                <motion.img
                  key="qr" src={img} alt={`${f.qrTitle}: ${rs(paise)}`}
                  initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6, rotate: 12, filter: 'blur(6px)' }}
                  transition={spring} className="size-full rounded-xl object-contain [image-rendering:pixelated]"
                />
              ) : expired ? (
                <motion.div key="exp" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-3 text-center">
                  <span className="text-base font-semibold text-muted-foreground">{f.expired}</span>
                  <button type="button" onClick={() => setNonce((n) => n + 1)} className="flex h-11 items-center gap-2 rounded-xl bg-primary px-4 font-semibold text-primary-foreground active:scale-[.98]">
                    <RefreshCw className="size-4" />{f.makeAgain}
                  </button>
                </motion.div>
              ) : res && fallback && !img ? (
                <motion.div key="noupi" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-2 text-center text-sm text-muted-foreground">{f.noUpi}</motion.div>
              ) : (
                <motion.div key="load" exit={{ opacity: 0 }} className="flex size-full flex-col items-center justify-center gap-3">
                  <Skeleton className="size-full rounded-xl" />
                  <span className="sr-only" role="status">{f.making}</span>
                </motion.div>
              )}
            </AnimatePresence>
            {paid && !reduce && <Burst />}
          </div>

          <div className="mt-4 flex min-h-12 flex-col items-center gap-1 text-center" aria-live="polite">
            {paid ? (
              <motion.span initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="text-xl font-semibold text-payment">{f.received}</motion.span>
            ) : res && !expired ? (
              <>
                <span className="flex items-center gap-1.5 text-base font-medium">
                  <ScanLine className="size-4 text-muted-foreground" aria-hidden />
                  {res && 'mode' in res && res.mode === 'link' ? f.scanCamera : f.scanUpi}
                </span>
                <span className="text-sm text-muted-foreground">
                  {fallback ? f.manualNote : <>{f.autoBooks}{left !== null && <> · {f.closesIn} <span className="num font-semibold text-foreground">{mmss(left)}</span></>}</>}
                </span>
              </>
            ) : null}
          </div>
        </div>

        {!paid && (
          <div className="mt-auto grid gap-2 px-4">
            {fallback && img && (
              <button type="button" onClick={manual} className="flex h-14 items-center justify-center gap-2 rounded-xl bg-payment text-lg font-semibold text-payment-foreground shadow-2 active:scale-[.98]">
                <Check className="size-5" />{f.paidManual}
              </button>
            )}
            <button type="button" onClick={cash} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-secondary font-semibold text-secondary-foreground ring-1 ring-foreground/10 active:scale-[.98]">
              <Banknote className="size-5" />{f.paidCash}
            </button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
