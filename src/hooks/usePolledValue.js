import { useCallback, useEffect, useRef, useState } from 'react'
import { ref, get, onValue } from 'firebase/database'
import { db } from '../firebase'
import { isoWeekId } from '../lib/week'
import { dayId } from '../lib/day'
import { isCurrentlyLive } from '../lib/staleSession'

// Named for its `refresh()`/`refreshing` API (used for pull-to-refresh UX),
// but for group study paths this is realtime, not polling: it subscribes
// live via onValue to each member's activeSessions/userStats, and drops a
// member's subscription the instant they leave the group's members list —
// so removed/left members disappear from Live immediately, not on a delay.
// The 1s interval below only recomputes an in-progress session's elapsed
// time locally (startedAt is fixed; "now" isn't), it does not refetch data.
export function usePolledValue(path, { intervalMs = 60000, enabled = true } = {}) {
  const [value, setValue] = useState(undefined)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const nowRef = useRef(Date.now())
  const recomputeRef = useRef(null)
  const mountedRef = useRef(true)

  const parts = (path || '').split('/')
  const isGroupLive = parts.length === 3 && parts[0] === 'groups' && parts[2] === 'live'
  const isDailyTotal = parts.length === 4 && parts[0] === 'groups' && parts[2] === 'dailyTotals'
  const isWeeklyTotal = parts.length === 4 && parts[0] === 'groups' && parts[2] === 'weeklyTotals'
  const isGroupStudyPath = isGroupLive || isDailyTotal || isWeeklyTotal
  const groupId = isGroupStudyPath ? parts[1] : null
  const periodId = isDailyTotal || isWeeklyTotal ? parts[3] : null

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (!enabled || !isGroupStudyPath) return undefined
    const id = setInterval(() => {
      nowRef.current = Date.now()
      recomputeRef.current?.()
    }, 1000)
    return () => clearInterval(id)
  }, [enabled, isGroupStudyPath])

  const refresh = useCallback(async () => {
    if (!path) return
    setRefreshing(true)
    try {
      if (isGroupStudyPath) {
        nowRef.current = Date.now()
        recomputeRef.current?.()
      } else {
        const snap = await get(ref(db, path))
        if (mountedRef.current) setValue(snap.exists() ? snap.val() : null)
      }
      if (mountedRef.current) setUpdatedAt(Date.now())
    } finally {
      if (mountedRef.current) setRefreshing(false)
    }
  }, [path, isGroupStudyPath])

  useEffect(() => {
    if (!enabled || !path) return undefined

    if (!isGroupStudyPath) {
      const unsub = onValue(ref(db, path), (snap) => {
        if (!mountedRef.current) return
        setValue(snap.exists() ? snap.val() : null)
        setUpdatedAt(Date.now())
        setRefreshing(false)
      }, () => mountedRef.current && setRefreshing(false))
      return unsub
    }

    let members = {}
    const stats = {}
    const sessions = {}
    const memberUnsubs = new Map()

    const emit = () => {
      if (!mountedRef.current) return
      const result = {}
      const currentPeriod = isDailyTotal ? dayId() : isoWeekId()
      const includeActive = isGroupLive || periodId === currentPeriod

      for (const uid of Object.keys(members)) {
        if (isGroupLive) {
          // Abandoned (paused/on-break too long) sessions stop counting as
          // "live" here — same threshold as everywhere else, see
          // lib/staleSession.js. Their accumulated time isn't touched by
          // this branch at all; it's the totals branch below that carries
          // numbers, and a paused session's contribution there is already
          // frozen the instant it's paused, so nothing to filter there.
          if (sessions[uid] && isCurrentlyLive(sessions[uid], nowRef.current)) result[uid] = sessions[uid]
          continue
        }

        result[uid] = Number(stats[uid] || 0)
        if (includeActive && sessions[uid]?.startedAt) {
          result[uid] += focusSeconds(sessions[uid], nowRef.current)
        }
      }

      setValue(result)
      setUpdatedAt(Date.now())
      setRefreshing(false)
    }

    recomputeRef.current = emit

    const subscribeMember = (uid) => {
      if (memberUnsubs.has(uid)) return
      const unsubs = []
      unsubs.push(onValue(ref(db, `activeSessions/${uid}`), (snap) => {
        sessions[uid] = snap.exists() ? snap.val() : null
        emit()
      }))

      if (isDailyTotal || isWeeklyTotal) {
        const statPath = isDailyTotal
          ? `userStats/${uid}/dailyTotals/${periodId}`
          : `userStats/${uid}/weeklyTotals/${periodId}`
        unsubs.push(onValue(ref(db, statPath), (snap) => {
          stats[uid] = snap.val() || 0
          emit()
        }))
      }
      memberUnsubs.set(uid, () => unsubs.forEach((u) => u()))
    }

    const unsubMembers = onValue(ref(db, `groups/${groupId}/members`), (snap) => {
      const nextMembers = snap.val() || {}
      Object.keys(members).filter((uid) => !nextMembers[uid]).forEach((uid) => {
        memberUnsubs.get(uid)?.()
        memberUnsubs.delete(uid)
        delete sessions[uid]
        delete stats[uid]
      })
      members = nextMembers
      Object.keys(members).forEach(subscribeMember)
      emit()
    })

    return () => {
      if (recomputeRef.current === emit) recomputeRef.current = null
      unsubMembers()
      memberUnsubs.forEach((unsub) => unsub())
      memberUnsubs.clear()
    }
  }, [path, enabled, isGroupStudyPath, isGroupLive, isDailyTotal, isWeeklyTotal, groupId, periodId])

  return { value, refresh, refreshing, updatedAt, loading: value === undefined }
}

function focusSeconds(session, now) {
  if (!session?.startedAt) return 0
  const startedAt = Number(session.startedAt)
  if (!Number.isFinite(startedAt)) return 0
  const pausedBefore = Math.max(0, Number(session.pausedSeconds) || 0)
  const pausedNow = session.status !== 'active' && session.pausedAt
    ? Math.max(0, (now - Number(session.pausedAt)) / 1000)
    : 0
  return Math.floor(Math.max(0, (now - startedAt) / 1000 - pausedBefore - pausedNow))
}
