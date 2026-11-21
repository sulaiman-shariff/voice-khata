import { toast } from 'sonner'
import type { BackupClient, KhataStore } from '@/lib/contracts'
import type { RemindResult } from '@/lib/remind'
import type { UiStrings } from './strings'

export function shareWhatsApp(text: string, phone?: string) {
  const digits = phone?.replace(/\D/g, '') ?? ''
  const to = digits.length === 10 ? `91${digits}` : digits
  window.open(`https://wa.me/${to}?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
}

export function remindLink(store: KhataStore, cid: string, text: string) {
  shareWhatsApp(text, store.state.customers.get(cid)?.phone)
}

/** Twilio's codes that a shop on the free trial actually meets, in plain words. */
const TWILIO_HINT: Record<number, string> = {
  63015: 'This number has not joined your Twilio WhatsApp trial. From that phone, send the join code (e.g. "join twilio-trial") to your Twilio number.',
  63016: 'More than 24 h since this number last messaged your Twilio number. From that phone, send the join code again, then retry.',
  21211: 'Twilio says this phone number is not valid.',
  21608: 'On the Twilio trial you can only message your verified number.',
  21610: 'This customer replied STOP, so Twilio will not message them.',
  63007: 'The Twilio WhatsApp sender in .env (TWILIO_WHATSAPP_FROM) is not right.',
  20003: 'Twilio rejected the Account SID / Auth Token in .env.',
  21654: "This Twilio trial number only sends Twilio's own sample template, not your text. Use the WhatsApp Sandbox number (+1 415 523 8886) or upgrade Twilio — see update.md. Until then, tap WhatsApp to send it yourself.",
}

/** One toast per reminder attempt, in the shop's language; Twilio errors say why, and offer the shop's own WhatsApp. */
export function toastRemind(t: UiStrings, r: RemindResult) {
  if (r.ok) toast.success(r.via === 'twilio' ? t.remindSent : t.remindShared)
  else if (r.reason === 'no-phone') toast.error(t.noPhone)
  else if (r.reason === 'not-allowed') toast.error(t.notAllowed)
  else if (r.reason === 'nothing-due') toast(t.nothingDue)
  else {
    const why = (r.code && TWILIO_HINT[r.code]) || r.error || ''
    toast.error(`${t.remindFailed}${r.code ? ` (Twilio ${r.code})` : ''}`, {
      description: why,
      duration: 15000,
      action: r.share ? { label: 'WhatsApp', onClick: r.share } : undefined,
    })
  }
}

/** Remove the server backup too, so erased data cannot be restored from it. */
export async function dropBackup(b: BackupClient) {
  try { await (b as unknown as { deleteBackup?: () => Promise<void> }).deleteBackup?.() } catch { /* best effort */ }
}
