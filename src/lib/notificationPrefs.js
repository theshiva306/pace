// Two separate concerns live here:
//
// 1. When to show our own in-app "turn on notifications?" prompt — the
//    browser's native permission dialog can only ever be asked once
//    per origin (a second call while still 'default' just silently
//    no-ops in most browsers), so nagging someone every visit would
//    either do nothing after the first ignroed attempt or feel pushy.
//    Instead: ask once, and if they pick "Later," wait several more
//    visits before asking again. "Don't ask again" stops it for good —
//    they can still turn it on manually from Profile any time.
//
// 2. A user-level on/off preference, separate from the browser's actual
//    Permission API state. Once granted, a browser permission can't be
//    un-granted by JS at all — only the person can revoke it via their
//    browser/OS settings. So "turning notifications off" inside Pace
//    doesn't (and can't) touch that; it just tells the app to stop
//    calling showNotification even though it technically still could.

import { isAndroidMobile } from './platform'

const VISIT_COUNT_KEY = 'pace:notif:visitCount'
const LAST_PROMPTED_AT_KEY = 'pace:notif:lastPromptedAtVisit'
const DISMISSED_FOREVER_KEY = 'pace:notif:dismissedForever'
const ENABLED_BY_USER_KEY = 'pace:notif:enabledByUser'

const VISITS_BETWEEN_PROMPTS = 5

function readInt(key, fallback = 0) {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? fallback : parseInt(raw, 10) || fallback
  } catch {
    return fallback
  }
}

function writeValue(key, value) {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    // Best-effort — worst case the prompt schedule resets, not a
    // correctness issue for the app itself.
  }
}

// Called once per app load. Returns whether the in-app prompt should be
// shown right now.
export function bumpVisitAndShouldPrompt() {
  if (!isAndroidMobile()) return false // feature is Android-only — see lib/platform.js
  if (!('Notification' in window)) return false
  if (Notification.permission !== 'default') return false // already decided, one way or the other
  try {
    if (localStorage.getItem(DISMISSED_FOREVER_KEY) === '1') return false
  } catch {
    return false
  }

  const visitCount = readInt(VISIT_COUNT_KEY, 0) + 1
  writeValue(VISIT_COUNT_KEY, visitCount)

  const lastPromptedAt = readInt(LAST_PROMPTED_AT_KEY, 0)
  if (lastPromptedAt === 0) return true // never asked at all yet
  return visitCount - lastPromptedAt >= VISITS_BETWEEN_PROMPTS
}

export function recordPromptShownNow() {
  writeValue(LAST_PROMPTED_AT_KEY, readInt(VISIT_COUNT_KEY, 0))
}

export function dismissPromptForever() {
  writeValue(DISMISSED_FOREVER_KEY, '1')
}

// Defaults to on the moment permission is actually granted — someone who
// just tapped "Turn on" clearly wants it; explicit opt-out afterward is
// what the Profile toggle is for.
export function isEnabledByUser() {
  try {
    const raw = localStorage.getItem(ENABLED_BY_USER_KEY)
    return raw == null ? true : raw === '1'
  } catch {
    return true
  }
}

export function setEnabledByUser(enabled) {
  writeValue(ENABLED_BY_USER_KEY, enabled ? '1' : '0')
}
