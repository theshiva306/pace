import { useEffect } from 'react'
import { isEnabledByUser } from '../lib/notificationPrefs'

const NOTIFICATION_TAG = 'pace-session'

function statusIsLive(status) {
  return status === 'active' || status === 'paused' || status === 'onBreak'
}

async function showOrUpdateNotification(session) {
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

async function clearNotification() {
  if (!('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.getRegistration()
  const existing = await registration?.getNotifications({ tag: NOTIFICATION_TAG })
  existing?.forEach((n) => n.close())
}

// Requests permission the first time someone actually starts a session —
// not on page load, which would just be an annoying, context-free prompt.
// Silently does nothing if already granted or denied; the person can
// still turn it on later from the browser/OS's own notification settings
// if they said no the first time.
export async function requestNotificationPermissionIfNeeded() {
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
    function sync() {
      if (!session || !statusIsLive(session.status)) {
        clearNotification()
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

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined
    function onMessage(event) {
      if (event.data?.type === 'pace-notification-toggle') onToggle()
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [onToggle])
}
