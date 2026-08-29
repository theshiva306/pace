import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { focusSeconds, todayFocusSeconds, thisWeekFocusSeconds, bankStreakUpdate, startOfDayMs } from './sessionMath.js'
import { isStaleSession, isCurrentlyLive } from './staleSession.js'

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

// --- Full midnight scenario matrix -----------------------------------
// Every combination of (when a session started, what it's doing right at
// midnight, what it's doing when checked afterward) that can realistically
// occur, run end to end through the real write-time function
// (bankStreakUpdate) feeding the real read-time function (todayFocusSeconds)
// — not hand-computed expected values, the actual functions calling each
// other exactly as lib/sessions.js does in production.
describe('Full midnight scenario matrix', () => {
  test('1. Active straight through midnight, checked 1s before and 1s after', () => {
    const session = { startedAt: TODAY_MS - 4 * H, activeSince: TODAY_MS - 4 * H, status: 'active', bankedDayId: '2026-08-18', bankedDaySeconds: 0 }
    // 1s before midnight is still *yesterday* — "today" (relative to that
    // check) is the day containing that timestamp, i.e. yesterday, and
    // nearly the full ~4h streak (minus that 1 second) falls within it.
    assert.equal(todayFocusSeconds(session, TODAY_MS - 1000), 14399)
    // 1s after midnight: a fresh day, only 1 second of it has elapsed.
    assert.equal(todayFocusSeconds(session, TODAY_MS + 1000), 1)
  })

  test('2. Paused at exactly midnight (edge case: pausedAt === boundary)', () => {
    const streakStart = TODAY_MS - 2 * H
    const session = { startedAt: streakStart, activeSince: streakStart, status: 'active', bankedDayId: null, bankedDaySeconds: 0 }
    const bank = bankStreakUpdate(session, TODAY_MS) // paused exactly at midnight
    assert.equal(bank.bankedDaySeconds, 0, "streak ending exactly at midnight banks 0 for the NEW day (it's all yesterday)")
    assert.equal(bank.bankedDayId, dayIdOf(TODAY_MS))
  })

  test('3. Multiple pause/resume cycles, one before midnight one after, single continuous test', () => {
    // 10pm-11pm active (1h, before midnight), pause, resume 12:30am,
    // 12:30am-1:30am active (1h, after midnight), pause again.
    let session = { startedAt: TODAY_MS - 2 * H, activeSince: TODAY_MS - 2 * H, status: 'active', bankedDayId: null, bankedDaySeconds: 0, bankedWeekId: null, bankedWeekSeconds: 0 }
    const firstPause = bankStreakUpdate(session, TODAY_MS - H) // paused 11pm (before midnight)
    // The 10-11pm streak is entirely within *yesterday* (the day
    // containing 11pm) — correctly banks the full hour to yesterday's
    // bucket, not to TODAY_MS's date.
    assert.equal(firstPause.bankedDaySeconds, 3600, 'full 10-11pm hour banked to the day it actually happened on')
    assert.equal(firstPause.bankedDayId, dayIdOf(TODAY_MS - H))
    session = { ...session, ...firstPause, status: 'paused', pausedAt: TODAY_MS - H }
    assert.equal(todayFocusSeconds(session, TODAY_MS), 0, 'still 0 right at midnight while paused')

    session = { ...session, status: 'active', activeSince: TODAY_MS + 0.5 * H } // resumed 12:30am
    assert.equal(todayFocusSeconds(session, TODAY_MS + 0.5 * H), 0, '0 the instant they resume after midnight')
    assert.equal(todayFocusSeconds(session, TODAY_MS + H), 1800, '30 min after resuming')

    const secondPause = bankStreakUpdate(session, TODAY_MS + 1.5 * H) // paused 1:30am
    assert.equal(secondPause.bankedDaySeconds, 3600, 'the full 12:30-1:30am hour is today, banks 1h')
  })

  test('4. Genuinely abandoned active session from yesterday (the Kanak-shaped bug)', () => {
    // Started yesterday before noon, never paused, device died — status
    // stuck at 'active' with no cutoff, checked the next evening.
    const yesterday9am = TODAY_MS - H - 15 * H // ~9am yesterday relative to TODAY_MS being today's midnight
    const session = { startedAt: yesterday9am, activeSince: yesterday9am, status: 'active', pausedSeconds: 0, bankedDayId: null, bankedDaySeconds: 0 }
    const checkedNow = TODAY_MS + 18 * H // 6pm today
    // The number itself, if it were still "live", would be huge — but it
    // must not be treated as live at all past STALE_ACTIVE_MS.
    assert.equal(isStaleSession(session, checkedNow), true, 'must be flagged abandoned')
    assert.equal(isCurrentlyLive(session, checkedNow), false, 'must not show as currently focusing')
  })

  test('5. Genuinely still-focusing session that happens to be long (not a false positive)', () => {
    const session = { startedAt: TODAY_MS + H, activeSince: TODAY_MS + H, status: 'active', pausedSeconds: 0, bankedDayId: null, bankedDaySeconds: 0 }
    const checkedNow = TODAY_MS + 9 * H // 8 hours in, still today, still active
    assert.equal(isStaleSession(session, checkedNow), false)
    assert.equal(isCurrentlyLive(session, checkedNow), true)
    assert.equal(todayFocusSeconds(session, checkedNow), 8 * 3600, 'today total correctly reflects the full 8h, all same day')
  })

  test('6. Paused before midnight (ordinary case, the exact "Kanak paused before 12" report), still paused today', () => {
    const pausedAt = TODAY_MS - 4 * H // paused 8pm yesterday
    const session = { startedAt: TODAY_MS - 6 * H, status: 'paused', pausedAt, pausedSeconds: 0, bankedDayId: dayIdOf(TODAY_MS - H), bankedDaySeconds: 2 * 3600 }
    assert.equal(todayFocusSeconds(session, TODAY_MS + 6 * H), 0, "yesterday's paused time must not appear in today's total")
    // Also must not count as currently live (it's within the 3h pause
    // window in this specific check point, but let's push past it too)
    assert.equal(isCurrentlyLive(session, TODAY_MS + 6 * H), false, 'stale-paused (well past 3h), correctly hidden from Live')
  })
})

