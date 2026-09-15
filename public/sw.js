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
// CACHE_VERSION is stamped with a fresh build ID at build time (see
// scripts/stamp-sw.js, run automatically after `vite build`) so every
// deploy gets its own cache namespace — the activate handler below then
// deletes any other version it finds, so old deploys' cached assets
// don't just pile up in storage forever as new hashed bundle files ship
// on top of them build after build.
const CACHE_VERSION = 'pace-__BUILD_ID__'

// Stamped at build time alongside CACHE_VERSION. Needed for the fully-
// closed-app notification fallback below, which talks to the database
// directly over REST rather than through the Firebase SDK.
const DATABASE_URL = '__DATABASE_URL__'

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

// --- Persistent session notification: Pause/Resume button --------------
//
// Tapping the button follows one of two paths:
//   1. An open tab exists (even backgrounded/hidden, just not force-
//      closed) — hand it off via postMessage and let the app's own
//      pauseLocal/resumeLocal run, exactly like the on-screen button.
//      This is the reliable path and covers the common case of someone
//      switching apps or locking their phone without actually closing
//      Pace.
//   2. No open tab at all — fall back to a direct database write over
//      REST, using a Firebase ID token the main app keeps cached in
//      IndexedDB for exactly this situation (see src/lib/tokenCache.js).
//      A cached token still expires roughly hourly; if it's stale, the
//      write fails and a plain notification explains that instead of
//      silently doing nothing. The resolved result is also mirrored into
//      the IndexedDB handoff store (see src/lib/sessionHandoff.js) so
//      that when the app is next opened, it adopts this change instead
//      of blindly re-uploading whatever stale local snapshot it had from
//      before it closed — see useActiveSession.js's reconciliation.
//
// The REST fallback deliberately updates only status/pausedAt/
// pausedSeconds/activeSince — everything needed for the toggle to work
// and for the eventual saved duration to stay correct — and skips the
// day/week "banked" bookkeeping lib/sessionMath.js also does at pause
// time. That bookkeeping only affects the live "today" preview's
// precision for other people viewing the group while this session is
// still in progress, not anything permanent, and fully re-syncs itself
// the next time the app is opened normally. Re-implementing that whole
// subsystem a second time here, in a context that can't import the
// original, wasn't worth it for a narrow, self-correcting edge case.

const NOTIFICATION_TAG = 'pace-session'

// Duplicate of src/lib/sessionHandoff.js's schema and write logic — this
// is a plain (non-module) service worker and can't import that file
// directly. DB_NAME/store name and the {session, updatedAt} shape must
// be kept in sync with that file by hand if either ever changes.
const HANDOFF_DB_NAME = 'pace-session-handoff'
const HANDOFF_STORE = 'session'

function writeHandoffFromSw(uid, session, updatedAt) {
  return new Promise((resolve) => {
    const req = indexedDB.open(HANDOFF_DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(HANDOFF_STORE)
    req.onsuccess = () => {
      const idb = req.result
      try {
        const tx = idb.transaction(HANDOFF_STORE, 'readwrite')
        tx.objectStore(HANDOFF_STORE).put({ session, updatedAt }, uid)
        tx.oncomplete = () => { resolve(); idb.close() }
        tx.onerror = () => { resolve(); idb.close() } // best-effort — see src/lib/sessionHandoff.js's comment
      } catch {
        resolve()
      }
    }
    req.onerror = () => resolve()
  })
}

// Duplicate of src/lib/tokenCache.js's read side — this is a plain
// (non-module) service worker and can't import that file directly. Must
// be kept in sync by hand if that file's schema ever changes.
function readAuthCache() {
  return new Promise((resolve) => {
    const req = indexedDB.open('pace-auth-cache', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('tokens')
    req.onsuccess = () => {
      const db = req.result
      try {
        const getReq = db.transaction('tokens', 'readonly').objectStore('tokens').get('current')
        getReq.onsuccess = () => { resolve(getReq.result || null); db.close() }
        getReq.onerror = () => { resolve(null); db.close() }
      } catch {
        resolve(null)
      }
    }
    req.onerror = () => resolve(null)
  })
}

async function fetchServerNow(databaseURL) {
  try {
    const res = await fetch(`${databaseURL}/.info/serverTimeOffset.json`)
    const offset = await res.json()
    return Date.now() + (typeof offset === 'number' ? offset : 0)
  } catch {
    return Date.now() // best-effort — a few minutes of clock skew here is a much smaller problem than the action not working at all
  }
}

function showFallbackFailureNotification() {
  return self.registration.showNotification('Pace', {
    tag: NOTIFICATION_TAG,
    body: "Couldn't update your session — open Pace to continue",
    requireInteraction: true,
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
  })
}

async function toggleSessionViaRest() {
  const cache = await readAuthCache()
  if (!cache?.token || !cache?.uid) return showFallbackFailureNotification()

  const { uid, token } = cache
  // Falls back to the build-time-stamped value if the cache somehow has a
  // token but no databaseURL (e.g. a token cached under an older schema,
  // before that field was added here) — otherwise there'd be no way to
  // reach the database at all in that case.
  const databaseURL = cache.databaseURL || DATABASE_URL
  const sessionUrl = `${databaseURL}/activeSessions/${uid}.json?auth=${token}`

  try {
    const res = await fetch(sessionUrl)
    if (!res.ok) throw new Error('session fetch failed')
    const session = await res.json()
    if (!session) return // nothing active to toggle — notification is stale, leave it

    const now = await fetchServerNow(databaseURL)
    // `patch` is what's actually sent to Firebase — '.sv' server-value
    // sentinels there let Firebase itself correct for clock skew.
    // `resolved` is the same update with concrete numbers instead of
    // those sentinels, since a raw '.sv' placeholder object isn't a real
    // timestamp and can't be handed to the page via the IndexedDB
    // handoff below.
    let patch
    let resolved
    if (session.status === 'active') {
      patch = { status: 'paused', pausedAt: { '.sv': 'timestamp' } }
      resolved = { status: 'paused', pausedAt: now }
    } else if (session.status === 'paused' || session.status === 'onBreak') {
      const spent = Math.max(0, (now - Number(session.pausedAt || now)) / 1000)
      const pausedSeconds = (Number(session.pausedSeconds) || 0) + spent
      patch = {
        status: 'active', pausedAt: null, pausedSeconds, activeSince: { '.sv': 'timestamp' },
      }
      resolved = { ...patch, activeSince: now }
    } else {
      return // stopped, or an unrecognized status — nothing sensible to toggle
    }

    const patchRes = await fetch(sessionUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!patchRes.ok) throw new Error('patch failed')

    await writeHandoffFromSw(uid, { ...session, ...resolved }, now)

    await self.registration.showNotification('Pace', {
      tag: NOTIFICATION_TAG,
      body: 'Your session is still running',
      requireInteraction: true,
      silent: true,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      actions: [{ action: 'toggle', title: patch.status === 'active' ? 'Pause' : 'Resume' }],
    })
  } catch {
    await showFallbackFailureNotification()
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  if (event.action === 'toggle') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        if (clientList.length > 0) {
          clientList[0].postMessage({ type: 'pace-notification-toggle' })
          return undefined
        }
        return toggleSessionViaRest()
      }),
    )
    return
  }

  // Clicked the notification body itself (not the action button) —
  // focus an existing tab if one's open, otherwise open a new one.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus()
      }
      return self.clients.openWindow ? self.clients.openWindow('./') : undefined
    }),
  )
})
