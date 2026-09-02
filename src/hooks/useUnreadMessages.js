import { useEffect, useState } from 'react'

function storageKey(groupId, uid) {
  return `pace:lastRead:${groupId}:${uid}`
}

function readLastRead(groupId, uid) {
  try {
    return Number(localStorage.getItem(storageKey(groupId, uid))) || 0
  } catch {
    return 0
  }
}

// Unread count for a group's chat, based on the newest message timestamp
// the person has actually seen — persisted locally so it survives closing
// and reopening the app, not just switching tabs within one visit.
//
// `isViewing` should be true while the Chat tab is the one currently on
// screen — the moment that's true, everything currently loaded gets
// marked read (including anything that arrives while still looking at
// it), the same way basically every chat app behaves. Messages the person
// sent themselves never count as unread.
export function useUnreadMessages(groupId, messages, currentUid, isViewing) {
  const [lastRead, setLastRead] = useState(() => readLastRead(groupId, currentUid))

  useEffect(() => {
    if (!isViewing || !messages.length) return
    const latest = messages[messages.length - 1].timestamp || 0
    if (latest > lastRead) {
      setLastRead(latest)
      try {
        localStorage.setItem(storageKey(groupId, currentUid), String(latest))
      } catch {
        // Best-effort only — worst case the badge is slightly wrong next
        // load, not a correctness issue for the app itself.
      }
    }
  }, [isViewing, messages, groupId, currentUid, lastRead])

  return messages.filter((m) => m.uid !== currentUid && (m.timestamp || 0) > lastRead).length
}
