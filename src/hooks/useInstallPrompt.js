import { useEffect, useState } from 'react'

function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true // iOS Safari
  )
}

// Best-effort browser/platform detection, used only to pick the right
// instructions when there is no programmatic install API (Safari, Firefox).
function detectBrowser() {
  const ua = window.navigator.userAgent
  const isIOS = /iphone|ipad|ipod/i.test(ua)
  const isAndroid = /android/i.test(ua)
  const isSafari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(ua)
  const isFirefox = /firefox|fxios/i.test(ua)
  const isChromium = /chrome|crios|edg/i.test(ua) && !isFirefox

  // All iOS browsers use WebKit, and none exposes the Chromium
  // beforeinstallprompt API. Safari's Share → Add to Home Screen flow is
  // therefore the correct install path on iPhone/iPad.
  if (isIOS) return 'ios-safari'
  if (isSafari) return 'mac-safari'
  if (isFirefox) return 'firefox'
  if (isChromium && isAndroid) return 'android-chromium'
  if (isChromium) return 'chromium'
  return 'other'
}

// Tracks Chrome/Edge's native install prompt and exposes a simple API for a
// custom "Add to Home Screen" button. Safari and Firefox use their own
// browser UI, so the app shows manual instructions instead.
//
// IMPORTANT: Do not persist an "installed" flag in localStorage. An installed
// PWA and a normal browser tab share the same origin/storage, and a stale
// flag can incorrectly hide the install row forever after the user removes
// the Home Screen icon. The reliable state for the current page is whether
// this page is actually running in the installed app shell.
export default function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [standalone] = useState(isStandalone)
  const [browser] = useState(detectBrowser)

  useEffect(() => {
    // Remove the legacy flag from older Pace builds. It is intentionally no
    // longer used to decide whether the install UI should be shown.
    try {
      localStorage.removeItem('pace:installedOnDevice')
    } catch {
      // Storage can be unavailable in private/restricted browser contexts.
    }

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
  }, [])

  // Only hide the install row when THIS page is currently running as the
  // installed app. A normal Safari/Chrome tab should always be allowed to
  // show the appropriate install action again.
  const installed = standalone
  const canPromptInstall = !!deferredPrompt && !installed

  async function promptInstall() {
    if (!deferredPrompt) return null
    deferredPrompt.prompt()
    const choice = await deferredPrompt.userChoice
    window.__deferredInstallPrompt = null
    setDeferredPrompt(null)
    return choice.outcome // 'accepted' | 'dismissed'
  }

  return { installed, canPromptInstall, browser, promptInstall }
}
