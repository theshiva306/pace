import {
  ref, set, get, remove, update, push, serverTimestamp,
} from 'firebase/database'
import { db } from '../firebase'
import { isoWeekId } from './week'
import { dayId } from './day'
import { ensureUserStats } from './userStats'

export const MAX_GROUP_SIZE = 6

// ---- Active session (single source of truth: /activeSessions/{uid}) ----
export async function getActiveSession(uid) {
  const snap = await get(ref(db, `activeSessions/${uid}`))
  return snap.exists() ? snap.val() : null
}

export async function startSession(uid, _groupIds, mode, targetSeconds = null, breaksAllowed = 0, breakDurationSeconds = 0) {
  const existing = await get(ref(db, `activeSessions/${uid}`))
  if (existing.exists()) return existing.val()
  const sessionId = push(ref(db, `activeSessions/${uid}`)).key
  const session = { sessionId, startedAt: serverTimestamp(), mode, targetSeconds: targetSeconds ?? null, status: 'active', pausedAt: null, pausedSeconds: 0, breaksAllowed, breaksTaken: 0, breakDurationSeconds }
  await set(ref(db, `activeSessions/${uid}`), session)
  return session
}

export async function pauseSession(uid, _groupIds) {
  await update(ref(db, `activeSessions/${uid}`), { status: 'paused', pausedAt: serverTimestamp() })
}

export async function resumeSession(uid, _groupIds) {
  const snap = await get(ref(db, `activeSessions/${uid}`))
  if (!snap.exists()) return
  const session = snap.val()
  if (session.status === 'active' || !session.pausedAt) return
  const spent = Math.max(0, (Date.now() - Number(session.pausedAt)) / 1000)
  await update(ref(db, `activeSessions/${uid}`), { status: 'active', pausedAt: null, pausedSeconds: (session.pausedSeconds || 0) + spent })
}

export async function startBreak(uid, _groupIds) {
  const snap = await get(ref(db, `activeSessions/${uid}`))
  if (!snap.exists()) return
  const session = snap.val()
  if (session.status !== 'active' || (session.breaksTaken || 0) >= (session.breaksAllowed || 0)) return
  await update(ref(db, `activeSessions/${uid}`), { status: 'onBreak', pausedAt: serverTimestamp(), breaksTaken: (session.breaksTaken || 0) + 1 })
}

export const endBreak = resumeSession

export async function clearActiveSession(uid, _groupIds) {
  await remove(ref(db, `activeSessions/${uid}`))
}

// Durable source of truth: completedSessions + userStats. Groups never own
// copies of study totals, so deleting/recreating a group cannot erase history.
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

// ---- Groups ----
function randomInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

export async function createGroup({ uid, displayName, photoURL, name }) {
  const groupRef = push(ref(db, 'groups'))
  const groupId = groupRef.key
  let code = randomInviteCode()
  for (let i = 0; i < 5; i++) { const existing = await get(ref(db, `inviteCodes/${code}`)); if (!existing.exists()) break; code = randomInviteCode() }
  await update(ref(db), {
    [`groups/${groupId}/name`]: name,
    [`groups/${groupId}/inviteCode`]: code,
    [`groups/${groupId}/createdBy`]: uid,
    [`groups/${groupId}/createdAt`]: serverTimestamp(),
    [`groups/${groupId}/adminUid`]: uid,
    [`groups/${groupId}/members/${uid}`]: { displayName, photoURL: photoURL ?? null, joinedAt: serverTimestamp() },
    [`inviteCodes/${code}`]: groupId,
    [`userGroups/${uid}/${groupId}`]: true,
  })
  return groupId
}

export async function joinGroupByCode({ uid, displayName, photoURL, code }) {
  const cleanCode = code.trim().toUpperCase()
  const codeSnap = await get(ref(db, `inviteCodes/${cleanCode}`))
  if (!codeSnap.exists()) return { error: 'invalid' }
  const groupId = codeSnap.val()
  const membersSnap = await get(ref(db, `groups/${groupId}/members`))
  const members = membersSnap.val() || {}
  if (members[uid]) return { groupId }
  if (Object.keys(members).length >= MAX_GROUP_SIZE) return { error: 'full' }
  await update(ref(db), {
    [`groups/${groupId}/members/${uid}`]: { displayName, photoURL: photoURL ?? null, joinedAt: serverTimestamp() },
    [`userGroups/${uid}/${groupId}`]: true,
  })
  return { groupId }
}

export async function renameGroup({ groupId, name }) { await update(ref(db), { [`groups/${groupId}/name`]: name }) }

export async function deleteGroup({ groupId, memberUids }) {
  const groupSnap = await get(ref(db, `groups/${groupId}`))
  const group = groupSnap.val() || {}
  const updates = { [`groups/${groupId}`]: null }
  for (const uid of memberUids) updates[`userGroups/${uid}/${groupId}`] = null
  if (group.inviteCode) updates[`inviteCodes/${group.inviteCode`] = null
  await update(ref(db), updates)
}

export async function removeMember({ groupId, targetUid }) {
  await update(ref(db), { [`groups/${groupId}/members/${targetUid}`]: null, [`userGroups/${targetUid}/${groupId}`]: null })
}

export async function leaveGroup({ uid, groupId }) {
  const [groupSnap, membersSnap] = await Promise.all([get(ref(db, `groups/${groupId}`)), get(ref(db, `groups/${groupId}/members`))])
  const group = groupSnap.val() || {}
  const members = membersSnap.val() || {}
  const others = Object.entries(members).filter(([mUid]) => mUid !== uid)
  if (group.adminUid === uid && others.length === 0) return deleteGroup({ groupId, memberUids: Object.keys(members) })
  const updates = { [`groups/${groupId}/members/${uid}`]: null, [`userGroups/${uid}/${groupId}`]: null }
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
