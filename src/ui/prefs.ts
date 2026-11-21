import type { Settings } from '@/lib/contracts'

/** "Bolkar batao payment": payments that land are announced aloud. On unless turned off. */
export const announceOn = (st: Settings) => st.announcePayments !== false
