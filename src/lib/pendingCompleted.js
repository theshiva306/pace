// A "Save" tap always succeeds locally, immediately, regardless of
// connectivity — the completed-session record goes here first, and
// lib/sessionSync.js flushes it into Firebase's completedSessions node
// once a connection is available. Each record carries its own
// locally-generated sessionId as the eventual Firebase key, so a flush
// that's retried (e.g. connection drops mid-flush) can't create a
// duplicate — see flushPendingCompletedSessions's use of a transaction
// keyed on that id.
function key(uid) { return `pace:pendingCompleted:${uid}` }

export function readPendingCompleted(uid) {
  try {
    const raw = localStorage.getItem(key(uid))
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function writeAll(uid, list) {
  try {
    localStorage.setItem(key(uid), JSON.stringify(list))
  } catch {
    // Storage full/unavailable — the record stays only in memory for
    // this session; same accepted tradeoff as elsewhere in this file's
    // siblings. Vanishingly unlikely for a queue this small.
  }
}

export function enqueueCompleted(uid, record) {
  const list = readPendingCompleted(uid)
  list.push(record)
  writeAll(uid, list)
}

export function removePendingCompleted(uid, sessionId) {
  writeAll(uid, readPendingCompleted(uid).filter((r) => r.sessionId !== sessionId))
}
