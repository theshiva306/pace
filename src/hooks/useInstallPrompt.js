import { useEffect, useState } from 'react'

const INSTALLED_FLAG_KEY = 'pace:installedOnDevice'

function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true // iOS Safari
  )
}

// Whether this device has ever installed the app, per our own record —
// separate from isStandalone(), which only tells us whether *this specific
// page load* happens to be running inside the installed app shell. Someone
// who installed Pace and later opens the same URL in a normal browser tab
// (not tapping their home-screen icon) would otherwise look exactly like a
// first-time visitor and get offered install again.
function wasEverInstalled() {
  try {
    return localStorage.getItem(INSTALLED_FLAG_KEY) === '1'
  } catch {
    return false
  }
}

function markInstalled() {
  try {
    localStorage.setItem(INSTALLED_FLAG_KEY, '1')
  } catch {
    // Best-effort only — worst case we just ask again next time.
  }
}

// Best-effort browser/platform detection, used only to pick the right
// instructions when there's no programmatic install API (Safari, Firefox).
function detectBrowser() {
  const ua = window.navigator.userAgent
  const isIOS = /iphone|ipad|ipod/i.test(ua)
  const isAndroid = /android/i.test(ua)
  const isSafari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(ua)
  const isFirefox = /firefox|fxios/i.test(ua)
  const isChromium = /chrome|crios|edg/i.test(ua) && !isFirefox

  if (isIOS) return 'ios-safari' // covers Chrome/Firefox on iOS too — Apple forces WebKit
  if (isSafari && !isIOS) return 'mac-safari'
  if (isFirefox) return 'firefox'
  if (isChromium && isAndroid) return 'android-chromium'
  if (isChromium) return 'chromium'
  return 'other'
}

// Tracks Chrome/Edge's native install prompt and exposes a simple API for a
// custom "Add to Home Screen" button. Falls back to per-browser manual
// instructions on Safari and Firefox, which don't expose an install API.
//
// `installed` is true if either (a) this page is currently running inside
// the installed app shell, or (b) we've previously recorded an install on
// this device — so revisiting the plain website afterward doesn't offer to
// install it all over again. `installedElsewhere` distinguishes case (b)
// specifically, so the UI can point the person to their home screen instead
// of re-running the install flow.
export default function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [standalone] = useState(isStandalone)
  const [recordedInstalled, setRecordedInstalled] = useState(wasEverInstalled)
  const [browser] = useState(detectBrowser)

  useEffect(() => {
    if (standalone) markInstalled()

    // Pick up an event that fired before this hook mounted (see main.jsx).
    if (window.__deferredInstallPrompt) {
      setDeferredPrompt(window.__deferredInstallPrompt)
    }

    function onReady() {
      setDeferredPrompt(window.__deferredInstallPrompt)
    }
    function onBeforeInstallPrompt(e) {
      e.preventDefault()
      window.__deferredInstallPrompt = e
      setDeferredPrompt(e)
    }
    function onAppInstalled() {
      markInstalled()
      setRecordedInstalled(true)
      window.__deferredInstallPrompt = null
      setDeferredPrompt(null)
    }

    window.addEventListener('__installPromptReady', onReady)
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)
    return () => {
      window.removeEventListener('__installPromptReady', onReady)
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [standalone])

  const installed = standalone || recordedInstalled
  const installedElsewhere = recordedInstalled && !standalone
  const canPromptInstall = !!deferredPrompt && !installed

  async function promptInstall() {
    if (!deferredPrompt) return null
    deferredPrompt.prompt()
    const choice = await deferredPrompt.userChoice
    window.__deferredInstallPrompt = null
    setDeferredPrompt(null)
    if (choice.outcome === 'accepted') {
      markInstalled()
      setRecordedInstalled(true)
    }
    return choice.outcome // 'accepted' | 'dismissed'
  }

  return { installed, installedElsewhere, canPromptInstall, browser, promptInstall }
}

