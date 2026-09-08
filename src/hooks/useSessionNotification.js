import { useEffect, useRef } from 'react'
import { isEnabledByUser } from '../lib/notificationPrefs'
import { isAndroidMobile } from '../lib/platform'

const NOTIFICATION_TAG = 'pace-session'

function statusIsLive(status) {
  return status === 'active' || status === 'paused' || status === 'onBreak'
}

async function showOrUpdateNotification(session) {
  if (!isAndroidMobile()) return
  if (!('serviceWorker' in navigator) || Notification.permission !== 'granted' || !isEnabledByUser()) return
  const registration = await navigator.serviceWorker.ready
  const isActive = session.status === 'active'
  await registration.showNotification('Pace', {
    tag: NOTIFICATION_TAG,
    body: 'Your session is still running',
    requireInteraction: true,
    silent: true, // updating an ongoing session shouldn't buzz/sound each time
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    actions: [{ action: 'toggle', title: isActive ? 'Pause' : 'Resume' }],
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
// Silently does nothing if already granted or denied (or not Android —
// see lib/platform.js for why this feature is Android-only); the person
// can still turn it on later from the browser/OS's own notification
// settings if they said no the first time.
export async function requestNotificationPermissionIfNeeded() {
  if (!isAndroidMobile()) return
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
// the session's actual status for as long as one exists, and tears it
// down the moment it doesn't. `onToggle` is called with the current
// status when the notification's Pause/Resume button is tapped *while
// the app is open* — the service worker forwards that tap here via
// postMessage rather than performing the write itself in that case, so
// it goes through the exact same pauseSession/resumeSession calls (and
// server-time correction) the on-screen buttons already use. If the app
// isn't open at all, the service worker falls back to a direct database
// write on its own — see public/sw.js.
export function useSessionNotification(session, onToggle) {
  useEffect(() => {
    if (!isAndroidMobile()) return undefined
    function sync() {
      if (!session || !statusIsLive(session.status)) {
        clearSessionNotification()
      } else {
        showOrUpdateNotification(session)
      }
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
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
