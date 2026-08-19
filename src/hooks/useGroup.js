import { useEffect, useMemo, useState } from 'react'
import { ref, onValue, remove } from 'firebase/database'
import { db } from '../firebase'
import { isCurrentlyLive } from '../lib/staleSession'

const CHAT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

// If someone pauses (or steps into a break) and never comes back, their
// activeSessions node just sits there forever — there's no server-side
// expiry. Left unfiltered, that stale "paused" state would show up in the
// group's Live tab indefinitely. Anything paused/on a break for longer
// than STALE_PAUSE_MS (see lib/staleSession.js) stops counting as "live"
// for display purposes — as far as everyone else in the group is
// concerned, that person just isn't focusing right now. Their already-
// accumulated time is untouched (see the totals below); the owner's own
// Timer screen handles prompting them to actually resolve the session
// (save or discard) once they reopen it.

// Group membership, chat, and display metadata remain group-owned.
// Study totals and live presence are user-owned. The group subscribes to
// each member's userStats and activeSessions, so joining a new group
// immediately exposes the user's existing stats and current session.
export function useGroup(groupId, weekId, dayId) {
  const [group, setGroup] = useState(undefined)
  const [members, setMembers] = useState({})
  const [messages, setMessages] = useState([])
  const [weekly, setWeekly] = useState({})
  const [sessionCounts, setSessionCounts] = useState({})
  const [daily, setDaily] = useState({})
  const [live, setLive] = useState({})
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!groupId) return undefined
    const unsubs = [
      onValue(ref(db, `groups/${groupId}/name`), (s) =>
        setGroup((g) => ({ ...(g || {}), name: s.val() }))),
      onValue(ref(db, `groups/${groupId}/adminUid`), (s) =>
        setGroup((g) => ({ ...(g || {}), adminUid: s.val(), inviteCode: groupId }))),
      onValue(ref(db, `groups/${groupId}/members`), (s) => setMembers(s.val() || {})),
      onValue(ref(db, `groups/${groupId}/messages`), async (s) => {
        const val = s.val() || {}
        const cutoff = Date.now() - CHAT_RETENTION_MS
        const entries = Object.entries(val)
        const expiredIds = entries
          .filter(([, m]) => Number(m?.timestamp) > 0 && Number(m.timestamp) < cutoff)
          .map(([id]) => id)

        // Realtime Database has no built-in TTL. Every group member opening
        // the chat performs the same safe cleanup, so messages older than
        // seven days disappear without requiring a separate backend.
        if (expiredIds.length) {
          await Promise.all(expiredIds.map((id) => remove(ref(db, `groups/${groupId}/messages/${id}`)).catch(() => {})))
        }

        setMessages(entries
          .filter(([, m]) => !m?.timestamp || Number(m.timestamp) >= cutoff)
          .map(([id, m]) => ({ id, ...m }))
          .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)))
      }),
    ]
    return () => unsubs.forEach((u) => u())
  }, [groupId])

  useEffect(() => {
    const uids = Object.keys(members)
    if (!uids.length || !weekId || !dayId) {
      setWeekly({})
      setSessionCounts({})
      setDaily({})
      setLive({})
      return undefined
    }

    const nextWeekly = {}
    const nextCounts = {}
    const nextDaily = {}
    const nextLive = {}
    const unsubs = []

    for (const uid of uids) {
      unsubs.push(onValue(ref(db, `userStats/${uid}/weeklyTotals/${weekId}`), (s) => {
        nextWeekly[uid] = s.val() || 0
        setWeekly({ ...nextWeekly })
      }))
      unsubs.push(onValue(ref(db, `userStats/${uid}/weeklySessionCounts/${weekId}`), (s) => {
        nextCounts[uid] = s.val() || 0
        setSessionCounts({ ...nextCounts })
      }))
      unsubs.push(onValue(ref(db, `userStats/${uid}/dailyTotals/${dayId}`), (s) => {
        nextDaily[uid] = s.val() || 0
        setDaily({ ...nextDaily })
      }))
      unsubs.push(onValue(ref(db, `activeSessions/${uid}`), (s) => {
        nextLive[uid] = s.val() || null
        setLive({ ...nextLive })
      }))
    }

    return () => unsubs.forEach((u) => u())
  }, [members, weekId, dayId])

  const hasLive = Object.values(live).some(Boolean)
  useEffect(() => {
    if (!hasLive) return undefined
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [hasLive])

  // displayLive drives "who's currently focusing/paused/onBreak" for the
  // Live tab and badge counts — abandoned sessions drop out of that once
  // stale. It's deliberately NOT used for the totals below: a paused
  // session's contribution to weekly/daily is already frozen the instant
  // it's paused (see isCurrentlyLive's comment), so those numbers stay
  // exactly as they were the moment the person paused — nothing to zero
  // out, and nothing that needs "waiting for staleness" to be correct.
  const displayLive = useMemo(() => {
    const result = {}
    for (const [uid, session] of Object.entries(live)) {
      result[uid] = isCurrentlyLive(session, now) ? session : null
    }
    return result
  }, [live, now])

  const realtimeWeekly = useMemo(() => {
    const result = { ...weekly }
    for (const [uid, session] of Object.entries(live)) {
      if (!session) continue
      result[uid] = (result[uid] || 0) + focusSeconds(session, now)
    }
    return result
  }, [weekly, live, now])

  const realtimeDaily = useMemo(() => {
    const result = { ...daily }
    for (const [uid, session] of Object.entries(live)) {
      if (!session) continue
      result[uid] = (result[uid] || 0) + focusSeconds(session, now)
    }
    return result
  }, [daily, live, now])

  return {
    group,
    members,
    messages,
    weekly: realtimeWeekly,
    sessionCounts,
    daily: realtimeDaily,
    live: displayLive,
  }
}

function focusSeconds(session, now) {
  if (!session?.startedAt) return 0
  const total = Math.max(0, (now - Number(session.startedAt)) / 1000)
  const pausedBefore = Math.max(0, Number(session.pausedSeconds) || 0)
  const pausedNow = session.status !== 'active' && session.pausedAt
    ? Math.max(0, (now - Number(session.pausedAt)) / 1000)
    : 0
  return Math.floor(Math.max(0, total - pausedBefore - pausedNow))
}
