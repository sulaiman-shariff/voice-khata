/**
 * Where the server functions live, and the public site customers open.
 *
 * On the web the UI and the functions share one origin, so both are '' / this page. In the
 * Capacitor app the UI is served from inside the APK (https://localhost), so the build sets
 *   VITE_API_BASE=https://<deployed-site>      (functions + voice socket)
 *   VITE_PUBLIC_URL=https://<deployed-site>    (links sent to customers; defaults to VITE_API_BASE)
 */
const env = import.meta.env as Record<string, string | undefined>

export const API_BASE = (env.VITE_API_BASE ?? '').replace(/\/+$/, '')

/** `/api/remind` -> same origin on the web, the deployed site in the app. */
export const api = (path: string): string => `${API_BASE}${path}`

/** The voice WebSocket: VITE_VOICE_URL, else the API base, else this page. */
export function voiceUrl(): string {
  if (env.VITE_VOICE_URL) return env.VITE_VOICE_URL
  if (API_BASE) return `${API_BASE.replace(/^http/, 'ws')}/api/voice`
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/voice`
}

/** Base for links that customers open on their own phones (pay page, confirmation links). */
export function publicUrl(): string {
  return (env.VITE_PUBLIC_URL ?? (API_BASE || location.origin)).replace(/\/+$/, '')
}
