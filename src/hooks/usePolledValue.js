import { useCallback, useEffect, useRef, useState } from 'react'
import { ref, get, onValue } from 'firebase/database'
import { db } from '../firebase'

// Kept under the old hook name so existing callers don't need to change.
// Group data now uses a real-time RTDB subscription instead of polling.
// refresh() is still available for the existing manual refresh UI.
export function usePolledValue(path, { intervalMs = 60000, enabled = true } = {}) {
  const [value, setValue] = useState(undefined)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const refresh = useCallback(async () => {
    if (!path) return
    setRefreshing(true)
    try {
      const snap = await get(ref(db, path))
      if (mountedRef.current) {
        setValue(snap.exists() ? snap.val() : null)
        setUpdatedAt(Date.now())
      }
    } finally {
      if (mountedRef.current) setRefreshing(false)
    }
  }, [path])

  useEffect(() => {
    if (!enabled || !path) return

    const unsubscribe = onValue(ref(db, path), (snap) => {
      if (!mountedRef.current) return
      setValue(snap.exists() ? snap.val() : null)
      setUpdatedAt(Date.now())
      setRefreshing(false)
    }, () => {
      if (mountedRef.current) setRefreshing(false)
    })

    return unsubscribe
  }, [path, enabled])

  return { value, refresh, refreshing, updatedAt, loading: value === undefined }
}