// --- Full week scenario matrix -----------------------------------------
describe('Full week scenario matrix', () => {
  const monday = new Date(2026, 7, 17)
  monday.setHours(0, 0, 0, 0)
  const MONDAY_MS = monday.getTime()

  test('1. Active straight through the Sun->Mon boundary', () => {
    const session = { startedAt: MONDAY_MS - 4 * H, activeSince: MONDAY_MS - 4 * H, status: 'active', bankedWeekId: '2026-W33', bankedWeekSeconds: 0 }
    // 1s before Monday is still Sunday (last week) — nearly the full ~4h
    // streak falls within that week.
    assert.equal(thisWeekFocusSeconds(session, MONDAY_MS - 1000), 14399, 'just before Monday: still last week')
    assert.equal(thisWeekFocusSeconds(session, MONDAY_MS + 1000), 1, 'just after Monday: fresh week')
  })

  test('2. Paused before the week boundary, still paused into the new week', () => {
    const session = { startedAt: MONDAY_MS - 6 * H, status: 'paused', pausedAt: MONDAY_MS - 4 * H, pausedSeconds: 0, bankedWeekId: '2026-W33', bankedWeekSeconds: 2 * 3600 }
    assert.equal(thisWeekFocusSeconds(session, MONDAY_MS + 6 * H), 0, "last week's paused time must not leak into the new week")
  })

  test('3. Resumed after the week boundary, correct 0 at resume then grows', () => {
    const session = { startedAt: MONDAY_MS - 2.5 * H, activeSince: MONDAY_MS + H, status: 'active', pausedSeconds: 5400, bankedWeekId: '2026-W33', bankedWeekSeconds: 0 }
    assert.equal(thisWeekFocusSeconds(session, MONDAY_MS + H), 0)
    assert.equal(thisWeekFocusSeconds(session, MONDAY_MS + 2 * H), 3600)
  })

  test('4. Same-week session (started Wednesday) is fully counted, no truncation', () => {
    const wednesday = MONDAY_MS + 2 * 24 * H
    const session = { startedAt: wednesday, activeSince: wednesday, status: 'active', bankedWeekId: dayIdOf(wednesday) && isoWeekIdOf(wednesday), bankedWeekSeconds: 0 }
    assert.equal(thisWeekFocusSeconds(session, wednesday + 3 * H), 3 * 3600)
  })
})

