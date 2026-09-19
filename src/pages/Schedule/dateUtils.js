import { dayId, addDays } from '../../lib/day'

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// "2026-08-17" -> "Monday", for labeling the copy-from-previous-day button.
export function weekdayName(dateId) {
  const [y, m, d] = dateId.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'long' })
}

// Built from addDays (calendar-component arithmetic), not raw ms math —
// a week that spans a DST transition would otherwise risk landing on
// the wrong local date for the days after the transition.
export function weekDateIds(anchorMonday) {
  const mondayId = dayId(anchorMonday)
  return Array.from({ length: 7 }, (_, i) => addDays(mondayId, i))
}

// "HH:MM" (native <input type="time">'s format) -> epoch ms on the given
// calendar day, local time.
export function timeToMs(dateId, timeStr) {
  const [y, m, d] = dateId.split('-').map(Number)
  const [h, min] = timeStr.split(':').map(Number)
  return new Date(y, m - 1, d, h, min, 0, 0).getTime()
}

// epoch ms -> "HH:MM", the inverse of timeToMs — used to prefill the edit
// sheet and to suggest a next-block start time from an existing one.
export function msToTimeStr(ms) {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
