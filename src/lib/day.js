// Local calendar-day id, e.g. "2026-08-17". Runs local midnight -> midnight
// (not UTC), so "today" always lines up with what the user sees on their
// own clock, and rolls over naturally at their midnight.
export function dayId(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// Milliseconds until local midnight — used to know when a "today" total
// should be considered stale and re-read fresh.
export function msUntilDayEnd(date = new Date()) {
  const next = new Date(date)
  next.setHours(24, 0, 0, 0)
  return next.getTime() - date.getTime()
}