// --- Staleness threshold edges ------------------------------------------
describe('Staleness threshold edges', () => {
  test('Paused: 1 second under 3h threshold is still live', () => {
    const session = { status: 'paused', pausedAt: Date.now() - (3 * H - 1000), startedAt: Date.now() - 4 * H }
    assert.equal(isCurrentlyLive(session, Date.now()), true)
  })
  test('Paused: 1 second over 3h threshold is stale', () => {
    const session = { status: 'paused', pausedAt: Date.now() - (3 * H + 1000), startedAt: Date.now() - 4 * H }
    assert.equal(isCurrentlyLive(session, Date.now()), false)
  })
  test('Active: 1 second under 12h threshold is still live', () => {
    const t = Date.now() - (12 * H - 1000)
    const session = { status: 'active', activeSince: t, startedAt: t }
    assert.equal(isCurrentlyLive(session, Date.now()), true)
  })
  test('Active: 1 second over 12h threshold is stale', () => {
    const t = Date.now() - (12 * H + 1000)
    const session = { status: 'active', activeSince: t, startedAt: t }
    assert.equal(isCurrentlyLive(session, Date.now()), false)
  })
  test('onBreak uses the same 3h rule as paused', () => {
    const session = { status: 'onBreak', pausedAt: Date.now() - (3 * H + 1000), startedAt: Date.now() - 4 * H }
    assert.equal(isCurrentlyLive(session, Date.now()), false)
  })
  test('stopped sessions are never "live" regardless of age', () => {
    const session = { status: 'stopped', startedAt: Date.now() - H }
    assert.equal(isCurrentlyLive(session, Date.now()), false)
    assert.equal(isStaleSession(session, Date.now()), false, 'stopped is a resolved state, not an abandoned one — no staleness prompt needed')
  })
})

// --- Clock-skew consistency ----------------------------------------------
// The pure functions here don't know or care about server-vs-device clock
// skew — that correction happens once, upstream, before "now" reaches
// them (useSessionClock's `offset`, mirrored in useGroup.js and
// usePolledValue.js). What matters for these functions is that whoever
// calls them is internally consistent — the same corrected clock used for
// both the write (bankStreakUpdate) and the read (todayFocusSeconds).
// This proves that invariant: shifting an entire scenario by a constant
// (simulating a skewed device clock) changes nothing about the *shape* of
// the result, because every timestamp in the scenario shifts together.
describe('Clock-skew consistency (shifted-clock invariance)', () => {
  test('A whole scenario shifted by a constant skew produces the identical relative result', () => {
    const skewMs = 17 * 60 * 1000 // simulate a device clock 17 minutes off
    const run = (shift) => {
      const start = TODAY_MS + H + shift
      const session = { startedAt: start, activeSince: start, status: 'active', bankedDayId: null, bankedDaySeconds: 0 }
      return todayFocusSeconds(session, TODAY_MS + 1.5 * H + shift)
    }
    assert.equal(run(0), run(skewMs), 'consistent skew across both start and check time changes nothing')
  })
})

function dayIdOf(ms) {
  const d = new Date(ms)
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function isoWeekIdOf(ms) {
  const date = new Date(ms)
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}
