/**
 * Which pages may call the functions, and CORS for the ones that are not same-origin.
 *
 * Same-origin: the Vercel site and local dev (localhost or a LAN address for a phone on the same
 * Wi-Fi). Cross-origin: the Capacitor Android/iOS app, whose WebView serves the UI from
 * https://localhost (Android) or capacitor://localhost (iOS) and calls the deployed API
 * (VITE_API_BASE). More origins: ALLOWED_ORIGINS="https://a.example,https://b.example".
 */
const BUILT_IN = /^https:\/\/voice-khata[a-z0-9-]*\.vercel\.app$|^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.\d+\.\d+\.\d+)(:\d+)?$|^(capacitor|ionic):\/\/localhost$/

export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return true // scripts and server-to-server calls send no Origin (the eval harness)
  if (BUILT_IN.test(origin)) return true
  return (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean).includes(origin)
}

/** Wrap a fetch handler: refuse unknown origins, answer preflights, add CORS headers. */
export function cors(handle: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    const origin = req.headers.get('origin')
    if (!isAllowedOrigin(origin)) return new Response(JSON.stringify({ error: 'origin not allowed' }), { status: 403, headers: { 'content-type': 'application/json' } })
    const extra: Record<string, string> = origin
      ? { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS', 'access-control-allow-headers': 'content-type, authorization', 'access-control-max-age': '86400' }
      : {}
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: extra })
    const res = await handle(req)
    const headers = new Headers(res.headers)
    for (const [k, v] of Object.entries(extra)) headers.set(k, v)
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  }
}
