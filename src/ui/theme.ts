import { syncStatusBar } from '../lib/native'

/** Colour schemes (tokens in src/index.css, one block per id). Swatch: primary, accent, background. */
export interface Theme { id: string; name: string; hint: string; dark: boolean; swatch: [string, string, string] }

export const THEMES: Theme[] = [
  { id: 'ivory', name: 'Ivory & Ink', hint: 'Navy ink, brass, warm paper', dark: false, swatch: ['#1f2a44', '#b08d57', '#f7f4ee'] },
  { id: 'sage', name: 'Sage', hint: 'Forest green, sand, soft grey', dark: false, swatch: ['#2e5446', '#b39a6b', '#f3f5f1'] },
  { id: 'rosewood', name: 'Rosewood', hint: 'Deep wine, champagne, blush', dark: false, swatch: ['#6e2c36', '#c2a06b', '#faf5f3'] },
  { id: 'midnight', name: 'Midnight Gold', hint: 'Dark · champagne gold', dark: true, swatch: ['#d6b98a', '#171a20', '#0f1115'] },
  { id: 'graphite', name: 'Graphite Teal', hint: 'Dark · muted teal', dark: true, swatch: ['#6bbfb2', '#c9b27e', '#121516'] },
]

const KEY = 'vk-theme'
/** ids used by the first version of the themes, mapped to their closest scheme now */
const OLD: Record<string, string> = { maroon: 'rosewood', emerald: 'sage', indigo: 'ivory', noir: 'midnight', peacock: 'graphite' }

export const themeId = (id: string | undefined): string => {
  const x = id ? OLD[id] ?? id : undefined
  return THEMES.some((t) => t.id === x) ? x! : THEMES[0].id
}

/** Set the scheme on <html>; remembered locally too so the first paint is already themed. */
export function applyTheme(id: string | undefined) {
  const t = THEMES.find((x) => x.id === themeId(id))!
  const root = document.documentElement
  root.dataset.theme = t.id
  root.classList.toggle('dark', t.dark)
  root.style.colorScheme = t.dark ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(root).getPropertyValue('--background').trim())
  try { localStorage.setItem(KEY, t.id) } catch { /* private mode */ }
  syncStatusBar()
}

/** Before React mounts: last scheme used on this phone. */
export function applySavedTheme() {
  let id: string | undefined
  try { id = localStorage.getItem(KEY) ?? undefined } catch { /* private mode */ }
  applyTheme(id)
}
