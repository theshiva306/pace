// Remembers the last-used Focus Time / Breaks setup so "Start Focus Now"
// can skip the setup sheet on repeat visits. Falls back to sane defaults
// (and isFirstRun: true) the very first time, so the setup sheet still
// shows once to let the person configure things before their first session.

const KEY = 'pace:timerSettings'

const DEFAULTS = {
  mode: 'stopwatch', // 'stopwatch' | 'countdown'
  targetSeconds: 60 * 60,
  breaksAllowed: 0,
  breakDurationSeconds: 5 * 60,
}

export function loadTimerSettings() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS, isFirstRun: true }
    const parsed = JSON.parse(raw)
    return { ...DEFAULTS, ...parsed, isFirstRun: false }
  } catch {
    return { ...DEFAULTS, isFirstRun: true }
  }
}

export function saveTimerSettings(settings) {
  const { mode, targetSeconds, breaksAllowed, breakDurationSeconds } = settings
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ mode, targetSeconds, breaksAllowed, breakDurationSeconds }),
    )
  } catch {
    // Private browsing / storage disabled — settings just won't persist.
  }
}
