import { formatINR } from '../../shared/numbers.js'

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
