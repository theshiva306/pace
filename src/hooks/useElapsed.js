import { useEffect, useState } from 'react'
import { useServerOffset } from './useServerOffset'

// Ticks once a second, always deriving elapsed time from the real
// startedAt timestamp (+ server offset) rather than accumulating locally.
// This is what makes refresh / tab-switch / brief offline gaps safe.
export function useElapsed(startedAt) {
  const offset = useServerOffset()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!startedAt) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [startedAt])

  if (!startedAt) return 0
  const serverNow = now + offset
  return Math.max(0, (serverNow - startedAt) / 1000)
}
