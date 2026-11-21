import { Check, Copy, ShieldCheck, Smartphone } from 'lucide-react'
import QRCode from 'qrcode'
import { useEffect, useMemo, useState } from 'react'
import { readPayRequest, upiUri } from '@/lib/pay'
import { Logo } from '@/ui/Logo'
import { applySavedTheme } from '@/ui/theme'

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
  useEffect(() => { applySavedTheme() }, [])

  const am = Number.parseFloat(amount) || 0
  const uri = req ? upiUri({ ...req, am }) : ''
  useEffect(() => {
    if (!uri) return
    void QRCode.toDataURL(uri, { margin: 1, width: 480, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr(''))
  }, [uri])

  if (!req) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">This payment link is not valid</h1>
        <p className="mt-1 text-muted-foreground">यह भुगतान लिंक सही नहीं है। दुकान से नया संदेश माँगें।</p>
      </Shell>
    )
  }

  return (
    <Shell>
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
        className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-lg bg-primary text-lg font-semibold text-primary-foreground shadow-md active:scale-[.98]"
      >
        <Smartphone className="size-5" />Pay with UPI app · UPI से भुगतान
      </a>
      <div className="mt-1.5 text-center text-xs text-muted-foreground">Google Pay · PhonePe · Paytm · BHIM · any UPI app</div>

      {qr && (
        <div className="mt-6 flex flex-col items-center gap-2">
          <img src={qr} alt="UPI QR code" className="size-56 rounded-lg bg-white p-2 ring-1 ring-foreground/10" />
          <div className="text-xs text-muted-foreground">Or scan with any UPI app · या किसी भी UPI ऐप से स्कैन करें</div>
        </div>
      )}

      <button
        onClick={() => void navigator.clipboard?.writeText(req.pa).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })}
        className="mt-5 flex min-h-12 w-full items-center justify-between gap-2 rounded-lg bg-card px-4 ring-1 ring-foreground/10"
      >
        <span className="min-w-0 text-left">
          <span className="block text-xs text-muted-foreground">UPI ID</span>
          <span className="num block truncate font-semibold">{req.pa}</span>
        </span>
        {copied ? <Check className="size-5 text-payment" /> : <Copy className="size-5 text-muted-foreground" />}
      </button>

      <p className="mt-6 flex gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="size-4 shrink-0 text-payment" />
        <span>The money goes straight to the shop's UPI account; KhataBhai never holds it. The shop updates your khata after it arrives. · पैसा सीधे दुकान के UPI खाते में जाता है।</span>
      </p>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto min-h-full max-w-md bg-background px-5 pt-6 pb-10">
      <div className="mb-6 flex items-center gap-2.5">
        <Logo size={32} />
        <span className="font-semibold tracking-tight">KhataBhai</span>
      </div>
      {children}
    </div>
  )
}
