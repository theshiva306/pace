// Minimal service worker. Its only job right now is to exist — Chrome and
// other browsers require an active service worker with a fetch handler
// before they'll offer the "Install app" prompt. It deliberately does NOT
// cache anything yet: every request just passes straight through to the
// network, so there is zero risk of it ever serving someone a stale,
// broken copy of the app. Offline caching can be added later, deliberately
// and carefully, once this baseline has been live for a while.
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request))
})
