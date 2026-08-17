import { useEffect, useState } from 'react'
import { useServerOffset } from './useServerOffset'

// Ticks once a second and derives every time value for an active session
// straight from its raw timestamps + accumulated pause time, rather than
// accumulating anything locally — so refresh / tab-switch / a stale tab
// left open all stay correct, same principle as the old useElapsed.
//
// session: { startedAt, status: 'active'|'paused'|'onBreak', pausedAt,
//            pausedSeconds, breakDurationSeconds }
export function useSessionClock(session) {
  const offset = useServerOffset()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!session) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [session?.sessionId])

  if (!session) {
    return { focusElapsed: 0, breakRemaining: 0, isPaused: false, isOnBreak: false }
  }

  const serverNow = now + offset
  const isPaused = session.status === 'paused'
  const isOnBreak = session.status === 'onBreak'
  const pausedSeconds = session.pausedSeconds || 0

  // While active: count up from startedAt, minus every completed pause
  // span. While paused/on break: frozen at the moment the pause began —
  // it does not keep counting during the pause.
  const focusElapsed = isPaused || isOnBreak
    ? Math.max(0, (session.pausedAt - session.startedAt) / 1000 - pausedSeconds)
    : Math.max(0, (serverNow - session.startedAt) / 1000 - pausedSeconds)

  const breakRemaining = isOnBreak
    ? Math.max(0, (session.breakDurationSeconds || 0) - (serverNow - session.pausedAt) / 1000)
    : 0

  return { focusElapsed, breakRemaining, isPaused, isOnBreak }
}
