import { useEffect, useState } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'

function storageKey(uid) {
  return `pace:activeSession:${uid}`
}

// Best-effort local backup of the active session, so the Timer can boot
// instantly from the last known state instead of sitting on a loading
// skeleton while waiting for a network connection that may not exist.
function readCached(uid) {
  try {
    const raw = localStorage.getItem(storageKey(uid))
    return raw ? JSON.parse(raw) : undefined
  } catch {
    return undefined
  }
}

function writeCached(uid, value) {
  try {
    if (value) localStorage.setItem(storageKey(uid), JSON.stringify(value))
    else localStorage.removeItem(storageKey(uid))
  } catch {
    // Storage can fail (private browsing, full quota) — the app still
    // works, it just loses this offline convenience, not correctness.
  }
}

// Subscribes to the current user's single active session. This is the
// refresh-safe source of truth for the Timer screen. Hydrates instantly
// from a local cache on mount so a fully offline reload still shows the
// running timer immediately, rather than blocking on Firebase reconnecting;
// Firebase's own onValue then reconciles with the authoritative state as
// soon as a connection is available (including any writes made while
// offline, which the SDK already queues and applies locally on its own).
export function useActiveSession() {
  const { user } = useAuth()
  const uid = user?.uid
  const [session, setSession] = useState(() => {
    if (!uid) return undefined
    const cached = readCached(uid)
    // No cache and no network to ask Firebase — assume "no active session"
    // rather than showing a loading skeleton with nothing that will ever
    // resolve it.
    if (cached === undefined && !navigator.onLine) return null
    return cached
  })

  useEffect(() => {
    if (!uid) return
    setSession(readCached(uid))
    const sessRef = ref(db, `activeSessions/${uid}`)
    const unsub = onValue(sessRef, (snap) => {
      const value = snap.exists() ? snap.val() : null
      setSession(value)
      writeCached(uid, value)
    })
    return unsub
    // Deliberately keyed on uid (a stable primitive), not the `user`
    // object itself — Firebase Auth emits a *new* User object reference
    // on every token refresh (roughly hourly, or on app refocus) even
    // for the same logged-in session. Depending on the object identity
    // was tearing down and rebuilding this subscription on every one of
    // those refreshes — visible as random loading flickers with nothing
    // to do with actual connection quality.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid])

  return session
}
