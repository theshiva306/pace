import { useEffect, useState } from 'react'

function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true // iOS Safari
  )
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
  if (isChromium) return 'chromium'
  return 'other'
}

// Tracks Chrome/Edge's native install prompt and exposes a simple API for a
// custom "Add to Home Screen" button. Falls back to per-browser manual
// instructions on Safari and Firefox, which don't expose an install API.
export default function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [installed, setInstalled] = useState(isStandalone())
  const [browser] = useState(detectBrowser)

  useEffect(() => {
    function onBeforeInstallPrompt(e) {
      e.preventDefault()
      setDeferredPrompt(e)
    }
    function onAppInstalled() {
      setInstalled(true)
      setDeferredPrompt(null)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [])

  const canPromptInstall = !!deferredPrompt && !installed

  async function promptInstall() {
    if (!deferredPrompt) return null
    deferredPrompt.prompt()
    const choice = await deferredPrompt.userChoice
    setDeferredPrompt(null)
    return choice.outcome // 'accepted' | 'dismissed'
  }

  return { installed, canPromptInstall, browser, promptInstall }
}

