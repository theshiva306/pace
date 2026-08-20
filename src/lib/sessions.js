import {
  ref, set, get, remove, update, push, serverTimestamp,
} from 'firebase/database'
import { db } from '../firebase'
import { isoWeekId } from './week'
import { dayId } from './day'
import { ensureUserStats } from './userStats'
import { bankStreakUpdate } from './sessionMath'

export const MAX_GROUP_SIZE = 6

export async function startSession(uid, _groupIds, mode, targetSeconds = null, breaksAllowed = 0, breakDurationSeconds = 0) {
  const existing = await get(ref(db, `activeSessions/${uid}`))
  if (existing.exists()) return existing.val()
  const sessionId = push(ref(db, `activeSessions/${uid}`)).key
  const session = {
    sessionId,
    startedAt: serverTimestamp(),
    // Marks when the *current* active streak began — separate from
    // startedAt, which never changes. Updated at every resume/endBreak so
    // the precise today/this-week live totals in lib/sessionMath.js can
    // clip exactly at day/week boundaries instead of approximating from
    // a single cumulative pause total. See sessionMath.js for the design.
    activeSince: serverTimestamp(),
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
  await set(ref(db, `activeSessions/${uid}`), session)
  return session
}

export async function pauseSession(uid, _groupIds) {
  const snap = await get(ref(db, `activeSessions/${uid}`))
  if (!snap.exists()) return
  const session = snap.val()
  if (session.status !== 'active') return
  // Fold the streak that's ending right now into today's/this week's
  // banked totals, using the exact timestamps available at this instant
  // — see bankStreakUpdate's comment in sessionMath.js for why this has
  // to happen here rather than being reconstructed later.
  const bank = bankStreakUpdate(session, Date.now())
  await update(ref(db, `activeSessions/${uid}`), { status: 'paused', pausedAt: serverTimestamp(), ...bank })
}

export async function resumeSession(uid, _groupIds) {
  const snap = await get(ref(db, `activeSessions/${uid}`))
  if (!snap.exists()) return
  const session = snap.val()
  if (session.status === 'active' || !session.pausedAt) return
  const spent = Math.max(0, (Date.now() - Number(session.pausedAt)) / 1000)
  await update(ref(db, `activeSessions/${uid}`), {
    status: 'active',
    pausedAt: null,
    pausedSeconds: (session.pausedSeconds || 0) + spent,
    activeSince: serverTimestamp(), // a fresh streak starts now
  })
}

export async function startBreak(uid, _groupIds) {
  const snap = await get(ref(db, `activeSessions/${uid}`))
  if (!snap.exists()) return
  const session = snap.val()
  if (session.status !== 'active' || (session.breaksTaken || 0) >= (session.breaksAllowed || 0)) return
  const bank = bankStreakUpdate(session, Date.now())
  await update(ref(db, `activeSessions/${uid}`), {
    status: 'onBreak',
    pausedAt: serverTimestamp(),
    breaksTaken: (session.breaksTaken || 0) + 1,
    ...bank,
  })
}

export const endBreak = resumeSession

export async function clearActiveSession(uid, _groupIds) {
  await remove(ref(db, `activeSessions/${uid}`))
}

export async function saveSession({ uid, session, durationSeconds }) {
  const weekId = isoWeekId()
  const todayId = dayId()
  try {
    const completedRef = ref(db, `completedSessions/${uid}/${session.sessionId}`)
    const already = await get(completedRef)
    if (!already.exists()) {
      await set(completedRef, { startedAt: session.startedAt, endedAt: serverTimestamp(), durationSeconds, weekId, dayId: todayId })
      await ensureUserStats(uid)
    }
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

export async function setPinnedGroup(uid, groupId) { await update(ref(db), { [`users/${uid}/pinnedGroupId`]: groupId }) }

export async function updateDisplayName({ uid, groupIds, name }) {
  const updates = { [`users/${uid}/displayName`]: name }
  for (const groupId of groupIds) updates[`groups/${groupId}/members/${uid}/displayName`] = name
  await update(ref(db), updates)
}
