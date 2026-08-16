import { useEffect, useState } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'

// Firebase's own clock-skew offset between this device and the server.
// Lets us compute "elapsed since startedAt" correctly even if the
// user's system clock is wrong.
export function useServerOffset() {
  const [offset, setOffset] = useState(0)
  useEffect(() => {
    const unsub = onValue(ref(db, '.info/serverTimeOffset'), (snap) => {
      setOffset(snap.val() || 0)
    })
    return unsub
  }, [])
  return offset
}
