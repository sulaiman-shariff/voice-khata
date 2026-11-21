/**
 * Browser-side logging for the voice client and app. Warnings and errors always go to the console;
 * info and debug lines only when switched on: `?log=1` in the URL (remembered on this device,
 * `?log=0` turns it off) or "Debug logs" in Settings. Lines look like
 *   [vk +12.345s] socket_open {"ms":312}
 */
const KEY = 'vk-log'
const t0 = performance.now()

function initial(): boolean {
  try {
    const q = new URLSearchParams(location.search).get('log')
    if (q === '1' || q === '0') localStorage.setItem(KEY, q)
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

let on = initial()

type Fields = Record<string, unknown>
const stamp = () => `[vk +${((performance.now() - t0) / 1000).toFixed(3)}s]`

export const clientLog = {
  get enabled() {
    return on
  },
  set(enabled: boolean) {
    on = enabled
    try {
      localStorage.setItem(KEY, enabled ? '1' : '0')
    } catch { /* private mode: in memory only */ }
  },
  debug(ev: string, f?: Fields) {
    if (on) console.debug(stamp(), ev, f ?? '')
  },
  info(ev: string, f?: Fields) {
    if (on) console.info(stamp(), ev, f ?? '')
  },
  warn(ev: string, f?: Fields) {
    console.warn(stamp(), ev, f ?? '')
  },
  error(ev: string, f?: Fields) {
    console.error(stamp(), ev, f ?? '')
  },
}
