import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { focusSeconds, todayFocusSeconds, thisWeekFocusSeconds, bankStreakUpdate, startOfDayMs } from './sessionMath.js'

const H = 3600 * 1000

// Anchor every test to a fixed, known Wednesday so day/week boundary math
// is deterministic regardless of when the suite actually runs.
const TODAY = new Date(2026, 7, 19) // Wed 19 Aug 2026
TODAY.setHours(0, 0, 0, 0)
const TODAY_MS = TODAY.getTime()

describe('focusSeconds (unclipped total)', () => {
  test('active session counts full elapsed time since start', () => {
    const session = { startedAt: TODAY_MS, status: 'active', pausedSeconds: 0 }
    assert.equal(focusSeconds(session, TODAY_MS + 2 * H), 7200)
  })

  test('paused session freezes at the moment it was paused, regardless of how long ago', () => {
    const session = { startedAt: TODAY_MS, status: 'paused', pausedAt: TODAY_MS + 2 * H, pausedSeconds: 0 }
    assert.equal(focusSeconds(session, TODAY_MS + 2 * H), 7200)
    assert.equal(focusSeconds(session, TODAY_MS + 10 * H), 7200, 'still frozen 8 hours later')
  })

  test('accumulated pausedSeconds from prior cycles is subtracted', () => {
    const session = { startedAt: TODAY_MS, status: 'active', pausedSeconds: 1800 }
    assert.equal(focusSeconds(session, TODAY_MS + 2 * H), 5400) // 2h - 30min
  })

  test('no session returns 0', () => {
    assert.equal(focusSeconds(null, Date.now()), 0)
    assert.equal(focusSeconds({}, Date.now()), 0)
  })
})

describe('todayFocusSeconds — precise banking model', () => {
  test('continuous session started before midnight clips to just the post-midnight portion', () => {
    // Started 11pm yesterday, still running — at 2am today should show 2h, not 3h.
    const session = { startedAt: TODAY_MS - 3 * H, activeSince: TODAY_MS - 3 * H, status: 'active', pausedSeconds: 0, bankedDayId: '2026-08-18', bankedDaySeconds: 0 }
    assert.equal(todayFocusSeconds(session, TODAY_MS + 2 * H), 7200)
  })

  test('same-day session with no midnight crossing counts in full', () => {
    const session = { startedAt: TODAY_MS + H, activeSince: TODAY_MS + H, status: 'active', pausedSeconds: 0, bankedDayId: '2026-08-19', bankedDaySeconds: 0 }
    assert.equal(todayFocusSeconds(session, TODAY_MS + 1.5 * H), 1800) // 30 min in
  })

  test('paused before midnight and still paused now contributes 0 today', () => {
    const bankedDayId = '2026-08-18' // banked for yesterday, when the streak that ended was banked
    const session = { startedAt: TODAY_MS - 3 * H, status: 'paused', pausedAt: TODAY_MS - 0.5 * H, pausedSeconds: 0, bankedDayId, bankedDaySeconds: 2 * 3600 }
    assert.equal(todayFocusSeconds(session, TODAY_MS + 2 * H), 0)
  })

  test('paused across midnight then resumed shows 0 right at resume, grows correctly after', () => {
    // Real bug this system was built to fix: a differencing-only approach
    // showed a persistent +1h phantom offset here that never corrected.
    const session = {
      startedAt: TODAY_MS - 2.5 * H,
      activeSince: TODAY_MS + H, // resumed at 1am today
      status: 'active',
      pausedSeconds: 5400,
      bankedDayId: '2026-08-18', // banked for yesterday at pause time
      bankedDaySeconds: 0,
    }
    assert.equal(todayFocusSeconds(session, TODAY_MS + H), 0, 'zero the instant they resume')
    assert.equal(todayFocusSeconds(session, TODAY_MS + 2 * H), 3600, '1 more hour of study = 1h shown')
  })

  test('legacy fallback: pre-migration session (no bankedDayId) with an ordinary same-day pause', () => {
    // Must not regress to showing 0 just because bankedDayId is missing.
    const session = { startedAt: TODAY_MS + 2 * H, status: 'paused', pausedAt: TODAY_MS + 4 * H, pausedSeconds: 0 }
    assert.equal(todayFocusSeconds(session, TODAY_MS + 5 * H), 7200)
  })

  test('legacy fallback: pre-migration session paused across midnight, still paused', () => {
    const session = { startedAt: TODAY_MS - 3 * H, status: 'paused', pausedAt: TODAY_MS - 0.5 * H, pausedSeconds: 0 }
    assert.equal(todayFocusSeconds(session, TODAY_MS + 2 * H), 0)
  })

  test('fresh brand-new session (bankedDayId null by default) computes correctly', () => {
    const session = { startedAt: TODAY_MS + H, activeSince: TODAY_MS + H, status: 'active', pausedSeconds: 0, bankedDayId: null, bankedDaySeconds: 0 }
    assert.equal(todayFocusSeconds(session, TODAY_MS + 1.5 * H), 1800)
  })

  test('stale bankedDayId from an earlier day does not leak into today', () => {
    const session = { startedAt: TODAY_MS, status: 'paused', pausedAt: TODAY_MS + H, bankedDayId: '2026-08-10', bankedDaySeconds: 99999 }
    assert.equal(todayFocusSeconds(session, TODAY_MS + 2 * H), 0)
  })
})

