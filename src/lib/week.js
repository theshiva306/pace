// ISO 8601 week id, e.g. "2026-W34". Weeks run Monday -> Sunday.
export function isoWeekId(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

// Milliseconds until the current ISO week ends (next Monday 00:00 local time).
export function msUntilWeekEnd(date = new Date()) {
  const day = date.getDay() || 7
  const next = new Date(date)
  next.setDate(date.getDate() + (8 - day))
  next.setHours(0, 0, 0, 0)
  return next.getTime() - date.getTime()
}

// Monday 00:00 local time of the ISO week `weeksAgo` weeks before the one
// containing `date` (0 = this week, 1 = last week, ...).
export function weekStart(weeksAgo = 0, date = new Date()) {
  const day = date.getDay() || 7 // 1 = Mon ... 7 = Sun
  const monday = new Date(date)
  monday.setHours(0, 0, 0, 0)
  monday.setDate(monday.getDate() - (day - 1) - weeksAgo * 7)
  return monday
}

function formatWeekRange(start, end) {
  const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const endStr = start.getMonth() === end.getMonth()
    ? String(end.getDate())
    : end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${startStr} – ${endStr}`
}

// Everything needed to render/select one week in the leaderboard's week
// picker: its RTDB key, display range, and whether it's still in progress.
export function weekInfo(weeksAgo = 0, date = new Date()) {
  const start = weekStart(weeksAgo, date)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  const isCurrent = weeksAgo === 0
  const daysLeft = isCurrent ? Math.max(1, Math.ceil(msUntilWeekEnd(date) / 86400000)) : 0
  return {
    weekId: isoWeekId(start),
    weeksAgo,
    start,
    end,
    label: formatWeekRange(start, end),
    isCurrent,
    daysLeft,
  }
}
