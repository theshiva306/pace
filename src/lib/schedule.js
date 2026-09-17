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
  return Object.entries(value).map(([id, s]) => ({
    id,
    sessionType: s.sessionType || 'focus', // pre-existing sessions predate this field
    startedAt: s.startedAt,
    durationSeconds: s.durationSeconds,
    endedAt: s.endedAt,
    // Passed through as-is, NOT defaulted to [] — a session saved before
    // this field existed has it as undefined, which the Schedule
    // insights sheet deliberately treats differently from a genuinely
    // empty array (see Schedule.jsx's pause-detail rendering).
    pauseLog: s.pauseLog,
  }))
}

// One-time fetch of a day's scheduled blocks — same shape as
// useScheduleBlocks' live list, but a plain read for call sites (like
// copyScheduleBlocks below) that need one day's blocks without
// subscribing to them.
export async function fetchScheduleBlocks(uid, dateId) {
  const snap = await get(ref(db, `schedules/${uid}/${dateId}`))
  const value = snap.val() || {}
  return Object.entries(value)
    .map(([id, block]) => ({ id, ...block }))
    .sort((a, b) => a.startMs - b.startMs)
}

// Copies every block from one day onto another, keeping each block's
// time-of-day rather than its absolute timestamp — a 9-10am block on the
// source day lands at 9-10am on the target day, correct even when the two
// days are on opposite sides of a DST change. Skips any copied block that
// would overlap one already on the target day — the app's adherence
// scoring assumes same-day blocks never overlap (see lib/adherence.js),
// and today the only caller only shows "copy" when the target day is
// already empty, but that's a UI-level coincidence, not a guarantee this
// function should rely on. Returns { copied, skipped } so the caller can
// tell "nothing to copy" apart from "some couldn't be copied" apart from
// a network failure.
export async function copyScheduleBlocks(uid, fromDateId, toDateId) {
  const [sourceBlocks, existingBlocks] = await Promise.all([
    fetchScheduleBlocks(uid, fromDateId),
    fetchScheduleBlocks(uid, toDateId),
  ])
  const [ty, tm, td] = toDateId.split('-').map(Number)
  const placed = [...existingBlocks]
  let copied = 0
  for (const block of sourceBlocks) {
    const from = new Date(block.startMs)
    const to = new Date(block.endMs)
    const startMs = new Date(ty, tm - 1, td, from.getHours(), from.getMinutes(), 0, 0).getTime()
    const endMs = new Date(ty, tm - 1, td, to.getHours(), to.getMinutes(), 0, 0).getTime()
    if (placed.some((p) => startMs < p.endMs && endMs > p.startMs)) continue // would overlap — skip it
    // eslint-disable-next-line no-await-in-loop -- sequential on purpose, so `placed` reflects every prior write before the next overlap check
    await addScheduleBlock(uid, toDateId, { title: block.title, type: block.type, startMs, endMs })
    placed.push({ startMs, endMs })
    copied += 1
  }
  return { copied, skipped: sourceBlocks.length - copied }
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
