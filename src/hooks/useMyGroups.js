import { useEffect, useState } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'

// Subscribes to lightweight summaries (name, member count, live count) for
// each group the user belongs to — enough to render the Groups list.
export function useMyGroups(groupIds) {
  const [summaries, setSummaries] = useState({})

  useEffect(() => {
    const unsubs = groupIds.map((groupId) => {
      const unsubName = onValue(ref(db, `groups/${groupId}/name`), (s) =>
        setSummaries((prev) => ({ ...prev, [groupId]: { ...(prev[groupId] || {}), name: s.val() } })))
      const unsubMembers = onValue(ref(db, `groups/${groupId}/members`), (s) =>
        setSummaries((prev) => ({
          ...prev,
          [groupId]: { ...(prev[groupId] || {}), memberCount: s.exists() ? Object.keys(s.val()).length : 0 },
        })))
      const unsubLive = onValue(ref(db, `groups/${groupId}/live`), (s) =>
        setSummaries((prev) => ({
          ...prev,
          [groupId]: { ...(prev[groupId] || {}), liveCount: s.exists() ? Object.keys(s.val()).length : 0 },
        })))
      return () => { unsubName(); unsubMembers(); unsubLive() }
    })
    return () => unsubs.forEach((u) => u())
  }, [JSON.stringify(groupIds)])

  return groupIds.map((id) => ({ id, ...(summaries[id] || {}) }))
}
