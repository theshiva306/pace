import { useEffect, useState } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'

// Two independent signals, combined into one "can this app actually talk to
// the internet right now" answer:
//  - navigator.onLine: fires instantly on wifi/airplane-mode toggles, but
//    only tells us the device *thinks* it has a link layer, not that
//    Firebase is reachable.
//  - Firebase's `.info/connected`: the source of truth for whether the
//    Realtime Database socket is actually up. This is what catches "wifi
//    is connected but the network is slow/captive/broken" cases that
//    navigator.onLine misses entirely.
export function useOnlineStatus() {
  const [browserOnline, setBrowserOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  const [firebaseConnected, setFirebaseConnected] = useState(true)

  useEffect(() => {
    const goOnline = () => setBrowserOnline(true)
    const goOffline = () => setBrowserOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  useEffect(() => {
    const connectedRef = ref(db, '.info/connected')
    const unsub = onValue(connectedRef, (snap) => setFirebaseConnected(snap.val() === true))
    return unsub
  }, [])

  return {
    online: browserOnline && firebaseConnected,
    browserOnline,
    firebaseConnected,
  }
}
