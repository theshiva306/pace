// The persistent, actionable session notification (with its Pause/Resume
// button) only really works on Android:
//   - iOS Safari doesn't expose the Notification permission API to a
//     regular browser tab at all — only to an installed (Home Screen)
//     web app, since iOS 16.4. See isIOSInstalled() below.
//   - Even once installed, iOS does not render custom notification
//     action buttons at all (confirmed against Apple's own developer
//     forums) — only a generic "open the app" tap target. So a working
//     Pause/Resume button specifically is Android-only regardless of
//     install state; iOS gets a plain, tap-to-open status notification
//     instead (see useSessionNotification.js).
//   - Desktop browsers can show plain notifications fine, but the whole
//     point of this feature — catching someone who's put their phone
//     down or switched apps mid-session — is a mobile problem; showing
//     it on desktop just adds a permission prompt nobody asked for.
// Gating on Android specifically, rather than "not iOS," also correctly
// excludes desktop Chrome/Edge/Firefox, which report as neither.
export function isAndroidMobile() {
  return /android/i.test(navigator.userAgent)
}

export function isIOS() {
  const ua = navigator.userAgent
  return /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

// Home Screen ("standalone") install state — the gate iOS 16.4+ requires
// before Notification.requestPermission() does anything at all in Safari.
export function isStandalonePWA() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )
}

export function isIOSInstalled() {
  return isIOS() && isStandalonePWA()
}
