import {
  ref, set, get, remove, update, push, serverTimestamp, runTransaction,
} from 'firebase/database'
import { db } from '../firebase'
import { isoWeekId } from './week'

// Default max members per group. Change here to adjust everywhere.
export const MAX_GROUP_SIZE = 6

// ---- Active session (single source of truth: /activeSessions/{uid}) ----

export async function getActiveSession(uid) {
  const snap = await get(ref(db, `activeSessions/${uid}`))
  return snap.exists() ? snap.val() : null
}

// Starts a session. Mirrors a lightweight "live" pointer into every group
// the user belongs to, so each group's LIVE view can listen without
// reading other users' private activeSessions node.
export async function startSession(uid, groupIds, mode, targetSeconds = null) {
  const existing = await get(ref(db, `activeSessions/${uid}`))
  if (existing.exists()) return existing.val() // idempotent: never double-start

  const sessionId = push(ref(db, `activeSessions/${uid}`)).key
  const session = {
    sessionId,
    startedAt: serverTimestamp(),
    mode,
    targetSeconds: targetSeconds ?? null,
    status: 'active',
  }

  const updates = { [`activeSessions/${uid}`]: session }
  for (const groupId of groupIds) {
    updates[`groups/${groupId}/live/${uid}`] = {
      sessionId,
      startedAt: serverTimestamp(),
      mode,
      targetSeconds: targetSeconds ?? null,
    }
  }
  await update(ref(db), updates)
  return session
}

// Clears the active session everywhere (used by save + delete).
export async function clearActiveSession(uid, groupIds) {
  const updates = { [`activeSessions/${uid}`]: null }
  for (const groupId of groupIds) {
    updates[`groups/${groupId}/live/${uid}`] = null
  }
  await update(ref(db), updates)
}

// Saves a completed session: records it permanently, adds duration to the
// weekly leaderboard total (if the user is in a group), then clears the
// active/live pointers. Idempotent on sessionId so a double-tap or a race
// after refresh can't double-count. Clearing the active session always
// runs, even if the earlier writes fail, so a bad write can never leave
// the timer stuck.
export async function saveSession({ uid, groupId, groupIds, session, durationSeconds }) {
  const weekId = isoWeekId()
  try {
    const completedRef = ref(db, `completedSessions/${uid}/${session.sessionId}`)
    const already = await get(completedRef)
    if (!already.exists()) {
      await set(completedRef, {
        groupId: groupId ?? null,
        startedAt: session.startedAt,
        endedAt: serverTimestamp(),
        durationSeconds,
        weekId,
      })
      if (groupId) {
        await runTransaction(
          ref(db, `groups/${groupId}/weeklyTotals/${weekId}/${uid}`),
          (current) => (current ?? 0) + durationSeconds,
        )
      }
    }
  } finally {
    await clearActiveSession(uid, groupIds)
  }
}

export async function deleteSession({ uid, groupIds }) {
  await clearActiveSession(uid, groupIds)
}

// ---- Groups ----

function randomInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no ambiguous chars
  let code = ''
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

export async function createGroup({ uid, displayName, photoURL, name }) {
  const groupRef = push(ref(db, 'groups'))
  const groupId = groupRef.key
  let code = randomInviteCode()
  // Extremely unlikely collision, but guard anyway.
  for (let i = 0; i < 5; i++) {
    const existing = await get(ref(db, `inviteCodes/${code}`))
    if (!existing.exists()) break
    code = randomInviteCode()
  }

  const updates = {
    [`groups/${groupId}/name`]: name,
    [`groups/${groupId}/inviteCode`]: code,
    [`groups/${groupId}/createdBy`]: uid,
    [`groups/${groupId}/createdAt`]: serverTimestamp(),
    [`groups/${groupId}/members/${uid}`]: { displayName, photoURL, joinedAt: serverTimestamp() },
    [`inviteCodes/${code}`]: groupId,
    [`userGroups/${uid}/${groupId}`]: true,
  }
  await update(ref(db), updates)
  return groupId
}

export async function joinGroupByCode({ uid, displayName, photoURL, code }) {
  const cleanCode = code.trim().toUpperCase()
  const codeSnap = await get(ref(db, `inviteCodes/${cleanCode}`))
  if (!codeSnap.exists()) return { error: 'invalid' }
  const groupId = codeSnap.val()

  const membersSnap = await get(ref(db, `groups/${groupId}/members`))
  const members = membersSnap.val() || {}
  if (members[uid]) return { groupId } // already a member
  if (Object.keys(members).length >= MAX_GROUP_SIZE) return { error: 'full' }

  const updates = {
    [`groups/${groupId}/members/${uid}`]: { displayName, photoURL, joinedAt: serverTimestamp() },
    [`userGroups/${uid}/${groupId}`]: true,
  }
  await update(ref(db), updates)
  return { groupId }
}

export async function sendMessage({ groupId, uid, displayName, photoURL, text }) {
  const msgRef = push(ref(db, `groups/${groupId}/messages`))
  await set(msgRef, {
    uid,
    displayName,
    photoURL: photoURL ?? null,
    text,
    timestamp: serverTimestamp(),
  })
}

export async function updateDisplayName({ uid, groupIds, name }) {
  const updates = { [`users/${uid}/displayName`]: name }
  for (const groupId of groupIds) {
    updates[`groups/${groupId}/members/${uid}/displayName`] = name
  }
  await update(ref(db), updates)
}
