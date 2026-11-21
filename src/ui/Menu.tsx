import { BellRing, BookOpen, ChevronRight, IndianRupee, MapPin, Mic, Pencil, Phone, ShieldCheck, Store, User } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import type { KhataStore, Settings } from '@/lib/contracts'
import { announceOn } from './prefs'
import { clientLog } from '@/lib/log'
import { dueForReminder, twilioReady } from '@/lib/remind'
import { Dropdown } from './Dropdown'
import { Logo } from './Logo'
import { ProfileForm } from './Profile'
import type { UiStrings } from './strings'

/** The hamburger menu (left side): shop profile, import, WhatsApp reminders, voice, my data. */
export function MenuSheet({ store, open, t, onClose, onChanged, onPrivacy, onImport, onRemindAll, onReminders }: {
  store: KhataStore; open: boolean; t: UiStrings; onClose: () => void
  onChanged: (p: { handsFree?: boolean; fastSpeech?: boolean }) => void
  onPrivacy: () => void
  onImport: () => void
  onRemindAll: () => void
  /** the per-customer consent list (RemindSheet) */
  onReminders: () => void
}) {
  const st = store.settings
  const [editing, setEditing] = useState(false)
  const [debugLogs, setDebugLogs] = useState(clientLog.enabled)
  const [twilio, setTwilio] = useState<boolean | null>(null)
  useEffect(() => { if (open) void twilioReady(true).then(setTwilio) }, [open])
  const due = dueForReminder(store.state, st).length

  return (
    <Sheet open={open} swipeDirection="left" onOpenChange={(o) => { if (!o) { setEditing(false); onClose() } }}>
      <SheetContent side="left" closeLabel={t.dismiss} className="w-[88%] max-w-sm">
        <SheetHeader className="pt-4 pb-1">
          <SheetTitle className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight"><Logo size={34} />{t.menu}</SheetTitle>
          <div className="gold-rule mt-2" />
        </SheetHeader>
        <div className="space-y-6 px-4 text-sm">
          {/* shop profile */}
          <section>
            <Heading icon={<Store className="size-4" />}>{t.profile}</Heading>
            {editing ? (
              <ProfileForm t={t} initial={st} submit={t.saveChanges} onSave={(p) => void store.updateSettings({ ...p, profileDone: true }).then(() => setEditing(false))} />
            ) : (
              <div className="rounded-2xl bg-card p-4 shadow-1 ring-1 ring-foreground/6">
                <div className="text-xl font-semibold tracking-tight">{st.shopName}</div>
                <div className="mt-1 space-y-0.5 text-muted-foreground">
                  {st.ownerName && <div className="flex items-center gap-1.5"><User className="size-3.5 shrink-0" />{st.ownerName}</div>}
                  {st.shopAddress && <div className="flex items-start gap-1.5"><MapPin className="mt-0.5 size-3.5 shrink-0" /><span>{st.shopAddress}</span></div>}
                  {st.shopPhone && <div className="flex items-center gap-1.5"><Phone className="size-3.5 shrink-0" />{st.shopPhone}</div>}
                  {st.shopUpi && <div className="flex items-center gap-1.5"><IndianRupee className="size-3.5 shrink-0" /><span className="truncate">{st.shopUpi}</span></div>}
                </div>
                <button onClick={() => setEditing(true)} className="mt-2 flex min-h-11 items-center gap-1.5 font-semibold text-primary"><Pencil className="size-4" />{t.editProfile}</button>
              </div>
            )}
          </section>

          {/* old paper khata */}
          <button onClick={onImport} className="flex h-12 w-full items-center gap-2 rounded-xl bg-primary px-3 font-semibold text-primary-foreground shadow-2 active:scale-[.98]">
            <BookOpen className="size-5" /><span className="flex-1 text-left">{t.importTitle}</span><ChevronRight className="size-4" />
          </button>

          {/* WhatsApp reminders */}
          <section>
            <Heading icon={<BellRing className="size-4" />}>{t.waReminders}</Heading>
            <div className="space-y-3 rounded-2xl bg-card p-4 shadow-1 ring-1 ring-foreground/6">
              <div className={twilio ? 'text-primary' : 'text-muted-foreground'}>{twilio === null ? '…' : twilio ? `✓ ${t.twilioOn}` : t.twilioOff}</div>
              <Row label={t.autoRemind}>
                <Switch disabled={!twilio} checked={!!st.autoRemind && !!twilio} onCheckedChange={(v) => void store.updateSettings({ autoRemind: v })} />
              </Row>
              <div className="flex min-h-11 items-center justify-between gap-3">
                <span className="min-w-0">{t.remindEvery}</span>
                <Dropdown
                  label={t.remindEvery} value={String(st.remindEveryDays ?? 7)} align="right" className="w-32"
                  options={['3', '7', '15', '30'].map((d) => ({ value: d, label: `${d} ${t.daysUnit}` }))}
                  onChange={(d) => void store.updateSettings({ remindEveryDays: Number(d) })}
                />
              </div>
              <button disabled={!twilio || !due} onClick={onRemindAll}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 font-semibold text-primary-foreground disabled:opacity-40">
                <BellRing className="size-4" />{t.remindAll} ({due})
              </button>
              <button onClick={onReminders}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl px-3 font-semibold text-primary ring-1 ring-primary/25 active:scale-[.98]">
                {t.remindersNav}
              </button>
            </div>
          </section>

          {/* voice */}
          <section>
            <Heading icon={<Mic className="size-4" />}>{t.voiceSettings}</Heading>
            <div className="space-y-1 rounded-2xl bg-card px-4 py-2 shadow-1 ring-1 ring-foreground/6">
              <Row label={t.handsFree}><Switch checked={st.handsFree} onCheckedChange={(v) => void store.updateSettings({ handsFree: v }).then(() => onChanged({ handsFree: v }))} /></Row>
              <Row label={t.announcePay}><Switch checked={announceOn(st)} onCheckedChange={(v) => void store.updateSettings({ announcePayments: v } as Partial<Settings>)} /></Row>
              <Row label={t.fastSpeech}><Switch checked={st.speed === 1.2} onCheckedChange={(v) => onChanged({ fastSpeech: v })} /></Row>
              <Row label={t.latency}><Switch checked={st.showLatency} onCheckedChange={(v) => void store.updateSettings({ showLatency: v })} /></Row>
              <Row label={t.debugLogs}><Switch checked={debugLogs} onCheckedChange={(v) => { clientLog.set(v); setDebugLogs(v) }} /></Row>
            </div>
          </section>

          <button onClick={onPrivacy} className="flex h-12 w-full items-center gap-2 rounded-xl bg-card px-3 font-semibold shadow-1 ring-1 ring-foreground/6">
            <ShieldCheck className="size-5 text-primary" /><span className="flex-1 text-left">{t.myData}</span><ChevronRight className="size-4 text-muted-foreground" />
          </button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Heading({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold tracking-widest text-muted-foreground uppercase">{icon}{children}</h3>
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-3">
      <span className="min-w-0">{label}</span>
      {children}
    </label>
  )
}

