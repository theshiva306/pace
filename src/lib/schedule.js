// Schedule blocks are plain Firebase reads/writes, not local-first like
// the active timer (lib/localSession.js) — planning tomorrow's schedule
// isn't a moment where a network hiccup mid-action would lose something
// irreplaceable the way a running timer would, so it doesn't carry the
// same offline machinery. Creating/editing a block does need a
// connection; viewing an already-loaded day doesn't, since onValue's own
// last-known snapshot keeps showing.
import { useEffect, useState } from 'react'
import {
  ref, push, update, remove, onValue, query, orderByChild, startAt, endAt, get,
} from 'firebase/database'
import { db } from '../firebase'

// "YYYY-MM-DD" -> local-midnight start/end ms, matching lib/day.js's
// dayId convention (local calendar day, not UTC).
function dayBoundsMs(dateId) {
  const [y, m, d] = dateId.split('-').map(Number)
  const start = new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
  const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0).getTime()
  return { start, end }
}

// Live-subscribes to one day's scheduled blocks, sorted by start time.
// Returns undefined while the initial value is still loading.
export function useScheduleBlocks(uid, dateId) {
  const [blocks, setBlocks] = useState(undefined)

  useEffect(() => {
    if (!uid || !dateId) return undefined
    setBlocks(undefined)
    const dayRef = ref(db, `schedules/${uid}/${dateId}`)
    const unsub = onValue(dayRef, (snap) => {
      const value = snap.val() || {}
      const list = Object.entries(value)
        .map(([id, block]) => ({ id, ...block }))
        .sort((a, b) => a.startMs - b.startMs)
      setBlocks(list)
    })
    return unsub
  }, [uid, dateId])

  return blocks
}

export async function addScheduleBlock(uid, dateId, block) {
  const dayRef = ref(db, `schedules/${uid}/${dateId}`)
  const newRef = push(dayRef)
  await update(newRef, { ...block, createdAt: Date.now() })
  return newRef.key
}

export async function updateScheduleBlock(uid, dateId, blockId, patch) {
  await update(ref(db, `schedules/${uid}/${dateId}/${blockId}`), patch)
}

export async function deleteScheduleBlock(uid, dateId, blockId) {
  await remove(ref(db, `schedules/${uid}/${dateId}/${blockId}`))
}

// One-time fetch of completed sessions that *started* on the given
// calendar day — used both to score that day's adherence and to total
// up its actual studied time by type for the weekly graph. Relies on
// completedSessions/$uid being indexed on startedAt (see
// database.rules.json) so this stays a targeted range query rather than
// a full-history scan as someone's session history grows.
export async function fetchSessionsForDay(uid, dateId) {
  const { start, end } = dayBoundsMs(dateId)
  const sessionsQuery = query(
    ref(db, `completedSessions/${uid}`),
    orderByChild('startedAt'),
    startAt(start),
    endAt(end - 1),
  )
  const snap = await get(sessionsQuery)
  const value = snap.val() || {}
  return Object.values(value).map((s) => ({
    sessionType: s.sessionType || 'focus', // pre-existing sessions predate this field
    startedAt: s.startedAt,
    durationSeconds: s.durationSeconds,
  }))
}

// Actual focus/semi-focus totals for a set of days — the weekly graph's
// data source. One query per day; fine at this scale (a week at a time,
// called when the Schedule tab is open, not on every render).
export async function fetchWeekActualTotals(uid, dateIds) {
  const entries = await Promise.all(dateIds.map(async (dateId) => {
    const sessions = await fetchSessionsForDay(uid, dateId)
    const totals = sessions.reduce((acc, s) => {
      const key = s.sessionType === 'semiFocus' ? 'semiSec' : 'focusSec'
      acc[key] += s.durationSeconds
      return acc
    }, { focusSec: 0, semiSec: 0 })
    return [dateId, totals]
  }))
  return Object.fromEntries(entries)
}
