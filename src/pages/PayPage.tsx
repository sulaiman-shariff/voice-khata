import { Check, Copy, Link2Off, ShieldCheck, Smartphone } from 'lucide-react'
import QRCode from 'qrcode'
import { useEffect, useMemo, useState } from 'react'
import { readPayRequest, upiUri } from '@/lib/pay'
import { Skeleton } from '@/ui/kit'
import { PageMessage, PageShell } from './PageShell'

/**
 * /pay?pa=shop@upi&pn=Shop&am=500&tn=Khata%3A+Ramesh — opened by the customer from a WhatsApp
 * reminder. One tap opens their UPI app with the shop, amount and note filled in; the QR code is
 * for paying from another phone; the UPI ID can be copied. The money goes straight to the shop.
 */
export default function PayPage() {
  const req = useMemo(() => readPayRequest(location.search), [])
  const [amount, setAmount] = useState(req && req.am > 0 ? String(req.am) : '')
  const [qr, setQr] = useState('')
  const [copied, setCopied] = useState(false)

  const am = Number.parseFloat(amount) || 0
  const uri = req ? upiUri({ ...req, am }) : ''
  useEffect(() => {
    if (!uri) return
    void QRCode.toDataURL(uri, { margin: 1, width: 480, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr(''))
  }, [uri])

  if (!req) {
    return (
      <PageShell>
        <PageMessage icon={Link2Off} tone="error" title="This payment link is not valid" body="यह भुगतान लिंक सही नहीं है। दुकान से नया संदेश माँगें।" />
      </PageShell>
    )
  }

  return (
    <PageShell>
      <div className="text-sm text-muted-foreground">Pay to · भुगतान</div>
      <h1 className="text-2xl leading-tight font-semibold tracking-tight">{req.pn || req.pa}</h1>
      {req.tn && <div className="mt-0.5 text-sm text-muted-foreground">{req.tn}</div>}

      <label className="mt-5 flex items-baseline gap-2 border-b-2 border-gold/60 pb-1 focus-within:border-primary">
        <span className="num text-3xl text-muted-foreground">₹</span>
        <input
          aria-label="Amount" inputMode="decimal" value={amount} placeholder="0"
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1').slice(0, 9))}
          className="num min-w-0 flex-1 bg-transparent text-5xl font-semibold outline-none focus-visible:outline-none"
        />
      </label>
      <div className="mt-1 text-xs text-muted-foreground">You can pay part of it too · कुछ हिस्सा भी दे सकते हैं</div>

      <a
        href={uri}
        className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-lg font-semibold text-primary-foreground shadow-2 active:scale-[.98]"
      >
        <Smartphone className="size-5" />Pay with UPI app · UPI से भुगतान
      </a>
      <div className="mt-1.5 text-center text-xs text-muted-foreground">Google Pay · PhonePe · Paytm · BHIM · any UPI app</div>

      {!!uri && (
        <div className="mt-6 flex flex-col items-center gap-2">
          {qr ? <img src={qr} alt="UPI QR code" className="size-56 rounded-2xl bg-card p-2 shadow-2 ring-1 ring-foreground/8" /> : <Skeleton className="size-56 rounded-2xl" />}
          <div className="text-xs text-muted-foreground">Or scan with any UPI app · या किसी भी UPI ऐप से स्कैन करें</div>
        </div>
      )}

      <button
        onClick={() => void navigator.clipboard?.writeText(req.pa).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })}
        className="mt-5 flex min-h-14 w-full items-center justify-between gap-2 rounded-2xl bg-card px-4 shadow-1 ring-1 ring-foreground/8 active:scale-[.99]"
      >
        <span className="min-w-0 text-left">
          <span className="block text-xs text-muted-foreground">UPI ID</span>
          <span className="num block truncate font-semibold">{req.pa}</span>
        </span>
        {copied ? <Check className="size-5 text-primary" /> : <Copy className="size-5 text-muted-foreground" />}
      </button>

      <p className="mt-6 flex gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="size-4 shrink-0 text-primary" />
        <span>The money goes straight to the shop's UPI account; KhataBhai never holds it. The shop updates your khata after it arrives. · पैसा सीधे दुकान के UPI खाते में जाता है।</span>
      </p>
    </PageShell>
  )
}
