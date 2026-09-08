// The persistent session notification (with its Pause/Resume action
// button) only really works on Android:
//   - iOS Safari doesn't expose the Notification permission API to a
//     regular browser tab at all, and even once installed to the home
//     screen (the only way notifications work there since iOS 16.4),
//     action buttons specifically are far less reliable than on Android.
//     EU iPhones on iOS 17.4+ lost standalone PWA support entirely, so
//     even "installed" doesn't help there.
//   - Desktop browsers can show plain notifications fine, but the whole
//     point of this feature — catching someone who's put their phone
//     down or switched apps mid-session — is a mobile problem; showing
//     it on desktop just adds a permission prompt nobody asked for.
// Gating on Android specifically, rather than "not iOS," also correctly
// excludes desktop Chrome/Edge/Firefox, which report as neither.
export function isAndroidMobile() {
  return /android/i.test(navigator.userAgent)
}
