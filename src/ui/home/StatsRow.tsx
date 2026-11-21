import { rsShort } from '../format'
import { StatTile } from '../kit'
import type { UiStrings } from '../strings'

/** What the shop is owed ("lena hai") and what it owes ("dena hai"), counting to new values as entries land. */
export function StatsRow({ t, lena, dena }: { t: UiStrings; lena: number; dena: number }) {
  return (
    <section className="mx-4 mt-3 grid grid-cols-2 gap-2">
      <StatTile label={t.lenaHai} paise={lena} tone="credit" format={rsShort} emphasis />
      <StatTile label={t.denaHai} paise={dena} tone="supplier" format={rsShort} />
    </section>
  )
}
