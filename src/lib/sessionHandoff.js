// A tiny IndexedDB mirror of the active session, used only to hand state
// between the service worker and the page — localStorage (the real
// source of truth, see lib/localSession.js) isn't reachable from a
// service worker, but IndexedDB is shared between both contexts.
//
// This store is NOT where the running timer lives; it exists purely so
// that when the notification's Pause/Resume button is tapped while Pace
// is fully closed (public/sw.js's REST fallback), and the app is opened
// again afterward, the page can tell that change happened and adopt it —
// instead of blindly re-uploading its own older localStorage snapshot
// and silently erasing whatever the notification just did. See
// useActiveSession.js for the adopt-on-open side of this.
//
// public/sw.js duplicates the read/write logic below by hand (it's a
// plain, non-module service worker and can't import this file) — DB_NAME
// and the object store name must stay in sync with the copy there.
export const HANDOFF_DB_NAME = 'pace-session-handoff'
export const HANDOFF_STORE = 'session'

function openHandoffDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDOFF_DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(HANDOFF_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function readHandoff(uid) {
  try {
    const db = await openHandoffDb()
    return await new Promise((resolve) => {
      const req = db.transaction(HANDOFF_STORE, 'readonly').objectStore(HANDOFF_STORE).get(uid)
      req.onsuccess = () => { resolve(req.result || null); db.close() }
      req.onerror = () => { resolve(null); db.close() }
    })
  } catch {
    return null // IndexedDB unavailable (rare) — reconciliation just finds nothing newer, same as before this feature existed
  }
}

// Fire-and-forget by design at every call site — this is a best-effort
// mirror, not something anything should ever block on.
export async function writeHandoff(uid, session, updatedAt) {
  try {
    const db = await openHandoffDb()
    await new Promise((resolve) => {
      const tx = db.transaction(HANDOFF_STORE, 'readwrite')
      tx.objectStore(HANDOFF_STORE).put({ session, updatedAt }, uid)
      tx.oncomplete = () => { resolve(); db.close() }
      tx.onerror = () => { resolve(); db.close() }
    })
  } catch {
    // best-effort — see readHandoff's comment
  }
}
