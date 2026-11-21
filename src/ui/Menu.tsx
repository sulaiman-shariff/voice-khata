import { BellRing, BookOpen, ChevronRight, MapPin, Palette, Pencil, Phone, ShieldCheck, Store, User } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import type { KhataStore } from '@/lib/contracts'
import { clientLog } from '@/lib/log'
import { dueForReminder, twilioReady } from '@/lib/remind'
import { Dropdown } from './Dropdown'
import { ProfileForm } from './Profile'
import type { UiStrings } from './strings'
import { THEMES, applyTheme } from './theme'

/** The hamburger menu (left side): shop profile, colour theme, WhatsApp reminders, voice, my data. */
export function MenuSheet({ store, open, t, onClose, onChanged, onPrivacy, onImport, onRemindAll }: {
  store: KhataStore; open: boolean; t: UiStrings; onClose: () => void
  onChanged: (p: { handsFree?: boolean; fastSpeech?: boolean; readBackAll?: boolean }) => void
  onPrivacy: () => void
  onImport: () => void
  onRemindAll: () => void
}) {
  const st = store.settings
  const [editing, setEditing] = useState(false)
  const [debugLogs, setDebugLogs] = useState(clientLog.enabled)
  const [twilio, setTwilio] = useState<boolean | null>(null)
  useEffect(() => { if (open) void twilioReady().then(setTwilio) }, [open])
  const due = dueForReminder(store.state, st).length

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) { setEditing(false); onClose() } }}>
      <SheetContent side="left" className="w-[88%] max-w-sm overflow-y-auto pb-8">
        <SheetHeader className="pb-1">
          <SheetTitle className="font-display text-2xl">{t.menu}</SheetTitle>
          <div className="gold-rule mt-2" />
        </SheetHeader>
        <div className="space-y-6 px-4 text-sm">
          {/* shop profile */}
          <section>
            <Heading icon={<Store className="size-4" />}>{t.profile}</Heading>
            {editing ? (
              <ProfileForm t={t} initial={st} submit={t.saveChanges} onSave={(p) => void store.updateSettings({ ...p, profileDone: true }).then(() => setEditing(false))} />
            ) : (
              <div className="rounded-lg bg-card p-3 ring-1 ring-foreground/10">
                <div className="font-display text-xl font-semibold">{st.shopName}</div>
                <div className="mt-1 space-y-0.5 text-muted-foreground">
                  {st.ownerName && <div className="flex items-center gap-1.5"><User className="size-3.5 shrink-0" />{st.ownerName}</div>}
                  {st.shopAddress && <div className="flex items-start gap-1.5"><MapPin className="mt-0.5 size-3.5 shrink-0" /><span>{st.shopAddress}</span></div>}
                  {st.shopPhone && <div className="flex items-center gap-1.5"><Phone className="size-3.5 shrink-0" />{st.shopPhone}</div>}
                </div>
                <button onClick={() => setEditing(true)} className="mt-2 flex min-h-11 items-center gap-1.5 font-semibold text-primary"><Pencil className="size-4" />{t.editProfile}</button>
              </div>
            )}
          </section>

          {/* old paper khata */}
          <button onClick={onImport} className="flex min-h-12 w-full items-center gap-2 rounded-lg bg-primary px-3 font-semibold text-primary-foreground shadow-md">
            <BookOpen className="size-5" /><span className="flex-1 text-left">{t.importTitle}</span><ChevronRight className="size-4" />
          </button>

          {/* colour theme */}
          <section>
            <Heading icon={<Palette className="size-4" />}>{t.theme}</Heading>
            <Dropdown
              label={t.theme} value={st.theme ?? 'maroon'}
              options={THEMES.map((x) => ({ value: x.id, label: x.name, swatch: x.swatch }))}
              onChange={(id) => { applyTheme(id); void store.updateSettings({ theme: id }) }}
            />
          </section>

          {/* WhatsApp reminders */}
          <section>
            <Heading icon={<BellRing className="size-4" />}>{t.waReminders}</Heading>
            <div className="space-y-3 rounded-lg bg-card p-3 ring-1 ring-foreground/10">
              <div className={twilio ? 'text-payment' : 'text-muted-foreground'}>{twilio === null ? '…' : twilio ? `✓ ${t.twilioOn}` : t.twilioOff}</div>
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
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 font-semibold text-primary-foreground disabled:opacity-40">
                <BellRing className="size-4" />{t.remindAll} ({due})
              </button>
            </div>
          </section>

          {/* voice */}
          <section>
            <Heading>{t.voiceSettings}</Heading>
            <div className="space-y-1 rounded-lg bg-card p-3 ring-1 ring-foreground/10">
              <Row label={t.handsFree}><Switch checked={st.handsFree} onCheckedChange={(v) => void store.updateSettings({ handsFree: v }).then(() => onChanged({ handsFree: v }))} /></Row>
              <Row label={t.fastSpeech}><Switch checked={!!st.fastSpeech} onCheckedChange={(v) => void store.updateSettings({ fastSpeech: v }).then(() => onChanged({ fastSpeech: v }))} /></Row>
              <Row label={t.readBackAll}><Switch checked={!!st.readBackAll} onCheckedChange={(v) => void store.updateSettings({ readBackAll: v }).then(() => onChanged({ readBackAll: v }))} /></Row>
              <Row label={t.latency}><Switch checked={st.showLatency} onCheckedChange={(v) => void store.updateSettings({ showLatency: v })} /></Row>
              <Row label={t.debugLogs}><Switch checked={debugLogs} onCheckedChange={(v) => { clientLog.set(v); setDebugLogs(v) }} /></Row>
            </div>
          </section>

          <button onClick={onPrivacy} className="flex min-h-12 w-full items-center gap-2 rounded-lg bg-card px-3 font-semibold ring-1 ring-foreground/10">
            <ShieldCheck className="size-5 text-payment" /><span className="flex-1 text-left">{t.myData}</span><ChevronRight className="size-4 text-muted-foreground" />
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
