// Was independently duplicated in useGroup.js and usePolledValue.js —
// that's exactly how the earlier staleness bug ended up half-fixed (one
// copy patched, the other forgotten). One shared implementation now.

// Total elapsed focus time for a session, full stop — from whenever it
// actually started, regardless of what calendar day that was. Used for a
// session's own running total (e.g. the person's own Timer screen).
export function focusSeconds(session, now) {
  if (!session?.startedAt) return 0
  const total = Math.max(0, (now - Number(session.startedAt)) / 1000)
  const pausedBefore = Math.max(0, Number(session.pausedSeconds) || 0)
  const pausedNow = session.status !== 'active' && session.pausedAt
    ? Math.max(0, (now - Number(session.pausedAt)) / 1000)
    : 0
  return Math.floor(Math.max(0, total - pausedBefore - pausedNow))
}

// A session's contribution to *today's* total specifically — clipped at
// local midnight, so an overnight session that's still running doesn't
// keep inflating "today" with time that was actually earned yesterday.
//
// Computed as focusSeconds(now) − focusSeconds(as of midnight): the same
// formula evaluated at two points in time, subtracted. This correctly
// handles the common cases with no special-casing — a session paused
// before midnight and still paused now correctly contributes 0 to today
// (both terms come out equal, since nothing changes while paused); one
// that crossed midnight while running correctly contributes only the
// post-midnight portion; one that started today is unaffected.
//
// Known limitation: pausedSeconds is a single cumulative total with no
// per-cycle timestamps, so if a session has *multiple* pause/resume
// cycles straddling the midnight boundary specifically, this can be off
// by the size of whichever cycle it can't place in time. Correct for any
// single pause spanning midnight (by far the common case — one overnight
// break); exact precision beyond that would need per-cycle history we
// don't currently store.
export function todayFocusSeconds(session, now) {
  if (!session?.startedAt) return 0
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const asOfMidnight = focusSeconds(session, startOfToday.getTime())
  const asOfNow = focusSeconds(session, now)
  return Math.max(0, asOfNow - asOfMidnight)
}
