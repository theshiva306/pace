import { useEffect, useState } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'

export function useGroup(groupId) {
  const [group, setGroup] = useState(undefined)
  const [members, setMembers] = useState({})
  const [live, setLive] = useState({})
  const [messages, setMessages] = useState([])

  useEffect(() => {
    if (!groupId) return
    const unsubs = [
      onValue(ref(db, `groups/${groupId}/name`), (s) =>
        setGroup((g) => ({ ...(g || {}), name: s.val() }))),
      onValue(ref(db, `groups/${groupId}/inviteCode`), (s) =>
        setGroup((g) => ({ ...(g || {}), inviteCode: s.val() }))),
      onValue(ref(db, `groups/${groupId}/members`), (s) => setMembers(s.val() || {})),
      onValue(ref(db, `groups/${groupId}/live`), (s) => setLive(s.val() || {})),
      onValue(ref(db, `groups/${groupId}/messages`), (s) => {
        const val = s.val() || {}
        setMessages(Object.entries(val)
          .map(([id, m]) => ({ id, ...m }))
          .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)))
      }),
    ]
    return () => unsubs.forEach((u) => u())
  }, [groupId])

  return { group, members, live, messages }
}

export function useWeeklyTotals(groupId, weekId) {
  const [totals, setTotals] = useState({})
  useEffect(() => {
    if (!groupId || !weekId) return
    const unsub = onValue(ref(db, `groups/${groupId}/weeklyTotals/${weekId}`), (s) => {
      setTotals(s.val() || {})
    })
    return unsub
  }, [groupId, weekId])
  return totals
}
