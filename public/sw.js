// Minimal service worker: cache-first for the wake-word model and onnxruntime WASM only.
// The app shell is deliberately NOT cached (avoids stale-app bugs).
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

function cacheable(url) {
  return url.origin === self.location.origin && (url.pathname.startsWith('/wakeword/') || url.pathname.endsWith('.wasm'))
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || !cacheable(new URL(req.url))) return
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req)
      if (hit) return hit
      const res = await fetch(req)
      // Never cache a missing model (SPA fallback returns html with 200).
      const type = res.headers.get('content-type') || ''
      if (res.ok && !type.includes('text/html')) cache.put(req, res.clone())
      return res
    }),
  )
})
