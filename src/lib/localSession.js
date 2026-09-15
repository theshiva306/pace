// Local-first storage for the active session. This is the source of
// truth for "is my timer running right now" — every timer action
// (start/pause/resume/break/stop) applies here first, synchronously, so
// the UI and the underlying session state never depend on having a
// network connection. lib/sessionSync.js pushes this up to Firebase
// whenever a connection is available; Firebase exists for cross-device
// state and for groups to see your live status, not as the thing the
// timer itself depends on to keep running.
import { bankStreakUpdate } from './sessionMath'
import { dayId } from './day'
import { isoWeekId } from './week'
import { writeHandoff } from './sessionHandoff'

export const LOCAL_SESSION_CHANGE_EVENT = 'pace:localSessionChanged'

function sessionKey(uid) { return `pace:localSession:${uid}` }
function dirtyKey(uid) { return `pace:localSession:${uid}:dirty` }
function updatedAtKey(uid) { return `pace:localSession:${uid}:updatedAt` }

export function readLocalSession(uid) {
  try {
    const raw = localStorage.getItem(sessionKey(uid))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function readLocalUpdatedAt(uid) {
  try {
    const raw = localStorage.getItem(updatedAtKey(uid))
    return raw ? Number(raw) : 0
  } catch {
    return 0
  }
}

// Persists the session and notifies every mounted useActiveSession()
// instance in this tab (there's normally just one, but this keeps
// multiple call sites — the timer UI and any future consumer — in sync
// without threading React state through the lib layer). Used both by
// the local mutators below and by useActiveSession when it adopts an
// incoming, non-conflicting value from Firebase or from the service
// worker's IndexedDB handoff (see lib/sessionHandoff.js).
//
// `updatedAt` defaults to now, but useActiveSession passes the source's
// own timestamp explicitly when adopting an external value — otherwise
// every adoption would stamp "now," permanently masking how fresh the
// data actually is and defeating the handoff's whole freshness check.
export function writeLocalSession(uid, session, updatedAt = Date.now()) {
  try {
    if (session) localStorage.setItem(sessionKey(uid), JSON.stringify(session))
    else localStorage.removeItem(sessionKey(uid))
    localStorage.setItem(updatedAtKey(uid), String(updatedAt))
  } catch {
    // Storage can fail (private browsing, full quota) — the app still
    // works for the current tab session via React state, it just won't
    // survive a reload. Same tradeoff already accepted elsewhere in this
    // codebase (see useActiveSession's original cache).
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(LOCAL_SESSION_CHANGE_EVENT, { detail: { uid } }))
  }
  // Best-effort, fire-and-forget — this mirror only matters if the app
  // gets fully closed before the next Firebase sync, so nothing here
  // should ever block the fast, synchronous localStorage path above.
  writeHandoff(uid, session, updatedAt)
}

// "Dirty" = this device has local changes Firebase doesn't know about
// yet. While dirty, an incoming Firebase value must not overwrite local
// state (see useActiveSession) — it's necessarily stale relative to
// what's actually happening on this device. lib/sessionSync.js clears
// this the moment its push to Firebase actually lands.
export function isDirty(uid) {
  try { return localStorage.getItem(dirtyKey(uid)) === '1' } catch { return false }
}

export function markDirty(uid) {
  try { localStorage.setItem(dirtyKey(uid), '1') } catch { /* best-effort */ }
}

export function clearDirty(uid) {
  try { localStorage.removeItem(dirtyKey(uid)) } catch { /* best-effort */ }
}

function localId() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `local-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

// Below mirrors lib/sessions.js's transactional mutators exactly (same
// bankStreakUpdate math, same status-guard rules) but writes to
// localStorage synchronously instead of to Firebase — no network, no
// promise, no failure mode. Double-taps are naturally harmless: each
// function no-ops if the session isn't in the state it expects, the same
// guard the Firebase transactions use.

export function startLocal(uid, mode, targetSeconds, breaksAllowed, breakDurationSeconds, now, sessionType = 'focus') {
  const session = {
    sessionId: localId(),
    startedAt: now,
    activeSince: now,
    firstDayId: dayId(new Date(now)),
    firstWeekId: isoWeekId(new Date(now)),
    mode,
    // 'focus' | 'semiFocus' — lectures/coaching vs. tests/practice, see
    // lib/schedule.js. Defaults to 'focus' for callers that predate this
    // field, same backward-compat convention as the rest of this file.
    sessionType,
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
  writeLocalSession(uid, session)
  markDirty(uid)
  return session
}

export function pauseLocal(uid, session, now) {
  if (!session || session.status !== 'active') return session
  const bank = bankStreakUpdate(session, now)
  const next = { ...session, status: 'paused', pausedAt: now, ...bank }
  writeLocalSession(uid, next)
  markDirty(uid)
  return next
}

export function resumeLocal(uid, session, now) {
  if (!session || session.status === 'active' || !session.pausedAt) return session
  const spent = Math.max(0, (now - Number(session.pausedAt)) / 1000)
  const next = {
    ...session,
    status: 'active',
    pausedAt: null,
    pausedSeconds: (session.pausedSeconds || 0) + spent,
    activeSince: now,
  }
  writeLocalSession(uid, next)
  markDirty(uid)
  return next
}

export function startBreakLocal(uid, session, now) {
  if (!session || session.status !== 'active' || (session.breaksTaken || 0) >= (session.breaksAllowed || 0)) return session
  const bank = bankStreakUpdate(session, now)
  const next = { ...session, status: 'onBreak', pausedAt: now, breaksTaken: (session.breaksTaken || 0) + 1, ...bank }
  writeLocalSession(uid, next)
  markDirty(uid)
  return next
}

export const endBreakLocal = resumeLocal

export function stopLocal(uid, session, { durationSeconds, reason = 'manual', now }) {
  if (!session || session.status === 'stopped') return session
  const bank = session.status === 'active' ? bankStreakUpdate(session, now) : {}
  const next = {
    ...session, ...bank, status: 'stopped', stoppedAt: now, finalDurationSeconds: durationSeconds, stopReason: reason,
  }
  writeLocalSession(uid, next)
  markDirty(uid)
  return next
}

// Used both after a successful save and after discarding a stopped
// session. Still marks dirty (not clearDirty!) — clearing an existing
// session is itself a change Firebase needs to hear about, otherwise a
// session someone deleted on this device would reappear once Firebase's
// stale copy synced back down.
export function clearLocalSession(uid) {
  writeLocalSession(uid, null)
  markDirty(uid)
}
