import { useCallback, useEffect, useRef, useState } from 'react'
import { ref, get, onValue } from 'firebase/database'
import { db } from '../firebase'
import { isoWeekId } from '../lib/week'
import { dayId } from '../lib/day'

// Kept under the old hook name so existing callers don't need to change.
// Group totals are realtime and include the currently active session as a
// temporary contribution. The active contribution is calculated locally
// from timestamps and is never written to Firebase every second.
export function usePolledValue(path, { intervalMs = 60000, enabled = true } = {}) {
  const [value, setValue] = useState(undefined)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [now, setNow] = useState(Date.now())
  const mountedRef = useRef(true)

  const isDailyTotal = /^groups\/[^/]+\/dailyTotals\/[^/]+$/.test(path || '')
  const isWeeklyTotal = /^groups\/[^/]+\/weeklyTotals\/[^/]+$/.test(path || '')
  const needsLiveOverlay = isDailyTotal || isWeeklyTotal
  const groupId = needsLiveOverlay ? path.split('/')[1] : null
  const livePath = groupId ? `groups/${groupId}/live` : null
  const periodId = needsLiveOverlay ? path.split('/')[3] : null

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Only the UI clock ticks locally. Firebase is never written every second.
  useEffect(() => {
    if (!enabled || !needsLiveOverlay) return
    const id = setInterval(() => {
      if (mountedRef.current) setNow(Date.now())
    }, 1000)
    return () => clearInterval(id)
  }, [enabled, needsLiveOverlay])

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

    let baseValue = null
    let liveValue = null

    const emit = () => {
      if (!mountedRef.current) return

      const base = baseValue || {}
      if (!needsLiveOverlay) {
        setValue(baseValue)
        setUpdatedAt(Date.now())
        setRefreshing(false)
        return
      }

      const merged = { ...base }
      const currentPeriod = isDailyTotal ? dayId() : isoWeekId()
      const shouldIncludeActive = periodId === currentPeriod

      if (shouldIncludeActive && liveValue) {
        Object.entries(liveValue).forEach(([uid, session]) => {
          if (!session?.startedAt) return

          const startedAt = Number(session.startedAt)
          if (!Number.isFinite(startedAt)) return

          let elapsed = 0
          if (session.status === 'paused' || session.status === 'onBreak') {
            const pausedAt = Number(session.pausedAt)
            if (Number.isFinite(pausedAt)) {
              elapsed = Math.max(0, (pausedAt - startedAt) / 1000)
            }
          } else {
            elapsed = Math.max(0, (now - startedAt) / 1000)
          }

          elapsed -= Number(session.pausedSeconds || 0)
          elapsed = Math.max(0, Math.floor(elapsed))
          merged[uid] = Number(base[uid] || 0) + elapsed
        })
      }

      setValue(merged)
      setUpdatedAt(Date.now())
      setRefreshing(false)
    }

    const unsubBase = onValue(ref(db, path), (snap) => {
      baseValue = snap.exists() ? snap.val() : null
      emit()
    }, () => {
      if (mountedRef.current) setRefreshing(false)
    })

    let unsubLive = null
    if (needsLiveOverlay && livePath) {
      unsubLive = onValue(ref(db, livePath), (snap) => {
        liveValue = snap.exists() ? snap.val() : null
        emit()
      }, () => {})
    }

    return () => {
      unsubBase()
      unsubLive?.()
    }
  }, [path, enabled, needsLiveOverlay, livePath, periodId, isDailyTotal, now])

  return { value, refresh, refreshing, updatedAt, loading: value === undefined }
}
