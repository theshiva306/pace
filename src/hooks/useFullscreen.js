import { useCallback, useEffect, useState } from 'react'

function getFullscreenElement() {
  return document.fullscreenElement
    || document.webkitFullscreenElement // Safari
    || document.msFullscreenElement // old Edge
    || null
}

// Wraps the Fullscreen API. Exposes current state (kept in sync even when
// the browser exits fullscreen on its own — e.g. the person pressing Esc,
// not just via our own button) and a toggle. Not supported at all on iOS
// Safari (Apple doesn't allow arbitrary elements to go fullscreen there);
// `supported` reflects that so callers can hide the control entirely
// rather than show a button that silently does nothing.
export default function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(() => !!getFullscreenElement())
  const supported = typeof document !== 'undefined' && !!(
    document.documentElement.requestFullscreen
    || document.documentElement.webkitRequestFullscreen
    || document.documentElement.msRequestFullscreen
  )

  useEffect(() => {
    function onChange() { setIsFullscreen(!!getFullscreenElement()) }
    document.addEventListener('fullscreenchange', onChange)
    document.addEventListener('webkitfullscreenchange', onChange)
    document.addEventListener('MSFullscreenChange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      document.removeEventListener('webkitfullscreenchange', onChange)
      document.removeEventListener('MSFullscreenChange', onChange)
    }
  }, [])

  const toggle = useCallback(async () => {
    try {
      if (getFullscreenElement()) {
        if (document.exitFullscreen) await document.exitFullscreen()
        else if (document.webkitExitFullscreen) await document.webkitExitFullscreen()
        else if (document.msExitFullscreen) await document.msExitFullscreen()
      } else {
        const el = document.documentElement
        if (el.requestFullscreen) await el.requestFullscreen()
        else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen()
        else if (el.msRequestFullscreen) await el.msRequestFullscreen()
      }
    } catch {
      // Some browsers reject this outside a direct user gesture, or if
      // fullscreen is disabled by policy — fail quietly, nothing to
      // recover from, the button just stays in its current state.
    }
  }, [])

  return { isFullscreen, toggle, supported }
}
