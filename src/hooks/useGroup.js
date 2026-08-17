import { useEffect, useMemo, useState } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'

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
      onValue(ref(db, `groups/${groupId}/messages`), (s) => {
        const val = s.val() || {}
        setMessages(Object.entries(val)
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
    live,
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
