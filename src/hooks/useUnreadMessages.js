import { useEffect, useState } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import { markGroupRead } from '../lib/sessions'

// Unread count for a group's chat, based on the newest message timestamp
// the person has actually seen. Synced to their account (users/{uid}/
// lastRead/{groupId} in Firebase, via markGroupRead), not stored locally
// — opening the chat on a phone and then a laptop needs to show the same
// unread state, which a per-device localStorage value never could.
//
// `isViewing` should be true while the Chat tab is the one currently on
// screen — the moment that's true, everything currently loaded gets
// marked read (including anything that arrives while still looking at
// it), the same way basically every chat app behaves. Messages the person
// sent themselves never count as unread.
export function useUnreadMessages(groupId, messages, currentUid, isViewing) {
  const [lastRead, setLastRead] = useState(0)

  useEffect(() => {
    if (!groupId || !currentUid) return undefined
    const unsub = onValue(ref(db, `users/${currentUid}/lastRead/${groupId}`), (s) => {
      setLastRead(Number(s.val()) || 0)
    })
    return unsub
  }, [groupId, currentUid])

  useEffect(() => {
    if (!isViewing || !messages.length) return
    const latest = messages[messages.length - 1].timestamp || 0
    if (latest > lastRead) {
      // Written immediately here rather than waiting for the subscription
      // above to round-trip back — the account sync above is what makes
      // this show correctly on *other* devices, not what this device
      // needs to know it's already read.
      setLastRead(latest)
      markGroupRead(currentUid, groupId, latest).catch(() => {
        // Offline, etc. — the next time this fires (or the subscription
        // above catching up once back online) corrects it; worst case is
        // a briefly stale badge, not a lost read receipt.
      })
    }
  }, [isViewing, messages, groupId, currentUid, lastRead])

  return messages.filter((m) => m.uid !== currentUid && (m.timestamp || 0) > lastRead).length
}
