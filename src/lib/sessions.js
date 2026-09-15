import {
  ref, set, get, remove, update, push, serverTimestamp, runTransaction,
} from 'firebase/database'
import { db } from '../firebase'
import { isoWeekId } from './week'
import { dayId } from './day'
import { ensureUserStats } from './userStats'
import { bankStreakUpdate, computeDaySplit, computeWeekSplit } from './sessionMath'

export const MAX_GROUP_SIZE = 6

// --- Concurrency note -----------------------------------------------
// Every mutator below runs through Firebase's runTransaction instead of
// a plain get()-then-update(). A session can legitimately be touched by
// more than one writer at close to the same moment — the same account
// open on two tabs or two devices, or the service worker's own
// Pause/Resume REST call (public/sw.js) racing whatever the open tab is
// doing. A plain read-modify-write there means both writers can read the
// same "before" state and both commit, silently double-adding to
// pausedSeconds/bankedDaySeconds or clobbering one write with the other.
// runTransaction re-reads the latest value and retries the whole update
// automatically if the data changed underneath it, which removes that
// window entirely. `now`/serverTimestamp aren't mixed inside a
// transaction body on purpose — server value placeholders can behave
// unpredictably across a transaction's internal retries, so timestamps
// here use the caller's already offset-corrected `now` (see
// useServerOffset/useSessionClock) instead of serverTimestamp().
// -----------------------------------------------------------------------

export async function startSession(uid, _groupIds, mode, targetSeconds = null, breaksAllowed = 0, breakDurationSeconds = 0, now = Date.now()) {
  const sessionRef = ref(db, `activeSessions/${uid}`)
  const sessionId = push(sessionRef).key // local key generation — no network round-trip needed
  const { snapshot } = await runTransaction(sessionRef, (current) => {
    if (current) return current // already exists — leave it untouched, don't clobber
    return {
      sessionId,
      startedAt: now,
      // Marks when the *current* active streak began — separate from
      // startedAt, which never changes. Updated at every resume/endBreak so
      // the precise today/this-week live totals in lib/sessionMath.js can
      // clip exactly at day/week boundaries instead of approximating from
      // a single cumulative pause total. See sessionMath.js for the design.
      activeSince: now,
      // Immutable — the day/week the session actually started on, never
      // updated again. Needed at save time to correctly attribute a
      // session's earlier portion to the day it really happened on rather
      // than the day it's saved on — see computeDaySplit/computeWeekSplit
      // in sessionMath.js.
      firstDayId: dayId(new Date(now)),
      firstWeekId: isoWeekId(new Date(now)),
      mode,
      targetSeconds: targetSeconds ?? null,
      status: 'active',
      pausedAt: null,
      pausedSeconds: 0,
      breaksAllowed,
      breaksTaken: 0,
      breakDurationSeconds,
      bankedDayId: null,
      bankedDaySeconds: 0,
      bankedWeekId: null,
      bankedWeekSeconds: 0,
    }
  })
  return snapshot.val()
}

export async function pauseSession(uid, _groupIds, now = Date.now()) {
  const sessionRef = ref(db, `activeSessions/${uid}`)
  await runTransaction(sessionRef, (session) => {
    if (!session || session.status !== 'active') return session // no-op, nothing to abort
    // Fold the streak that's ending right now into today's/this week's
    // banked totals, using the exact timestamps available at this instant
    // — see bankStreakUpdate's comment in sessionMath.js for why this has
    // to happen here rather than being reconstructed later.
    const bank = bankStreakUpdate(session, now)
    return { ...session, status: 'paused', pausedAt: now, ...bank }
  })
}

export async function resumeSession(uid, _groupIds, now = Date.now()) {
  const sessionRef = ref(db, `activeSessions/${uid}`)
  await runTransaction(sessionRef, (session) => {
    if (!session || session.status === 'active' || !session.pausedAt) return session
    const spent = Math.max(0, (now - Number(session.pausedAt)) / 1000)
    return {
      ...session,
      status: 'active',
      pausedAt: null,
      pausedSeconds: (session.pausedSeconds || 0) + spent,
      activeSince: now, // a fresh streak starts now
    }
  })
}

