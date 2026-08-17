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
    if (!session || !session.weekId || !session.dayId) continue
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
