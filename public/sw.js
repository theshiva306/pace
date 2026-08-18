// App-shell caching: lets Pace load and run even with no network at all.
//
// Strategy — network-first, cache as you go, offline fallback:
//   - For every same-origin GET request, try the network first (so users
//     online always get the freshest build, never a stale cached one).
//   - On success, store a copy in the cache for next time.
//   - On failure (offline), serve the last cached copy of that exact
//     request if we have one.
//   - If it's a navigation (loading the app itself) and we have no cached
//     copy of that path either, fall back to the cached app shell
//     (index.html) so the app still boots and can restore state from
//     localStorage, instead of the browser showing its own offline error.
//
// CACHE_VERSION is bumped whenever this file changes so old, possibly
// stale caches get cleared out on the next visit — never serves last
// year's bundle forever.
const CACHE_VERSION = 'pace-v1'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)),
    )).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone()
        caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy))
        return response
      })
      .catch(async () => {
        const cached = await caches.match(request)
        if (cached) return cached
        if (request.mode === 'navigate') {
          const shell = await caches.match('./index.html') || await caches.match('./')
          if (shell) return shell
        }
        return Response.error()
      }),
  )
})
