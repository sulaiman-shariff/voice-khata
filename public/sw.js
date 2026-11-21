// Minimal service worker: caches the wake-word model and onnxruntime WASM/loader only.
// The app shell is deliberately NOT cached (avoids stale-app bugs).
// /wakeword/*: stale-while-revalidate (a retrained model reaches phones on the next load).
// ORT .wasm/.mjs: cache-first (content-hashed or versioned by the build).
const CACHE = 'khatabhai-wake-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

function kind(url) {
  if (url.origin !== self.location.origin) return null
  if (url.pathname.startsWith('/wakeword/')) return 'swr'
  if (url.pathname.endsWith('.wasm') || (url.pathname.includes('ort') && url.pathname.endsWith('.mjs'))) return 'cf'
  return null
}

// Never cache a missing model (SPA fallback returns html with 200).
function storable(res) {
  return res.ok && !(res.headers.get('content-type') || '').includes('text/html')
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const k = kind(new URL(req.url))
  if (!k) return
  e.respondWith(
    caches
      .open(CACHE)
      .then(async (cache) => {
        const hit = await cache.match(req)
        const refresh = () =>
          fetch(req).then((res) => {
            if (storable(res)) cache.put(req, res.clone())
            return res
          })
        if (hit) {
          if (k === 'swr') e.waitUntil(refresh().catch(() => {}))
          return hit
        }
        return refresh()
      })
      .catch(() => fetch(req)),
  )
})
