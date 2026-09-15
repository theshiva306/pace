import { useEffect, useRef } from 'react'
import { useOnlineStatus } from './useOnlineStatus'
import { syncActiveSession, flushPendingCompletedSessions } from '../lib/sessionSync'

// Pushes whatever changed locally (see lib/localSession.js and
// lib/pendingCompleted.js) up to Firebase as soon as a connection is
// available: on mount if already online, whenever online status flips
// from offline to online, and on tab focus/visibility — a phone
// reconnecting to data while Pace was merely backgrounded doesn't
// always fire a fresh browser 'online' event, so focus is the more
// reliable everyday signal on mobile.
export function useSessionSync(uid) {
  const { online } = useOnlineStatus()
  const runningRef = useRef(false)

  function attempt() {
    if (!uid || runningRef.current) return
    runningRef.current = true
    syncActiveSession(uid)
      .then(() => flushPendingCompletedSessions(uid))
      .catch(() => {}) // offline again mid-flush, or a transient error — the next trigger (reconnect/focus) retries
      .finally(() => { runningRef.current = false })
  }

  useEffect(() => {
    if (uid && online) attempt()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- attempt is a fresh closure every render, intentionally omitted; only uid/online should retrigger this
  }, [uid, online])

  useEffect(() => {
    if (!uid) return
    function onWake() {
      if (navigator.onLine) attempt()
    }
    window.addEventListener('focus', onWake)
    document.addEventListener('visibilitychange', onWake)
    return () => {
      window.removeEventListener('focus', onWake)
      document.removeEventListener('visibilitychange', onWake)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid])
}
