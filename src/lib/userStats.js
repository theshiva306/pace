import { ref, get, set } from 'firebase/database'
import { db } from '../firebase'

// Rebuilds the public study totals from the user's private completed
// sessions. This makes old history survive group deletion and lets a
// newly joined group read the same source of truth as every other group.
//
// Splits by sessionType as it goes: userStats/$uid (group-readable, feeds
// rankings/leaderboards) only ever accumulates 'focus' sessions — a
// semi-focus session (lectures, coaching, anything that isn't itself
// being tested) was never meant to count toward how someone ranks
// against their group. Everything semi-focus instead accumulates into
// userStatsPersonal/$uid, a separate path that's owner-read-only (see
// database.rules.json) — for the person's own view of their full study
// time, never anyone else's. Putting these in one path with per-field
// rules wouldn't actually work here: Realtime Database only enforces a
// child's stricter .read rule when a client queries that exact child
// path, not when a client reads the parent as a whole — so a genuinely
// private aggregate needs its own top-level path, not just a "private"
// key nested under the group-readable one.
export async function ensureUserStats(uid) {
  if (!uid) return
  const snap = await get(ref(db, `completedSessions/${uid}`))
  const sessions = snap.val() || {}
  const totals = {
    focus: { weeklyTotals: {}, weeklySessionCounts: {}, dailyTotals: {} },
    semiFocus: { weeklyTotals: {}, weeklySessionCounts: {}, dailyTotals: {} },
  }

  for (const session of Object.values(sessions)) {
    if (!session) continue
    // Sessions saved before sessionType existed default to 'focus' — same
    // backward-compat convention used everywhere else this field appears.
    const bucket = session.sessionType === 'semiFocus' ? totals.semiFocus : totals.focus

    // Current shape: a session's duration is split across the actual
    // day(s)/week(s) it was earned on (see computeDaySplit/computeWeekSplit
    // in sessionMath.js) rather than lumped entirely onto whichever day it
    // happened to be saved on.
    if (session.dailyBreakdown && session.weeklyBreakdown) {
      for (const [day, seconds] of Object.entries(session.dailyBreakdown)) {
        bucket.dailyTotals[day] = (bucket.dailyTotals[day] || 0) + Math.max(0, Number(seconds) || 0)
      }
      for (const [week, seconds] of Object.entries(session.weeklyBreakdown)) {
        bucket.weeklyTotals[week] = (bucket.weeklyTotals[week] || 0) + Math.max(0, Number(seconds) || 0)
      }
      // A session counts once towards "number of sessions" for whichever
      // week its most recent (largest) portion falls in — matches how a
      // single session felt to the person, rather than double-counting a
      // midnight-spanning session as two separate sessions.
      const mainWeek = Object.entries(session.weeklyBreakdown).sort((a, b) => b[1] - a[1])[0]?.[0]
      if (mainWeek) bucket.weeklySessionCounts[mainWeek] = (bucket.weeklySessionCounts[mainWeek] || 0) + 1
      continue
    }

    // Legacy shape (sessions saved before this split existed): a single
    // dayId/weekId for the entire duration. Kept working rather than
    // losing old history — these just don't get the retroactive split,
    // since we have no record of which portion happened on which day.
    if (!session.weekId || !session.dayId) continue
    const seconds = Math.max(0, Number(session.durationSeconds) || 0)
    bucket.weeklyTotals[session.weekId] = (bucket.weeklyTotals[session.weekId] || 0) + seconds
    bucket.weeklySessionCounts[session.weekId] = (bucket.weeklySessionCounts[session.weekId] || 0) + 1
    bucket.dailyTotals[session.dayId] = (bucket.dailyTotals[session.dayId] || 0) + seconds
  }

  await Promise.all([
    set(ref(db, `userStats/${uid}`), { ...totals.focus, updatedAt: Date.now() }),
    set(ref(db, `userStatsPersonal/${uid}`), { ...totals.semiFocus, updatedAt: Date.now() }),
  ])
}