describe('thisWeekFocusSeconds', () => {
  test('Sunday night into Monday resets to a fresh week', () => {
    // Wed 19 Aug 2026's week runs Mon 17 -> Sun 23. Simulate a session
    // that started the *previous* Sunday night (16 Aug, last day of the
    // prior week) and is still running into the new week's Monday.
    const sunday = new Date(2026, 7, 16)
    sunday.setHours(23, 0, 0, 0)
    const mondayStart = new Date(2026, 7, 17)
    mondayStart.setHours(0, 0, 0, 0)

    const session = { startedAt: sunday.getTime(), activeSince: sunday.getTime(), status: 'active', pausedSeconds: 0, bankedWeekId: null, bankedWeekSeconds: 0 }
    const twoAmMonday = mondayStart.getTime() + 2 * H
    assert.equal(thisWeekFocusSeconds(session, twoAmMonday), 7200, 'only the 2h since Monday midnight counts')
  })
})

describe('bankStreakUpdate — precise banking at the moment a streak ends', () => {
  test('banks the full streak when it stays within one day', () => {
    const session = { startedAt: TODAY_MS + H, activeSince: TODAY_MS + H, status: 'active', bankedDayId: null, bankedDaySeconds: 0, bankedWeekId: null, bankedWeekSeconds: 0 }
    const result = bankStreakUpdate(session, TODAY_MS + 3 * H)
    assert.equal(result.bankedDaySeconds, 7200)
  })

  test('clips to only the today-portion when the streak started before midnight', () => {
    const session = { startedAt: TODAY_MS - 2.5 * H, activeSince: TODAY_MS - 2.5 * H, status: 'active', bankedDayId: null, bankedDaySeconds: 0, bankedWeekId: null, bankedWeekSeconds: 0 }
    const result = bankStreakUpdate(session, TODAY_MS - 0.5 * H) // pause at 11:30pm, still "yesterday"
    assert.equal(result.bankedDaySeconds, 7200, '2h earned entirely within yesterday, before midnight')
  })

  test('accumulates across multiple streaks within the same day', () => {
    let session = { startedAt: TODAY_MS + H, activeSince: TODAY_MS + H, status: 'active', bankedDayId: null, bankedDaySeconds: 0, bankedWeekId: null, bankedWeekSeconds: 0 }
    const firstPause = bankStreakUpdate(session, TODAY_MS + 2 * H) // 1h streak
    session = { ...session, ...firstPause, activeSince: TODAY_MS + 3 * H } // resumed an hour later
    const secondPause = bankStreakUpdate(session, TODAY_MS + 5 * H) // 2h streak
    assert.equal(secondPause.bankedDaySeconds, 3 * 3600, '1h + 2h = 3h banked total for the day')
  })
})

describe('startOfDayMs', () => {
  test('returns local midnight for the given timestamp', () => {
    const midday = TODAY_MS + 14 * H
    assert.equal(startOfDayMs(midday), TODAY_MS)
  })
})
