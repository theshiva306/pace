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
