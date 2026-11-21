import { Mic } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { isNative, openAppSettings } from '@/lib/native'
import { Wordmark } from '@/ui/Logo'
import type { ui } from '@/ui/strings'

/** One-time "allow microphone" step on Android; skipped silently when already granted. */
export function MicStep({ t, onDone }: { t: ReturnType<typeof ui>; onDone: () => void }) {
  const [denied, setDenied] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let dead = false
    void (async () => {
      try {
        const p = await navigator.permissions?.query({ name: 'microphone' as PermissionName })
        if (!dead && p?.state === 'granted') onDone()
      } catch { /* not supported: show the step */ }
    })()
    return () => { dead = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const allow = async () => {
    setBusy(true)
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      s.getTracks().forEach((x) => x.stop())
      onDone()
    } catch { setDenied(true); setBusy(false) }
  }
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="mx-auto flex h-full max-w-md flex-col overflow-y-auto px-6 pb-8" style={{ paddingTop: 'max(2rem, calc(env(safe-area-inset-top) + 1rem))' }}>
      <Wordmark size={48} />
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <span className="relative grid size-24 place-items-center rounded-full bg-primary/10 text-primary">
          <span aria-hidden className="breathe absolute inset-0 rounded-full bg-primary/10" />
          <Mic className="size-10" />
        </span>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight">{t.micTitle}</h1>
        <div className="gold-rule mt-3 mb-4 w-full" />
        <p className="text-lg text-muted-foreground">{t.micBody}</p>
        {denied && <p role="alert" className="mt-5 rounded-xl bg-warn/12 px-3 py-2 text-sm text-warn">{t.micDenied}</p>}
      </div>
      {denied ? (
        <>
          {isNative && <button onClick={openAppSettings} className="mt-8 flex h-14 w-full items-center justify-center rounded-2xl border border-primary text-lg font-semibold text-primary active:scale-[.98]">{t.micSettings}</button>}
          <button onClick={onDone} className="mt-3 flex h-14 w-full items-center justify-center rounded-2xl bg-primary text-lg font-semibold text-primary-foreground shadow-2 active:scale-[.98]">{t.micAnyway}</button>
        </>
      ) : (
        <>
          <button disabled={busy} onClick={() => void allow()} className="mt-8 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-lg font-semibold text-primary-foreground shadow-2 active:scale-[.98] disabled:opacity-60"><Mic className="size-5" />{t.micAllow}</button>
          <button onClick={onDone} className="mt-3 min-h-11 text-sm text-muted-foreground underline">{t.micSkip}</button>
        </>
      )}
    </motion.div>
  )
}
