import { useEffect, useState } from 'react'

function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true // iOS/iPadOS Home Screen web app
  )
}

// Best-effort browser/platform detection, used only to pick the right
// instructions when there is no programmatic install API (Safari, iOS browsers).
function detectBrowser() {
  const ua = window.navigator.userAgent
  const platform = window.navigator.platform
  const isIOS =
    /iphone|ipad|ipod/i.test(ua) ||
    (platform === 'MacIntel' && window.navigator.maxTouchPoints > 1) // iPadOS desktop UA
  const isAndroid = /android/i.test(ua)
  const isFirefox = /firefox|fxios/i.test(ua)
  const isChromium = /chrome|crios|edg|edgios/i.test(ua) && !isFirefox
  const isSafari = /^((?!chrome|android|crios|fxios|edg|edgios).)*safari/i.test(ua)

  // iOS/iPadOS browsers do not expose Chromium's beforeinstallprompt API.
  // However, iOS 16.4+ allows third-party browsers to expose Add to Home
  // Screen through their own Share menu. Detect the actual browser instead
  // of treating every iOS browser as Safari.
  if (isIOS && isSafari) return 'ios-safari'
  if (isIOS && isChromium) return 'ios-chromium'
  if (isIOS && isFirefox) return 'ios-firefox'
  if (isIOS) return 'ios-other'
  if (isSafari) return 'mac-safari'
  if (isFirefox) return 'firefox'
  if (isChromium && isAndroid) return 'android-chromium'
  if (isChromium) return 'chromium'
  return 'other'
}

// Tracks Chrome/Edge's native install prompt where beforeinstallprompt is
// available. iOS browsers use their own browser Share menu instead.
//
// Do not persist an "installed" flag in localStorage. An installed PWA and a
// normal browser tab share the same origin/storage, so a stale flag can hide
// the install row after the user removes the Home Screen icon.
export default function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [standalone] = useState(isStandalone)
  const [browser] = useState(detectBrowser)

  useEffect(() => {
    // Remove the legacy flag from older Pace builds. It is no longer used to
    // decide whether the install UI should be shown.
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
  // installed app. A normal browser tab can always show its install UI.
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
