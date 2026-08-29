import { dayId } from './day.js'
import { isoWeekId, weekStart } from './week.js'

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

// Sessions that existed before this banking system shipped have no
// bankedDayId/bankedWeekId yet — falling straight through to "banked = 0"
// for those would make an already-paused pre-existing session's real,
// already-earned time vanish from today's/this week's live number until
// its next pause/resume happens to populate real values. Falls back to
// reconstructing from the single cumulative pause counter instead: exact
// whenever the *current* pause doesn't itself straddle the boundary
// (session paused this side of midnight/Monday — the ordinary case), and
// still correctly yields 0 for a pause that started before the boundary
// and is still ongoing (focusSeconds is time-invariant while paused, so
// both terms below come out equal). Only wrong for the narrower case
// this whole system was built to fix — a pause that itself spans the
// boundary and has since been *resumed* — for pre-existing data
// specifically; that self-heals the moment that session's next pause or
// break banks a real, precise value going forward.
function legacyBoundaryFallback(session, now, boundaryMs) {
  return Math.max(0, focusSeconds(session, now) - focusSeconds(session, boundaryMs))
}

export function todayFocusSeconds(session, now) {
  if (!session?.startedAt) return 0
  if (session.bankedDayId == null) return Math.floor(legacyBoundaryFallback(session, now, startOfDayMs(now)))
  const todayId = dayId(new Date(now))
  const banked = session.bankedDayId === todayId ? Math.max(0, Number(session.bankedDaySeconds) || 0) : 0
  const ongoing = liveSinceBoundary(session, now, startOfDayMs(now))
  return Math.floor(banked + ongoing)
}

export function thisWeekFocusSeconds(session, now) {
  if (!session?.startedAt) return 0
  const weekBoundaryMs = weekStart(0, new Date(now)).getTime()
  if (session.bankedWeekId == null) return Math.floor(legacyBoundaryFallback(session, now, weekBoundaryMs))
  const weekId = isoWeekId(new Date(now))
  const banked = session.bankedWeekId === weekId ? Math.max(0, Number(session.bankedWeekSeconds) || 0) : 0
  const ongoing = liveSinceBoundary(session, now, weekBoundaryMs)
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

// --- Splitting a session's final saved duration across days/weeks ---
//
// Everything above is about the *live preview* shown while a session is
// still going. This is about what actually gets permanently saved:
// saveSession() previously wrote a session's entire durationSeconds to a
// single dayId/weekId — whichever day it happened to be *saved* on, not
// necessarily the day(s) it was actually earned on. A session started at
// 11pm and saved at 1am got its full duration credited to the day
// containing 1am, silently moving the pre-midnight hour's worth of focus
// onto the wrong day (and taking it away from the day it actually
// happened on). Same problem for a paused-before-midnight session
// resolved (saved) the next day: its entire duration used to land on the
// resolution day instead of the day it was actually focused.
//
// Splits into at most two buckets — "the most recent day/week" (precisely
// known via bankedDayId/bankedDaySeconds, which stopSession() already
// guarantees is fresh at the moment of stopping) and "everything before
// that" (durationSeconds minus the most-recent bucket, attributed to
// firstDayId/firstWeekId — the day/week the session actually started on).
// This is exact for the realistic case of a session spanning at most one
// day/week boundary, which covers every scenario a real study session
// produces (nobody leaves a single continuous session open across three or
// more calendar days without ever stopping it). A session spanning three
// or more distinct days would have its middle day(s) folded into
// firstDayId rather than their own buckets — a known, narrow limitation
// of not storing full per-day interval history, traded for not needing a
// bigger architecture change to fix the reported bug.
export function computeDaySplit(session, durationSeconds) {
  const recentId = session.bankedDayId ?? dayId(new Date(session.startedAt))
  const recentSeconds = Math.min(durationSeconds, Math.max(0, Number(session.bankedDaySeconds) || 0))
  const firstId = session.firstDayId ?? dayId(new Date(session.startedAt))
  const priorSeconds = Math.max(0, durationSeconds - recentSeconds)

  if (priorSeconds === 0 || firstId === recentId) {
    return { [recentId]: durationSeconds }
  }
  return { [firstId]: priorSeconds, [recentId]: recentSeconds }
}

export function computeWeekSplit(session, durationSeconds) {
  const recentId = session.bankedWeekId ?? isoWeekId(new Date(session.startedAt))
  const recentSeconds = Math.min(durationSeconds, Math.max(0, Number(session.bankedWeekSeconds) || 0))
  const firstId = session.firstWeekId ?? isoWeekId(new Date(session.startedAt))
  const priorSeconds = Math.max(0, durationSeconds - recentSeconds)

  if (priorSeconds === 0 || firstId === recentId) {
    return { [recentId]: durationSeconds }
  }
  return { [firstId]: priorSeconds, [recentId]: recentSeconds }
}
