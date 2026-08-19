// Shared between useGroup.js (hides an abandoned session from the group's
// Live tab and totals) and Timer.jsx (prompts the owner to resolve their
// own abandoned session instead of silently showing a possibly day-old
// pause). Keeping the threshold in one place means the two can't drift
// apart and disagree on what counts as "abandoned."
export const STALE_PAUSE_MS = 3 * 60 * 60 * 1000 // 3 hours

export function isStaleSession(session, now) {
  if (!session) return false
  const isPausedOrBreak = session.status === 'paused' || session.status === 'onBreak'
  if (!isPausedOrBreak || !session.pausedAt) return false
  return now - Number(session.pausedAt) > STALE_PAUSE_MS
}
