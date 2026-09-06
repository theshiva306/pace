// A service worker cannot use localStorage at all, and cannot rely on the
// main app's live Firebase Auth instance if the site is fully closed —
// but it CAN read IndexedDB, the one storage type both contexts share.
// This is what lets the notification's Pause/Resume button work even
// when there's no open tab: the main app keeps a reasonably fresh ID
// token cached here whenever it's authenticated, and the service worker
// reads it as a last-resort fallback for a direct REST API write when it
// can't find any open client to hand the action to instead (see sw.js).
//
// Known limitation: Firebase ID tokens expire roughly hourly. If the site
// has been fully closed for longer than that since the last refresh, the
// cached token here will have expired, and the background write will
// fail — the click handler falls back to a "couldn't reach it, please
// open Pace" notification in that case rather than silently doing
// nothing. There's no way to refresh a token with zero open tabs at all
// without a native background-refresh capability the web platform
// doesn't offer.

const DB_NAME = 'pace-auth-cache'
const STORE_NAME = 'tokens'
const KEY = 'current'

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveAuthCache({ uid, token, databaseURL }) {
  try {
    const db = await openDb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put({ uid, token, databaseURL, savedAt: Date.now() }, KEY)
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    // Best-effort only — worst case the background-notification fallback
    // doesn't have a token to use, same as if none had ever been cached.
  }
}

// This file is the main app's copy, used to WRITE the cache. public/sw.js
// is a plain (non-module) service worker and can't import this file — it
// has its own inline duplicate of the read logic that reads the exact
// same IndexedDB database/store/key defined here. If either the schema
// here or the constants below change, sw.js's copy needs updating too.
export async function readAuthCache() {
  try {
    const db = await openDb()
    const result = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(KEY)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
    db.close()
    return result
  } catch {
    return null
  }
}
