import { useEffect, useState } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import {
  readLocalSession, writeLocalSession, readLocalUpdatedAt, isDirty, clearDirty, LOCAL_SESSION_CHANGE_EVENT,
} from '../lib/localSession'
import { readHandoff } from '../lib/sessionHandoff'

// Local-first: lib/localSession.js is the authoritative source for "is
// my timer running right now" — every timer action writes there
// synchronously, offline or not, so the Timer screen never depends on a
// network round-trip to reflect what just happened. Firebase is still
// subscribed to here for two reasons: (1) it's how this device finds out
// about a session started on another device, and (2) it's the channel
// lib/sessionSync.js uses to push local changes up once online.
//
// While this device has unsynced local changes (isDirty), an incoming
// Firebase value is deliberately NOT adopted — it's necessarily stale
// relative to what's actually happening here, and adopting it would
// overwrite, say, a pause that hasn't reached the server yet. Once
// sessionSync.js's push lands and clears the dirty flag, Firebase's own
// echo of that same data flows back through and is adopted harmlessly
// (it matches what's already showing).
export function useActiveSession() {
  const { user } = useAuth()
  const uid = user?.uid
  const [session, setSession] = useState(() => (uid ? readLocalSession(uid) : undefined))

  useEffect(() => {
    if (!uid) return
    setSession(readLocalSession(uid))

    function onLocalChange(e) {
      if (e.detail?.uid !== uid) return
      setSession(readLocalSession(uid))
    }
    window.addEventListener(LOCAL_SESSION_CHANGE_EVENT, onLocalChange)

    const sessRef = ref(db, `activeSessions/${uid}`)
    const unsub = onValue(sessRef, (snap) => {
      if (isDirty(uid)) return // local has unsynced changes — don't let a stale remote value clobber them
      const value = snap.exists() ? snap.val() : null
      setSession(value)
      writeLocalSession(uid, value)
    })

    // Reconciles against the service worker's IndexedDB handoff (see
    // lib/sessionHandoff.js) — catches the one case the Firebase listener
    // above can't: the notification's Pause/Resume button was tapped
    // while Pace was fully closed AND this device already had an
    // unsynced local change from before it closed. Deliberately timestamp
    // -based rather than gated on isDirty — whichever of "the local
    // change" or "the notification tap" actually happened more recently
    // is the one that should win, and the handoff's own updatedAt is the
    // only reliable way to tell which that was. Adopting it also clears
    // dirty: the service worker already pushed that exact state to
    // Firebase directly over REST, so there's nothing left to sync.
    let cancelled = false
    readHandoff(uid).then((handoff) => {
      if (cancelled || !handoff) return
      if (handoff.updatedAt > readLocalUpdatedAt(uid)) {
        writeLocalSession(uid, handoff.session, handoff.updatedAt)
        clearDirty(uid)
        setSession(handoff.session)
      }
    })

    return () => {
      cancelled = true
      window.removeEventListener(LOCAL_SESSION_CHANGE_EVENT, onLocalChange)
      unsub()
    }
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
