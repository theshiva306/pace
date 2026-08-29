import { ref, get, set } from 'firebase/database'
import { db } from '../firebase'

// Rebuilds the public study totals from the user's private completed sessions.
// This makes old history survive group deletion and lets a newly joined group
// read the same source of truth as every other group.
export async function ensureUserStats(uid) {
  if (!uid) return
  const snap = await get(ref(db, `completedSessions/${uid}`))
  const sessions = snap.val() || {}
  const weeklyTotals = {}
  const weeklySessionCounts = {}
  const dailyTotals = {}

  for (const session of Object.values(sessions)) {
    if (!session) continue

    // Current shape: a session's duration is split across the actual
    // day(s)/week(s) it was earned on (see computeDaySplit/computeWeekSplit
    // in sessionMath.js) rather than lumped entirely onto whichever day it
    // happened to be saved on.
    if (session.dailyBreakdown && session.weeklyBreakdown) {
      for (const [day, seconds] of Object.entries(session.dailyBreakdown)) {
        dailyTotals[day] = (dailyTotals[day] || 0) + Math.max(0, Number(seconds) || 0)
      }
      for (const [week, seconds] of Object.entries(session.weeklyBreakdown)) {
        weeklyTotals[week] = (weeklyTotals[week] || 0) + Math.max(0, Number(seconds) || 0)
      }
      // A session counts once towards "number of sessions" for whichever
      // week its most recent (largest) portion falls in — matches how a
      // single session felt to the person, rather than double-counting a
      // midnight-spanning session as two separate sessions.
      const mainWeek = Object.entries(session.weeklyBreakdown).sort((a, b) => b[1] - a[1])[0]?.[0]
      if (mainWeek) weeklySessionCounts[mainWeek] = (weeklySessionCounts[mainWeek] || 0) + 1
      continue
    }

    // Legacy shape (sessions saved before this split existed): a single
    // dayId/weekId for the entire duration. Kept working rather than
    // losing old history — these just don't get the retroactive split,
    // since we have no record of which portion happened on which day.
    if (!session.weekId || !session.dayId) continue
    const seconds = Math.max(0, Number(session.durationSeconds) || 0)
    weeklyTotals[session.weekId] = (weeklyTotals[session.weekId] || 0) + seconds
    weeklySessionCounts[session.weekId] = (weeklySessionCounts[session.weekId] || 0) + 1
    dailyTotals[session.dayId] = (dailyTotals[session.dayId] || 0) + seconds
  }

  await set(ref(db, `userStats/${uid}`), {
    weeklyTotals,
    weeklySessionCounts,
    dailyTotals,
    updatedAt: Date.now(),
  })
}
