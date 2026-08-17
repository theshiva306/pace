import { useCallback, useEffect, useRef, useState } from 'react'
import { ref, get } from 'firebase/database'
import { db } from '../firebase'

// Reads an RTDB path once, then re-reads it on a fixed interval and on
// demand via refresh(). Used anywhere we deliberately don't want the UI
// to update on every write (group leaderboard / live totals) — it should
// hold still and only move when refreshed, not flicker mid-focus-session.
export function usePolledValue(path, { intervalMs = 60000, enabled = true } = {}) {
  const [value, setValue] = useState(undefined) // undefined = first load in flight
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
    refresh()
    const id = setInterval(refresh, intervalMs)
    return () => clearInterval(id)
  }, [path, enabled, intervalMs, refresh])

  return { value, refresh, refreshing, updatedAt, loading: value === undefined }
}