export async function startBreak(uid, _groupIds, now = Date.now()) {
  const sessionRef = ref(db, `activeSessions/${uid}`)
  await runTransaction(sessionRef, (session) => {
    if (!session || session.status !== 'active' || (session.breaksTaken || 0) >= (session.breaksAllowed || 0)) return session
    const bank = bankStreakUpdate(session, now)
    return {
      ...session,
      status: 'onBreak',
      pausedAt: now,
      breaksTaken: (session.breaksTaken || 0) + 1,
      ...bank,
    }
  })
}

export const endBreak = resumeSession

// The single, authoritative way any code path (a manual stop, the
// abandoned-session cleanup, a countdown reaching its target) marks a
// session as finished. Writes status: 'stopped' to Firebase immediately
// — this used to be tracked as local-only React state in Timer.jsx,
// computed independently in three separate places, with nothing telling
// the database it had happened. That meant Firebase kept saying the
// session was still 'active' the whole time someone was looking at the
// save screen — so anything that reset that local state before they
// tapped Save (navigating away and back, a reload, or unrelated
// resubscription churn) made the running session reappear, looking like
// stop "didn't work." Now the save/discard screen is *derived* from
// session.status === 'stopped' — a single source of truth that survives
// reloads, reconnects, and remounts, instead of independent local state
// that could silently drift out of sync with what the database actually
// says.
export async function stopSession(uid, _groupIds, { durationSeconds, reason = 'manual', now = Date.now() } = {}) {
  const sessionRef = ref(db, `activeSessions/${uid}`)
  await runTransaction(sessionRef, (session) => {
    if (!session || session.status === 'stopped') return session // already stopped — don't clobber
    // If still actively running, bank this final streak the same way
    // pauseSession/startBreak do, so the already-earned time keeps showing
    // correctly in group totals during the brief pending window before
    // Save/Delete is chosen — consistent with how a paused session behaves.
    const bank = session.status === 'active' ? bankStreakUpdate(session, now) : {}
    return {
      ...session,
      ...bank,
      status: 'stopped',
      stoppedAt: now,
      finalDurationSeconds: durationSeconds,
      stopReason: reason, // 'manual' | 'stale' | 'target'
    }
  })
}

export async function clearActiveSession(uid, _groupIds) {
  await remove(ref(db, `activeSessions/${uid}`))
}

export async function saveSession({ uid, session, durationSeconds }) {
  const dailyBreakdown = computeDaySplit(session, durationSeconds)
  const weeklyBreakdown = computeWeekSplit(session, durationSeconds)
  try {
    const completedRef = ref(db, `completedSessions/${uid}/${session.sessionId}`)
    // Transaction instead of get()-then-set(): a double-tap on Save, or a
    // retry after a slow connection makes the first attempt's result
    // ambiguous, must not create two records or double-run
    // ensureUserStats's totals. Returning undefined when a record already
    // exists aborts the write instead of clobbering or duplicating it.
    const { committed } = await runTransaction(completedRef, (current) => {
      if (current) return undefined // already saved — leave it alone
      return {
        startedAt: session.startedAt,
        endedAt: Date.now(),
        durationSeconds,
        dailyBreakdown,
        weeklyBreakdown,
      }
    })
    if (committed) await ensureUserStats(uid)
  } finally {
    await clearActiveSession(uid)
  }
}

export async function deleteSession({ uid, sessionId }) {
  if (!sessionId) return
  await remove(ref(db, `completedSessions/${uid}/${sessionId}`))
  await ensureUserStats(uid)
}

export async function deletePersonalData(uid) {
  if (!uid) throw new Error('Missing user id')

  // Delete personal Pace/study data only. Keep the account profile so the
  // signed-in user stays in the app after the reset. Group data and group
  // membership are intentionally untouched.
  await Promise.all([
    remove(ref(db, `activeSessions/${uid}`)),
    remove(ref(db, `completedSessions/${uid}`)),
    remove(ref(db, `userStats/${uid}`)),
    remove(ref(db, `userStatsPersonal/${uid}`)),
  ])
}

