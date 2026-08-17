import { useEffect, useState } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'

// Group name, invite code, membership, and chat stay real-time — these
// change rarely enough (or need to feel instant, in chat's case) that
// there's no downside to a live subscription. Presence ("live") and
// totals are handled separately via usePolledValue, deliberately not
// real-time — see GroupDetail.jsx.
export function useGroup(groupId) {
  const [group, setGroup] = useState(undefined)
  const [members, setMembers] = useState({})
  const [messages, setMessages] = useState([])

  useEffect(() => {
    if (!groupId) return
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

  return { group, members, messages }
}
