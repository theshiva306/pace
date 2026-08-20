import { dayId } from './day'
import { isoWeekId, weekStart } from './week'

// Was independently duplicated in useGroup.js and usePolledValue.js —
// that's exactly how the earlier staleness bug ended up half-fixed (one
// copy patched, the other forgotten). One shared implementation now.

// Total elapsed focus time for a session, full stop — from whenever it
// actually started, regardless of what calendar day that was. Used for a
// session's own running total (e.g. the person's own Timer screen), and
// for the final duration saved when a session is stopped. Unaffected by
// everything below — that's all purely about the *live preview* of
// "today"/"this week" shown elsewhere while a session is still going.
export function focusSeconds(session, now) {
  if (!session?.startedAt) return 0
  const total = Math.max(0, (now - Number(session.startedAt)) / 1000)
  const pausedBefore = Math.max(0, Number(session.pausedSeconds) || 0)
  const pausedNow = session.status !== 'active' && session.pausedAt
    ? Math.max(0, (now - Number(session.pausedAt)) / 1000)
    : 0
  return Math.floor(Math.max(0, total - pausedBefore - pausedNow))
}

export function startOfDayMs(now) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// --- Precise "today"/"this week" live totals ---
//
// A single cumulative pausedSeconds counter (used by focusSeconds above)
// has no record of *when* each pause happened, so it can't tell how much
// of a pause fell before vs. after a day/week boundary — any attempt to
// reconstruct that after the fact is necessarily an approximation that
// breaks on cases like "paused right before midnight, resumed after."
//
// Instead, each active streak's contribution to the current day/week is
// banked the moment the streak actually ends (see pauseSession/startBreak
// in lib/sessions.js, which call bankStreakUpdate at exactly that
// moment, when the precise start/end timestamps are still known). Two
// fields carry this forward on the session:
//   - activeSince: when the *current* streak began (set at start/resume)
//   - bankedDayId/bankedDaySeconds, bankedWeekId/bankedWeekSeconds:
//     finalized totals for whichever day/week they were last banked for
//
// At display time, "today" is just: the banked amount (if it's still for
// today — a stale bankedDayId from a previous day contributes nothing)
// plus, if the session is currently active, the portion of the ongoing
// streak that falls on/after today's boundary. No history reconstruction
// needed, so this is exact for any number of pause/resume cycles, not
// just the common single-overnight-pause case.

function liveSinceBoundary(session, now, boundaryMs) {
  if (session.status !== 'active') return 0
  const streakStart = Number(session.activeSince ?? session.startedAt)
  const clippedStart = Math.max(streakStart, boundaryMs)
  return Math.max(0, (now - clippedStart) / 1000)
}

export function todayFocusSeconds(session, now) {
  if (!session?.startedAt) return 0
  const todayId = dayId(new Date(now))
  const banked = session.bankedDayId === todayId ? Math.max(0, Number(session.bankedDaySeconds) || 0) : 0
  const ongoing = liveSinceBoundary(session, now, startOfDayMs(now))
  return Math.floor(banked + ongoing)
}

export function thisWeekFocusSeconds(session, now) {
  if (!session?.startedAt) return 0
  const weekId = isoWeekId(new Date(now))
  const banked = session.bankedWeekId === weekId ? Math.max(0, Number(session.bankedWeekSeconds) || 0) : 0
  const ongoing = liveSinceBoundary(session, now, weekStart(0, new Date(now)).getTime())
  return Math.floor(banked + ongoing)
}

// Used by lib/sessions.js at the moment a streak ends (pause/startBreak)
// to fold its exact contribution into the correct day/week bucket, given
// the precise timestamps available right then.
export function bankStreakUpdate(session, now) {
  const streakStart = Number(session.activeSince ?? session.startedAt)
  const todayId = dayId(new Date(now))
  const weekId = isoWeekId(new Date(now))

  const todayPortionSec = Math.max(0, (now - Math.max(streakStart, startOfDayMs(now))) / 1000)
  const weekPortionSec = Math.max(0, (now - Math.max(streakStart, weekStart(0, new Date(now)).getTime())) / 1000)

  const existingDaySeconds = session.bankedDayId === todayId ? Math.max(0, Number(session.bankedDaySeconds) || 0) : 0
  const existingWeekSeconds = session.bankedWeekId === weekId ? Math.max(0, Number(session.bankedWeekSeconds) || 0) : 0

  return {
    bankedDayId: todayId,
    bankedDaySeconds: existingDaySeconds + todayPortionSec,
    bankedWeekId: weekId,
    bankedWeekSeconds: existingWeekSeconds + weekPortionSec,
  }
}
