import { formatINR } from '../../shared/numbers.js'
import { dayFromOffset } from '../../shared/ledger.js'
import type { UiStrings } from './strings'

export const rs = (paise: number) => `₹${formatINR(Math.abs(paise) / 100)}`
export const today = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
export const time = (ts: number) => new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
export const dayLabel = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
export const initials = (name: string) => [...name.trim()][0]?.toUpperCase() ?? '?'

const MS_DAY = 86_400_000
export const parseDay = (day: string) => new Date(`${day}T00:00:00`)
/** Whole days from today (negative = past). */
export const dayDiff = (day: string) => Math.round((parseDay(day).getTime() - parseDay(today()).getTime()) / MS_DAY)
export const shiftDay = (n: number) => dayFromOffset(n)
/** Compact money for tight stat tiles: ₹1.2L from a lakh up. */
export const rsShort = (paise: number) => {
  const r = Math.abs(paise) / 100
  if (r >= 1e7) return `₹${+(r / 1e7).toFixed(2)}Cr`
  if (r >= 1e5) return `₹${+(r / 1e5).toFixed(2)}L`
  return rs(paise)
}
/** "Today" / "Yesterday" / "Tomorrow" / "Wed, 12 Nov". */
export const relDay = (day: string, t: UiStrings) => {
  const d = dayDiff(day)
  if (d === 0) return t.today
  if (d === -1) return t.yesterday
  if (d === 1) return t.tomorrow
  return parseDay(day).toLocaleDateString(t.loc, { weekday: 'short', day: 'numeric', month: 'short' })
}
/** Local YYYY-MM-DD of a timestamp. */
export const dayOfTs = (ts: number) => dayFromOffset(0, new Date(ts))
/** Where an entry sits in the history: its day, but a promise sits on the day it was recorded. */
export const entryDay = (e: { day: string; promise: boolean; ts: number }) => (e.promise ? dayOfTs(e.ts) : e.day)
/** "3 days ago" style, from a YYYY-MM-DD day. */
export const ago = (day: string, t: UiStrings) => {
  const n = -dayDiff(day)
  if (n <= 0) return t.today
  if (n === 1) return t.yesterday
  return `${n} ${t.daysAgo}`
}
