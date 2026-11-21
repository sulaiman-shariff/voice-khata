import { BellRing, Globe, Menu as MenuIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { LANG_NAME, LANGS, type Lang } from '../../../shared/replies.js'
import type { Settings } from '@/lib/contracts'
import { Dropdown } from '../Dropdown'
import type { UiStrings } from '../strings'

/** Top bar: menu | shop name (centred) | reminders bell + language. Clears the phone's status bar. */
export function Header({ t, settings, dueCount, onMenu, onBell, onLanguage }: {
  t: UiStrings; settings: Settings; dueCount: number; onMenu: () => void; onBell: () => void; onLanguage: (v: 'auto' | Lang) => void
}) {
  const auto = settings.autoLang !== false
  return (
    <header className="relative shrink-0" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="relative flex h-16 items-center justify-between gap-2 px-3">
        <button aria-label={t.menu} onClick={onMenu} className="grid size-11 shrink-0 place-items-center rounded-xl hover:bg-muted active:scale-95">
          <MenuIcon className="size-6" />
        </button>
        <div className="pointer-events-none absolute inset-x-[7.75rem] text-center">
          <div className="truncate text-base leading-tight font-semibold tracking-tight sm:text-lg">{settings.shopName}</div>
          <div className="mt-0.5 text-[10px] font-semibold tracking-[0.24em] text-gold uppercase">KhataBhai</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button aria-label={dueCount ? `${t.remindersNav} · ${dueCount}` : t.remindersNav} onClick={onBell} className="relative grid size-11 place-items-center rounded-xl hover:bg-muted active:scale-95">
            <BellRing className="size-5" />
            <AnimatePresence>
              {dueCount > 0 && (
                <motion.span
                  key="badge" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ type: 'spring', stiffness: 600, damping: 25 }}
                  aria-hidden className="num absolute top-1 right-0.5 grid min-w-4.5 place-items-center rounded-full bg-credit px-1 text-[10px] leading-4.5 font-semibold text-credit-foreground ring-2 ring-background"
                >
                  {dueCount > 99 ? '99+' : dueCount}
                </motion.span>
              )}
            </AnimatePresence>
          </button>
          <Dropdown
            compact label={t.language} align="right" panelClassName="w-60"
            value={auto ? 'auto' : (settings.lang as string)}
            options={[{ value: 'auto', label: 'Auto', hint: t.autoAny }, ...LANGS.map((l) => ({ value: l as string, label: LANG_NAME[l], hint: l.toUpperCase() }))]}
            onChange={(v) => onLanguage(v as 'auto' | Lang)}
            button={<span className="flex items-center gap-1"><Globe className="size-4 shrink-0 text-muted-foreground" /><span>{auto ? 'Auto' : settings.lang?.toUpperCase()}</span></span>}
          />
        </div>
      </div>
      <div className="gold-rule" />
    </header>
  )
}
