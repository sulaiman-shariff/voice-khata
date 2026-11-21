import { BookOpen, Mic } from 'lucide-react'
import { motion } from 'motion/react'
import type { Entry, LedgerState } from '../../../shared/ledger.js'
import type { Lang } from '../../../shared/replies.js'
import { DayFeed } from '../Ledger'
import { EmptyState } from '../kit'
import type { UiStrings } from '../strings'
import { TodaySummaryCard } from '../TodaySummaryCard'

/** Today's summary card over the day-grouped history, or a first-run empty state with import and three example sentences. */
export function TodayTab({ t, lang, state, entries, name, fresh, onEntry, onImport, onExample }: {
  t: UiStrings; lang?: Lang | null; state: LedgerState; entries: Entry[]; name: (cid: string) => string; fresh: string | null
  onEntry: (eid: string) => void; onImport: () => void; onExample: (text: string) => void
}) {
  if (entries.length) {
    return (
      <>
        <TodaySummaryCard state={state} lang={lang} />
        <DayFeed entries={entries} t={t} name={name} fresh={fresh} onEntry={onEntry} state={state} lang={lang} />
      </>
    )
  }
  return (
    <EmptyState
      icon={Mic} title={t.noEntries} hint={t.tryThese}
      className="rounded-2xl border border-dashed border-foreground/15 bg-card/50"
      action={
        <div className="flex flex-col gap-2">
          {[t.ex1, t.ex2, t.ex3].map((x, i) => (
            <motion.button
              key={x} onClick={() => onExample(x)}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 * i + 0.1 }}
              className="h-12 rounded-xl bg-card px-4 text-lg font-medium shadow-1 ring-1 ring-primary/20 active:scale-[.98]"
            >
              “{x}”
            </motion.button>
          ))}
          <button onClick={onImport} className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 font-semibold text-primary-foreground shadow-2 active:scale-[.98]">
            <BookOpen className="size-5" />{t.importCta}
          </button>
        </div>
      }
    />
  )
}
