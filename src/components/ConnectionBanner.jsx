import { useEffect, useRef, useState } from 'react'
import { useOnlineStatus } from '../hooks/useOnlineStatus'

// Slim top banner, mounted once at the root so it's visible regardless of
// auth/route state. Three states:
//  - offline: red, persistent, "You're offline"
//  - reconnecting: only shown if we were offline and the browser thinks
//    it has a link back but Firebase hasn't confirmed yet
//  - back online: green, auto-dismisses after a couple seconds — quiet
//    confirmation rather than a state that lingers forever
export default function ConnectionBanner() {
  const { online, browserOnline, firebaseConnected } = useOnlineStatus()
  const [showBackOnline, setShowBackOnline] = useState(false)
  const wasOffline = useRef(false)

  useEffect(() => {
    if (!online) {
      wasOffline.current = true
      setShowBackOnline(false)
      return
    }
    if (online && wasOffline.current) {
      setShowBackOnline(true)
      wasOffline.current = false
      const t = setTimeout(() => setShowBackOnline(false), 2200)
      return () => clearTimeout(t)
    }
  }, [online])

  if (online && !showBackOnline) return null

  const reconnecting = !online && browserOnline && !firebaseConnected

  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex justify-center pt-[env(safe-area-inset-top)] pointer-events-none animate-banner-down">
      <div
        className={`mt-2 flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium border backdrop-blur-md shadow-lg pointer-events-auto ${
          showBackOnline
            ? 'bg-live-soft/95 border-live/30 text-live'
            : 'bg-danger-soft/95 border-danger/30 text-danger'
        }`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${showBackOnline ? 'bg-live' : 'bg-danger'} ${
            !showBackOnline ? 'animate-pulse-soft' : ''
          }`}
        />
        {showBackOnline ? "Back online" : reconnecting ? 'Reconnecting…' : "You're offline"}
      </div>
    </div>
  )
}
