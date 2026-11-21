/**
 * When the server's hourly sweep may send a customer an automatic reminder. Pure, so it is tested alone.
 * Same rule the phone used (src/lib/remind.ts dueForReminder), plus daytime only:
 * - the shop turned automatic reminders on (checked in the query)
 * - the customer agreed, is an adult and has a number (only those are synced), and did not reply STOP
 * - they owe something
 * - the last reminder was at least the shop's "every N days" ago
 * - it is daytime in India: SEND_FROM_HOUR..SEND_UNTIL_HOUR
 */
export const SEND_FROM_HOUR = 9
export const SEND_UNTIL_HOUR = 20

export interface ReminderCandidate {
  balancePaise: number
  lastRemindedAt: Date | null
  everyDays: number
}

const IST_MS = 5.5 * 3600_000

/** YYYY-MM-DD in India for this instant. */
export const istDay = (now: Date): string => new Date(now.getTime() + IST_MS).toISOString().slice(0, 10)
export const istHour = (now: Date): number => new Date(now.getTime() + IST_MS).getUTCHours()

export function isDaytime(now: Date): boolean {
  const h = istHour(now)
  return h >= SEND_FROM_HOUR && h < SEND_UNTIL_HOUR
}

export function dueForReminder(c: ReminderCandidate, now: Date): boolean {
  if (!isDaytime(now)) return false
  if (c.balancePaise <= 0) return false
  const every = Math.max(1, c.everyDays) * 86_400_000
  return !c.lastRemindedAt || now.getTime() - c.lastRemindedAt.getTime() >= every
}
