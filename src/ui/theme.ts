/** Colour schemes (tokens in src/index.css, one block per id). */
export interface Theme { id: string; name: string; dark: boolean; swatch: [string, string, string] }

export const THEMES: Theme[] = [
  { id: 'maroon', name: 'Bahi Maroon', dark: false, swatch: ['oklch(0.4 0.14 22)', 'oklch(0.72 0.12 80)', 'oklch(0.975 0.012 85)'] },
  { id: 'emerald', name: 'Emerald Ivory', dark: false, swatch: ['oklch(0.4 0.09 165)', 'oklch(0.74 0.11 85)', 'oklch(0.975 0.01 130)'] },
  { id: 'indigo', name: 'Royal Indigo', dark: false, swatch: ['oklch(0.36 0.13 278)', 'oklch(0.75 0.11 80)', 'oklch(0.975 0.008 270)'] },
  { id: 'noir', name: 'Noir & Gold', dark: true, swatch: ['oklch(0.78 0.12 82)', 'oklch(0.21 0.008 80)', 'oklch(0.16 0.006 80)'] },
  { id: 'peacock', name: 'Midnight Peacock', dark: true, swatch: ['oklch(0.74 0.11 190)', 'oklch(0.8 0.11 85)', 'oklch(0.18 0.03 235)'] },
]

const KEY = 'vk-theme'

/** Set the scheme on <html>; remembered locally too so the first paint is already themed. */
export function applyTheme(id: string | undefined) {
  const t = THEMES.find((x) => x.id === id) ?? THEMES[0]
  const root = document.documentElement
  root.dataset.theme = t.id
  root.classList.toggle('dark', t.dark)
  root.style.colorScheme = t.dark ? 'dark' : 'light'
  try { localStorage.setItem(KEY, t.id) } catch { /* private mode */ }
}

/** Before React mounts: last scheme used on this phone. */
export function applySavedTheme() {
  let id: string | undefined
  try { id = localStorage.getItem(KEY) ?? undefined } catch { /* private mode */ }
  applyTheme(id)
}
