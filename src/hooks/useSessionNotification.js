import { useEffect, useRef } from 'react'
import { isEnabledByUser } from '../lib/notificationPrefs'
import { isAndroidMobile, isIOSInstalled } from '../lib/platform'
import { formatDuration } from '../lib/format'

const NOTIFICATION_TAG = 'pace-session'
const LIVE_UPDATE_INTERVAL_MS = 30_000

function statusIsLive(status) {
  return status === 'active' || status === 'paused' || status === 'onBreak'
}

// Live elapsed/remaining time instead of a static "still running" — see
// the periodic refresh in useSessionNotification below for what keeps
// this current while the app is in the foreground.
function bodyFor(session, clock) {
  if (session.status === 'onBreak') {
    return `On a break — ${formatDuration(clock.breakRemaining)} left`
  }
  if (session.mode === 'countdown' && typeof session.targetSeconds === 'number') {
    const remaining = Math.max(0, session.targetSeconds - clock.focusElapsed)
    return session.status === 'paused'
      ? `Paused — ${formatDuration(remaining)} left`
      : `${formatDuration(remaining)} left`
  }
  return session.status === 'paused'
    ? `Paused — ${formatDuration(clock.focusElapsed)} so far`
    : `${formatDuration(clock.focusElapsed)} focused so far`
}

async function showOrUpdateNotification(session, clock) {
  const androidCapable = isAndroidMobile()
  const iosCapable = isIOSInstalled()
  if (!androidCapable && !iosCapable) return
  if (!('serviceWorker' in navigator) || Notification.permission !== 'granted' || !isEnabledByUser()) return
  const registration = await navigator.serviceWorker.ready
  const isActive = session.status === 'active'
  await registration.showNotification('Pace', {
    tag: NOTIFICATION_TAG,
    body: bodyFor(session, clock),
    requireInteraction: true,
    silent: true, // updating an ongoing session shouldn't buzz/sound each time
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    // iOS doesn't render custom notification action buttons at all
    // (confirmed against Apple's own developer forums) — omitting this
    // there rather than shipping a button that silently does nothing.
    // Tapping the notification body itself still opens/focuses Pace on
    // both platforms, via sw.js's default notificationclick handling.
    ...(androidCapable ? { actions: [{ action: 'toggle', title: isActive ? 'Pause' : 'Resume' }] } : {}),
    data: { isActive },
  })
}

// Exported — Profile.jsx's toggle-off needs to call this directly and
// immediately. Just flipping the stored preference isn't enough: a
// notification created via showNotification() persists independently of
// any page, so nothing removes an already-visible one just because the
// in-memory/stored preference changed elsewhere. Without this, turning
// the setting off while a session's notification was already showing
// left it stuck on screen until the session's status next happened to
// change for an unrelated reason.
export async function clearSessionNotification() {
  if (!('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.getRegistration()
  const existing = await registration?.getNotifications({ tag: NOTIFICATION_TAG })
  existing?.forEach((n) => n.close())
}

// Requests permission the first time someone actually starts a session —
// not on page load, which would just be an annoying, context-free prompt.
// Silently does nothing if already granted or denied, or on a platform
// that can't show this notification at all (desktop, or iOS before it's
// been added to the Home Screen — iOS only exposes the permission
// prompt to an installed web app, not a regular Safari tab). The person
// can still turn it on later from the browser/OS's own notification
// settings if they said no the first time.
export async function requestNotificationPermissionIfNeeded() {
  if (!isAndroidMobile() && !isIOSInstalled()) return
  if (!('Notification' in window) || Notification.permission !== 'default') return
  try {
    await Notification.requestPermission()
  } catch {
    // Some browsers reject this outside a direct user gesture — starting
    // a session from a tap should count as one, but fail quietly either
    // way, since this is a nice-to-have, not required for the timer
    // itself to work.
  }
}

// Keeps the persistent "session still running" notification in sync with
// the session's actual status — and its displayed elapsed/remaining time
// — for as long as one exists, and tears it down the moment it doesn't.
// `onToggle` is called with no arguments when the notification's
// Pause/Resume button is tapped *while the app is open* (Android only —
// see bodyFor's comment on why iOS has no button to tap) — the service
// worker forwards that tap here via postMessage rather than performing
// the write itself in that case, so it goes through the exact same
// pauseLocal/resumeLocal calls the on-screen buttons already use. If the
// app isn't open at all, the service worker falls back to a direct
// database write on its own — see public/sw.js.
export function useSessionNotification(session, clock, onToggle) {
  const clockRef = useRef(clock)
  clockRef.current = clock

  useEffect(() => {
    if (!isAndroidMobile() && !isIOSInstalled()) return undefined
    function sync() {
      if (!session || !statusIsLive(session.status)) {
        clearSessionNotification()
      } else {
        showOrUpdateNotification(session, clockRef.current)
      }
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    // Keeps the elapsed/remaining time reasonably current while the app
    // sits open and in the foreground — sync() above already covers every
    // status/mode change, so this interval's only job is refreshing the
    // displayed number. Only runs while visible: there's no point paying
    // for it while backgrounded, and the visibilitychange listener above
    // already re-syncs immediately whenever that changes.
    let intervalId = null
    function manageInterval() {
      if (document.visibilityState === 'visible' && session && statusIsLive(session.status)) {
        if (!intervalId) intervalId = setInterval(sync, LIVE_UPDATE_INTERVAL_MS)
      } else if (intervalId) {
        clearInterval(intervalId)
        intervalId = null
      }
    }
    manageInterval()
    document.addEventListener('visibilitychange', manageInterval)
    return () => {
      document.removeEventListener('visibilitychange', sync)
      document.removeEventListener('visibilitychange', manageInterval)
      if (intervalId) clearInterval(intervalId)
    }
    // Deliberately keyed on session's status/sessionId fields, not the
    // whole object — Firebase constructs a new session object reference
    // on every onValue emission even when nothing meaningful changed;
    // re-running this (closing and re-showing the notification) on every
    // one of those would be wasteful and could cause visible flicker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.status, session?.sessionId])

  // `onToggle` is a fresh function reference on every render of the
  // caller (Timer.jsx isn't memoizing it) — a ref here means this
  // listener is set up exactly once instead of being torn down and
  // re-added on every single render (the ticking clock alone re-renders
  // Timer every second). Always calls whatever the *latest* onToggle is
  // via the ref, so there's no risk of a stale closure either.
  const onToggleRef = useRef(onToggle)
  onToggleRef.current = onToggle

  useEffect(() => {
    if (!isAndroidMobile() || !('serviceWorker' in navigator)) return undefined
    function onMessage(event) {
      if (event.data?.type === 'pace-notification-toggle') onToggleRef.current()
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [])
}
