// Shared between useGroup.js (hides an abandoned session from the group's
// Live tab and totals) and Timer.jsx (prompts the owner to resolve their
// own abandoned session instead of silently showing a possibly day-old
// pause). Keeping the threshold in one place means the two can't drift
// apart and disagree on what counts as "abandoned."
export const STALE_PAUSE_MS = 3 * 60 * 60 * 1000 // 3 hours

// A device dying mid-focus — the app force-closed, the browser tab
// killed, the OS killing a backgrounded PWA — never gets a chance to
// call pauseSession(). Nothing else naturally ends an 'active' session,
// so unlike a pause (which has a clear "abandoned since" signal via
// pausedAt) it would otherwise sit at status: 'active' forever with no
// cutoff at all — showing up as a currently-focusing "ghost" on the
// Live tab indefinitely, including on days after the one it actually
// happened on. Much more generous than the pause threshold since a
// genuine long, uninterrupted study session is far more plausible than
// a genuine multi-hour dead pause — this exists purely to catch
// "abandoned since yesterday (or longer)," not to second-guess anyone's
// actual focus time.
export const STALE_ACTIVE_MS = 12 * 60 * 60 * 1000 // 12 hours

export function isStaleSession(session, now) {
  if (!session) return false
  if (session.status === 'active') {
    const activeSince = Number(session.activeSince ?? session.startedAt)
    return Number.isFinite(activeSince) && now - activeSince > STALE_ACTIVE_MS
  }
  const isPausedOrBreak = session.status === 'paused' || session.status === 'onBreak'
  if (!isPausedOrBreak || !session.pausedAt) return false
  return now - Number(session.pausedAt) > STALE_PAUSE_MS
}

// Whether a session should count as "focusing/paused/onBreak" for Live-tab
// style displays. Deliberately separate from the session's accumulated
// time: a paused session's elapsed-time contribution is already
// mathematically frozen the moment it's paused (the ongoing-real-time term
// and the paused-since term cancel out), so it never needs zeroing out —
// only the "is this person currently live" badge needs to stop being true
// once it's been abandoned.
export function isCurrentlyLive(session, now) {
  if (!session) return false
  if (!['active', 'paused', 'onBreak'].includes(session.status)) return false
  return !isStaleSession(session, now)
}
