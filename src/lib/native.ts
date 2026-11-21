import { App } from '@capacitor/app'
import { AppLauncher } from '@capacitor/app-launcher'
import { Capacitor } from '@capacitor/core'
import { SplashScreen } from '@capacitor/splash-screen'
import { StatusBar, Style } from '@capacitor/status-bar'
import { KeepAwake } from '@capacitor-community/keep-awake'

/** True inside the Android app; every call below is a no-op (or the plain web behaviour) on the web. */
export const isNative = Capacitor.isNativePlatform()

const web = (url: string) => { window.open(url, '_blank', 'noopener') }

/** Open a link; in the app https://wa.me goes straight to WhatsApp. */
export function openExternal(url: string): void {
  if (!isNative) return web(url)
  // openUrl resolves completed:false (not a rejection) when no app takes the link
  try { AppLauncher.openUrl({ url }).then((r) => { if (!r.completed) web(url) }, () => web(url)) } catch { web(url) }
}

export function keepAwake(on: boolean): void {
  if (!isNative) return
  try { (on ? KeepAwake.keepAwake() : KeepAwake.allowSleep()).catch(() => {}) } catch { /* plugin missing */ }
}

/** Any CSS colour (hex, oklch…) as #rrggbb, by painting it on a 1x1 canvas. */
function toHex(css: string): string {
  const fallback = '#f7f4ee'
  if (/^#[0-9a-f]{6}$/i.test(css)) return css
  try {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    if (!ctx) return fallback
    ctx.canvas.width = ctx.canvas.height = 1
    ctx.fillStyle = css
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
  } catch { return fallback }
}

/** Paint the Android status bar to match the current theme. */
export function syncStatusBar(): void {
  if (!isNative) return
  try {
    const root = document.documentElement
    const color = toHex(getComputedStyle(root).getPropertyValue('--background').trim())
    const dark = root.classList.contains('dark')
    StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {})
    StatusBar.setBackgroundColor({ color }).catch(() => {})
    StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {})
  } catch { /* plugin missing */ }
}

/** Android back button: handler closes the top layer and returns true; false minimises the app. */
export function onBackButton(handler: () => boolean): () => void {
  if (!isNative) return () => {}
  const h = App.addListener('backButton', () => { if (!handler()) App.minimizeApp().catch(() => {}) })
  return () => { void h.then((x) => x.remove()).catch(() => {}) }
}

export function hideSplash(): void {
  if (!isNative) return
  try { SplashScreen.hide().catch(() => {}) } catch { /* plugin missing */ }
}
