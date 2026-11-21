import { Check } from 'lucide-react'
import { useState } from 'react'
import type { Settings } from '@/lib/contracts'
import { isUpiId } from '@/lib/pay'
import { inputCls } from './kit'
import type { UiStrings } from './strings'

export type Profile = Pick<Settings, 'shopName' | 'ownerName' | 'shopAddress' | 'shopPhone' | 'shopUpi'>

/** Shop name, owner, address and phone: used by sign-up and by "Edit profile" in the menu. */
export function ProfileForm({ t, initial, submit, onSave }: { t: UiStrings; initial: Profile; submit: string; onSave: (p: Profile) => void }) {
  const [p, setP] = useState<Profile>({
    shopName: initial.shopName === 'Meri Dukaan' ? '' : initial.shopName,
    ownerName: initial.ownerName ?? '', shopAddress: initial.shopAddress ?? '', shopPhone: initial.shopPhone ?? '', shopUpi: initial.shopUpi ?? '',
  })
  const set = (k: keyof Profile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setP({ ...p, [k]: e.target.value })
  const phoneOk = !p.shopPhone || p.shopPhone.replace(/\D/g, '').length >= 10
  const upiOk = !p.shopUpi?.trim() || isUpiId(p.shopUpi)
  const ok = !!p.shopName.trim() && phoneOk && upiOk
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (ok) onSave({ shopName: p.shopName.trim(), ownerName: p.ownerName?.trim() || undefined, shopAddress: p.shopAddress?.trim() || undefined, shopPhone: p.shopPhone?.trim() || undefined, shopUpi: p.shopUpi?.trim() || undefined })
      }}
    >
      <Field label={`${t.shopName} *`}>
        <input value={p.shopName} onChange={set('shopName')} maxLength={40} required autoComplete="organization" placeholder="Sharma Kirana" className={INPUT} />
      </Field>
      <Field label={t.ownerName}>
        <input value={p.ownerName} onChange={set('ownerName')} maxLength={40} autoComplete="name" placeholder="Rakesh Sharma" className={INPUT} />
      </Field>
      <Field label={t.shopAddress}>
        <textarea value={p.shopAddress} onChange={set('shopAddress')} maxLength={120} rows={2} autoComplete="street-address" placeholder="12, MG Road, Jayanagar" className={`${INPUT} h-auto resize-none py-2.5`} />
      </Field>
      <Field label={t.shopPhone}>
        <input value={p.shopPhone} onChange={set('shopPhone')} inputMode="tel" autoComplete="tel" maxLength={16} placeholder="98xxxxxxxx" className={INPUT} aria-invalid={!phoneOk} />
      </Field>
      <Field label={t.upiId}>
        <input value={p.shopUpi} onChange={set('shopUpi')} autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={80} placeholder="sharma@okaxis" className={INPUT} aria-invalid={!upiOk} />
        <span className={`mt-1 block text-xs ${upiOk ? 'text-muted-foreground' : 'text-destructive'}`}>{t.upiHint}</span>
      </Field>
      <p className="text-xs text-muted-foreground">{t.signupNote}</p>
      <button type="submit" disabled={!ok} className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-bold text-primary-foreground shadow-2 active:scale-[.98] disabled:opacity-40">
        <Check className="size-5" />{submit}
      </button>
    </form>
  )
}

const INPUT = inputCls

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</span>
      {children}
    </label>
  )
}
