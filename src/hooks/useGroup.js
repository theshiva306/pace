import { useEffect, useState } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'

// Group membership, chat, and the group's display metadata remain group-owned.
// Study totals and live presence are user-owned data. The group subscribes to
// each member's public study stats, so joining a new group immediately shows
// that user's existing totals instead of depending on old group snapshots.
export function useGroup(groupId, weekId, dayId) {
  const [group, setGroup] = useState(undefined)
  const [members, setMembers] = useState({})
  const [messages, setMessages] = useState([])
  const [weekly, setWeekly] = useState({})
  const [sessionCounts, setSessionCounts] = useState({})
  const [daily, setDaily] = useState({})
  const [live, setLive] = useState({})

  useEffect(() => {
    if (!groupId) return undefined
    const unsubs = [
      onValue(ref(db, `groups/${groupId}/name`), (s) =>
        setGroup((g) => ({ ...(g || {}), name: s.val() }))),
      onValue(ref(db, `groups/${groupId}/inviteCode`), (s) =>
        setGroup((g) => ({ ...(g || {}), inviteCode: s.val() }))),
      onValue(ref(db, `groups/${groupId}/adminUid`), (s) =>
        setGroup((g) => ({ ...(g || {}), adminUid: s.val() }))),
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

  return { group, members, messages, weekly, sessionCounts, daily, live }
}