export async function createGroup({ uid, displayName, photoURL, name }) {
  const groupRef = push(ref(db, 'groups'))
  const groupId = groupRef.key
  await update(ref(db), {
    [`groups/${groupId}/name`]: name,
    [`groups/${groupId}/createdBy`]: uid,
    [`groups/${groupId}/createdAt`]: serverTimestamp(),
    [`groups/${groupId}/adminUid`]: uid,
    [`groups/${groupId}/members/${uid}`]: { displayName, photoURL: photoURL ?? null, joinedAt: serverTimestamp() },
    [`userGroups/${uid}/${groupId}`]: true,
  })
  return groupId
}

export async function joinGroupByLink({ uid, displayName, photoURL, groupId }) {
  if (!groupId) return { error: 'invalid' }

  const groupSnap = await get(ref(db, `groups/${groupId}/name`))
  if (!groupSnap.exists()) return { error: 'invalid' }

  const existingMember = await get(ref(db, `groups/${groupId}/members/${uid}`))
  if (existingMember.exists()) return { groupId }

  await update(ref(db), {
    [`groups/${groupId}/members/${uid}`]: { displayName, photoURL: photoURL ?? null, joinedAt: serverTimestamp() },
    [`userGroups/${uid}/${groupId}`]: true,
  })
  return { groupId }
}

export async function renameGroup({ groupId, name }) { await update(ref(db), { [`groups/${groupId}/name`]: name }) }

export async function deleteGroup({ groupId, memberUids }) {
  const updates = { [`groups/${groupId}`]: null }
  for (const uid of memberUids) updates[`userGroups/${uid}/${groupId}`] = null
  await update(ref(db), updates)
}

export async function removeMember({ groupId, targetUid }) {
  await update(ref(db), {
    [`groups/${groupId}/members/${targetUid}`]: null,
    [`userGroups/${targetUid}/${groupId}`]: null,
  })
}

export async function leaveGroup({ uid, groupId }) {
  const [groupSnap, membersSnap] = await Promise.all([get(ref(db, `groups/${groupId}`)), get(ref(db, `groups/${groupId}/members`))])
  const group = groupSnap.val() || {}
  const members = membersSnap.val() || {}
  const others = Object.entries(members).filter(([mUid]) => mUid !== uid)
  if (group.adminUid === uid && others.length === 0) return deleteGroup({ groupId, memberUids: Object.keys(members) })
  const updates = {
    [`groups/${groupId}/members/${uid}`]: null,
    [`userGroups/${uid}/${groupId}`]: null,
  }
  if (group.adminUid === uid && others.length > 0) {
    const [nextAdminUid] = others.sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0))[0]
    updates[`groups/${groupId}/adminUid`] = nextAdminUid
  }
  await update(ref(db), updates)
}

export async function sendMessage({ groupId, uid, displayName, photoURL, text }) {
  const msgRef = push(ref(db, `groups/${groupId}/messages`))
  await set(msgRef, { uid, displayName, photoURL: photoURL ?? null, text, timestamp: serverTimestamp() })
}

// Personal, not shared — clears *this person's own view* of the chat
// going forward, without touching the actual shared messages or anyone
// else's view of them. Stores a per-user, per-group "cleared before
// this point" marker under their own account (synced across their
// devices, same as lastRead below); anything sent before that point is
// simply filtered out of what they see, while everyone else's chat is
// completely unaffected.
export async function clearChatForSelf(uid, groupId, timestamp) {
  await set(ref(db, `users/${uid}/chatClearedAt/${groupId}`), timestamp)
}

// Per-account, not per-device — the unread badge should be the same
// whether someone's checking from their phone or their laptop, so "last
// read" lives under their own user node in Firebase (synced in real
// time via useUnreadMessages' subscription) rather than in localStorage,
// which only that one browser would ever see.
export async function markGroupRead(uid, groupId, timestamp) {
  await set(ref(db, `users/${uid}/lastRead/${groupId}`), timestamp)
}

export async function setPinnedGroup(uid, groupId) { await update(ref(db), { [`users/${uid}/pinnedGroupId`]: groupId }) }

export async function updateDisplayName({ uid, groupIds, name }) {
  const updates = { [`users/${uid}/displayName`]: name }
  for (const groupId of groupIds) updates[`groups/${groupId}/members/${uid}/displayName`] = name
  await update(ref(db), updates)
}
