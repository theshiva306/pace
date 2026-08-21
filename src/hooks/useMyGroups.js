import { useEffect, useState } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import { isCurrentlyLive } from '../lib/staleSession'

// Group summaries keep membership/name group-owned, but live presence is
// derived from each member's user-owned active session.
export function useMyGroups(groupIds) {
  const [summaries, setSummaries] = useState({})
  // Deliberately keyed on content, not array identity — a new groupIds
  // array with the same ids shouldn't tear down and recreate every
  // subscription below.
  const groupIdsKey = JSON.stringify(groupIds)

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
            liveCount: Object.values(liveByUid).filter((s) => isCurrentlyLive(s, Date.now())).length,
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

      // Nothing about a paused session's Firebase data changes the instant
      // it crosses the staleness threshold — there's no write to react to.
      // Re-publish periodically so the "live" badge still drops on its own
      // once enough time has passed, without needing a fresh Firebase
      // update to trigger it. Every 60s is plenty against a 3-hour window.
      const staleCheckId = window.setInterval(() => publish(), 60000)
      unsubs.push(() => window.clearInterval(staleCheckId))
    })

    return () => unsubs.forEach((u) => u())
  }, [groupIdsKey])

  return groupIds.map((id) => ({ id, ...(summaries[id] || {}) }))
}
