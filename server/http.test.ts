import { describe, expect, it } from 'vitest'
import { cors, isAllowedOrigin } from './http.js'

describe('origins and CORS', () => {
  it('allows the site, local dev and the Capacitor app; refuses others', () => {
    for (const o of ['https://voice-khata-delta.vercel.app', 'http://localhost:5173', 'http://192.168.1.20:5173', 'https://localhost', 'capacitor://localhost', null])
      expect(isAllowedOrigin(o)).toBe(true)
    for (const o of ['https://evil.example', 'https://voice-khata.evil.example', 'http://localhost.evil.example'])
      expect(isAllowedOrigin(o)).toBe(false)
  })
  it('answers preflight and adds CORS headers for the app origin', async () => {
    const h = cors(async () => new Response('{}', { status: 200 }))
    const pre = await h(new Request('http://x/api/remind', { method: 'OPTIONS', headers: { origin: 'https://localhost' } }))
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-origin')).toBe('https://localhost')
    const res = await h(new Request('http://x/api/remind', { headers: { origin: 'https://localhost' } }))
    expect(res.headers.get('access-control-allow-origin')).toBe('https://localhost')
    expect((await h(new Request('http://x/api/remind', { headers: { origin: 'https://evil.example' } }))).status).toBe(403)
  })
})
