import { ref, set, runTransaction } from 'firebase/database'
import { db } from '../firebase'
import { ensureUserStats } from './userStats'
import { readLocalSession, isDirty, clearDirty } from './localSession'
import { readPendingCompleted, removePendingCompleted } from './pendingCompleted'

// Pushes whatever's authoritative on this device up to Firebase. Local
// always wins here: it's the state that was actually produced by
// whatever the person did on this device (possibly while offline), and
// Firebase is catching up so other devices and groups can see it. For a
// single-person study timer that's the right tradeoff — the realistic
// conflict case (starting a session on two devices at once while both
// are offline) is rare, and "whichever device reconnects and syncs last
// wins" is the same last-write-wins rule Firebase already applies to
// every other write in this app.
//
// A plain set() rather than a transaction: the local session object
// already has its final computed status/pausedSeconds/banked totals —
// unlike lib/sessions.js's mutators, this isn't computing anything from
// a possibly-stale read, it's declaring "this is the current truth."
export async function syncActiveSession(uid) {
  if (!uid || !isDirty(uid)) return
  const local = readLocalSession(uid)
  await set(ref(db, `activeSessions/${uid}`), local) // local === null clears Firebase's copy too
  clearDirty(uid)
}

// Flushes anything saved while offline into completedSessions. Each
// record's sessionId is used as the Firebase key and the write is a
// transaction that aborts if that key already exists — so a flush that
// gets interrupted partway (connection drops again) and retries later
// can't double-write the same session or double-count it in stats.
export async function flushPendingCompletedSessions(uid) {
  if (!uid) return
  for (const record of readPendingCompleted(uid)) {
    const completedRef = ref(db, `completedSessions/${uid}/${record.sessionId}`)
    // eslint-disable-next-line no-await-in-loop -- each record must land (or be confirmed already-landed) before the next is attempted, so a mid-flush disconnect leaves the queue in a consistent, resumable state
    const { committed } = await runTransaction(completedRef, (current) => {
      if (current) return undefined // a previous, interrupted flush already got this one through
      return record.data
    })
    removePendingCompleted(uid, record.sessionId)
    // eslint-disable-next-line no-await-in-loop
    if (committed) await ensureUserStats(uid)
  }
}
