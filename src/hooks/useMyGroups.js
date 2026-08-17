import { useEffect, useState } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'

// Group summaries keep membership/name group-owned, but live presence is
// derived from each member's user-owned active session.
export function useMyGroups(groupIds) {
  const [summaries, setSummaries] = useState({})

  useEffect(() => {
    const unsubs = []

    groupIds.forEach((groupId) => {
      let members = {}
      const liveByUid = {}
      const memberUnsubs = new Map()

      const publish = (patch = {}) => {
        setSummaries((prev) => ({
          ...prev,
          [groupId]: {
            ...(prev[groupId] || {}),
            ...patch,
            memberCount: Object.keys(members).length,
            liveCount: Object.values(liveByUid).filter(Boolean).length,
          },
        }))
      }

      unsubs.push(onValue(ref(db, `groups/${groupId}/name`), (s) => publish({ name: s.val() })))

      const unsubMembers = onValue(ref(db, `groups/${groupId}/members`), (s) => {
        const next = s.val() || {}

        Object.keys(members).filter((uid) => !next[uid]).forEach((uid) => {
          memberUnsubs.get(uid)?.()
          memberUnsubs.delete(uid)
          delete liveByUid[uid]
        })

        members = next

        Object.keys(members).forEach((uid) => {
          if (memberUnsubs.has(uid)) return
          const unsub = onValue(ref(db, `activeSessions/${uid}`), (sessionSnap) => {
            liveByUid[uid] = sessionSnap.exists() ? sessionSnap.val() : null
            publish()
          })
          memberUnsubs.set(uid, unsub)
        })

        publish()
      })

      unsubs.push(unsubMembers)
      unsubs.push(() => memberUnsubs.forEach((u) => u()))
    })

    return () => unsubs.forEach((u) => u())
  }, [JSON.stringify(groupIds)])

  return groupIds.map((id) => ({ id, ...(summaries[id] || {}) }))
}
