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
  const [session, setSession] = useState(() => {
    if (!user) return undefined
    const cached = readCached(user.uid)
    // No cache and no network to ask Firebase — assume "no active session"
    // rather than showing a loading skeleton with nothing that will ever
    // resolve it.
    if (cached === undefined && !navigator.onLine) return null
    return cached
  })

  useEffect(() => {
    if (!user) return
    setSession(readCached(user.uid))
    const sessRef = ref(db, `activeSessions/${user.uid}`)
    const unsub = onValue(sessRef, (snap) => {
      const value = snap.exists() ? snap.val() : null
      setSession(value)
      writeCached(user.uid, value)
    })
    return unsub
  }, [user])

  return session
}
