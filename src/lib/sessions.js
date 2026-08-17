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
//
// breaksAllowed / breakDurationSeconds configure the session's break
// budget (see startBreak/endBreak below); pausedAt + pausedSeconds track
// time spent paused/on-break so elapsed math can exclude it.
export async function startSession(uid, groupIds, mode, targetSeconds = null, breaksAllowed = 0, breakDurationSeconds = 0) {
  const existing = await get(ref(db, `activeSessions/${uid}`))
  if (existing.exists()) return existing.val() // idempotent: never double-start

  const sessionId = push(ref(db, `activeSessions/${uid}`)).key
  const session = {
    sessionId,
    startedAt: serverTimestamp(),
    mode,
    targetSeconds: targetSeconds ?? null,
    status: 'active',
    pausedAt: null,
    pausedSeconds: 0,
    breaksAllowed,
    breaksTaken: 0,
    breakDurationSeconds,
  }

  const updates = { [`activeSessions/${uid}`]: session }
  for (const groupId of groupIds) {
    updates[`groups/${groupId}/live/${uid}`] = {
      sessionId,
      startedAt: serverTimestamp(),
      mode,
      targetSeconds: targetSeconds ?? null,
      status: 'active',
      pausedAt: null,
      pausedSeconds: 0,
    }
  }
  await update(ref(db), updates)
  return session
}

// Generic pause — stops the focus clock without touching the break budget.
export async function pauseSession(uid, groupIds) {
  const updates = {
    [`activeSessions/${uid}/status`]: 'paused',
    [`activeSessions/${uid}/pausedAt`]: serverTimestamp(),
  }
  for (const groupId of groupIds) {
    updates[`groups/${groupId}/live/${uid}/status`] = 'paused'
    updates[`groups/${groupId}/live/${uid}/pausedAt`] = serverTimestamp()
  }
  await update(ref(db), updates)
}

// Resumes from a plain pause OR a break, folding the paused span into
// pausedSeconds so the focus clock keeps excluding it correctly.
export async function resumeSession(uid, groupIds) {
  const snap = await get(ref(db, `activeSessions/${uid}`))
  if (!snap.exists()) return
  const session = snap.val()
  if (session.status === 'active' || !session.pausedAt) return

  const spent = Math.max(0, (Date.now() - session.pausedAt) / 1000)
  const pausedSeconds = (session.pausedSeconds || 0) + spent

  const updates = {
    [`activeSessions/${uid}/status`]: 'active',
    [`activeSessions/${uid}/pausedAt`]: null,
    [`activeSessions/${uid}/pausedSeconds`]: pausedSeconds,
  }
  for (const groupId of groupIds) {
    updates[`groups/${groupId}/live/${uid}/status`] = 'active'
    updates[`groups/${groupId}/live/${uid}/pausedAt`] = null
    updates[`groups/${groupId}/live/${uid}/pausedSeconds`] = pausedSeconds
  }
  await update(ref(db), updates)
}

// Starts a break: same pause mechanism as pauseSession, tagged 'onBreak'
// (so the UI shows a break countdown) and consumes one of the session's
// allotted breaks. No-ops once the break budget is used up.
export async function startBreak(uid, groupIds) {
  const snap = await get(ref(db, `activeSessions/${uid}`))
  if (!snap.exists()) return
  const session = snap.val()
  if (session.status !== 'active') return
  if ((session.breaksTaken || 0) >= (session.breaksAllowed || 0)) return

  const updates = {
    [`activeSessions/${uid}/status`]: 'onBreak',
    [`activeSessions/${uid}/pausedAt`]: serverTimestamp(),
    [`activeSessions/${uid}/breaksTaken`]: (session.breaksTaken || 0) + 1,
  }
  for (const groupId of groupIds) {
    updates[`groups/${groupId}/live/${uid}/status`] = 'onBreak'
    updates[`groups/${groupId}/live/${uid}/pausedAt`] = serverTimestamp()
  }
  await update(ref(db), updates)
}

// Ending a break folds the elapsed break time back in exactly like a plain
// resume — same math, so they share one implementation.
export const endBreak = resumeSession

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

  // Step 1: create the group and add the creator as a member. Committed
  // to the database before step 2, so the userGroups rule (which checks
  // that this membership exists) always sees real, already-written data
  // rather than depending on same-request sibling-write visibility.
  await update(ref(db), {
    [`groups/${groupId}/name`]: name,
    [`groups/${groupId}/inviteCode`]: code,
    [`groups/${groupId}/createdBy`]: uid,
    [`groups/${groupId}/createdAt`]: serverTimestamp(),
    [`groups/${groupId}/members/${uid}`]: { displayName, photoURL: photoURL ?? null, joinedAt: serverTimestamp() },
    [`inviteCodes/${code}`]: groupId,
  })

  // Step 2: index the group under the user now that membership is real.
  await update(ref(db), {
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
  if (members[uid]) return { groupId } // already a member
  if (Object.keys(members).length >= MAX_GROUP_SIZE) return { error: 'full' }

  // Same two-step ordering as createGroup, for the same reason.
  await update(ref(db), {
    [`groups/${groupId}/members/${uid}`]: { displayName, photoURL: photoURL ?? null, joinedAt: serverTimestamp() },
  })
  await update(ref(db), {
    [`userGroups/${uid}/${groupId}`]: true,
  })

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
