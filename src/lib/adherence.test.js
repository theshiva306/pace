import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { scoreDay, summarize } from './adherence.js'

const HOUR = 60 * 60 * 1000
const day0 = new Date(2026, 8, 15, 0, 0, 0, 0).getTime() // local midnight, arbitrary day

describe('scoreDay', () => {
  test('a session starting on time and running the full length is done', () => {
    const blocks = [{ id: 'b1', title: 'Physics', type: 'focus', startMs: day0 + 8 * HOUR, endMs: day0 + 9 * HOUR }]
    const sessions = [{ sessionType: 'focus', startedAt: day0 + 8 * HOUR, durationSeconds: 3600 }]
    const { blocks: scored, adherencePct } = scoreDay(blocks, sessions)
    assert.equal(scored[0].status, 'done')
    assert.equal(adherencePct, 100)
  })

  test('a session shifted a few minutes early is credited only for the overlapping slice — no grace on the start side', () => {
    // Credit is pure time-overlap, with one exception (see below): the
    // grace window only ever extends a block's END boundary, never its
    // START. A 60-minute block, session starting 14 minutes early and
    // ending 14 minutes before the block's own end, only has 46 of its
    // 60 minutes actually inside the block's window — no early-start
    // forgiveness, so it's "short" by 14.
    const blocks = [{ id: 'b1', title: 'Physics', type: 'focus', startMs: day0 + 8 * HOUR, endMs: day0 + 9 * HOUR }]
    const early = [{ sessionType: 'focus', startedAt: day0 + 8 * HOUR - 14 * 60 * 1000, durationSeconds: 3600 }]
    const earlyScored = scoreDay(blocks, early).blocks[0]
    assert.equal(earlyScored.status, 'short')
    assert.equal(earlyScored.creditedSec, 46 * 60)
  })

  test('a session shifted a few minutes late is fully credited once it runs into the 15-minute grace window at the end', () => {
    // Same block, session shifted 14 minutes late instead: starts 8:14,
    // runs 60 minutes, ends 9:14. The block's own end (9:00) plus the
    // 15-minute grace window covers up to 9:15, so the full 60-minute
    // session lands entirely inside the extended window and is fully
    // credited — this is the asymmetry: late-finish gets grace,
    // early-start does not.
    const blocks = [{ id: 'b1', title: 'Physics', type: 'focus', startMs: day0 + 8 * HOUR, endMs: day0 + 9 * HOUR }]
    const late = [{ sessionType: 'focus', startedAt: day0 + 8 * HOUR + 14 * 60 * 1000, durationSeconds: 3600 }]
    const lateScored = scoreDay(blocks, late).blocks[0]
    assert.equal(lateScored.status, 'done')
    assert.equal(lateScored.creditedSec, 60 * 60)
  })

  test('a late start within the 15-minute grace window is fully clawed back if the session runs enough past the scheduled end', () => {
    // 9-11am block (2h); session runs 9:15-11:15 — 15 minutes late,
    // but it keeps going 15 minutes past the block's own end (11:00),
    // right up to the edge of the grace window (11:15). Since the
    // lateness (15min) is exactly covered by the grace (15min), this
    // fully recovers: the whole 2 hours studied lands inside the
    // (start=9:00, graceEnd=11:15) window.
    const blocks = [{ id: 'b1', title: 'Deep work', type: 'focus', startMs: day0 + 9 * HOUR, endMs: day0 + 11 * HOUR }]
    const sessions = [{ sessionType: 'focus', startedAt: day0 + 9 * HOUR + 15 * 60 * 1000, durationSeconds: 2 * 3600 }]
    const { blocks: scored, adherencePct } = scoreDay(blocks, sessions)
    assert.equal(scored[0].status, 'done')
    assert.equal(scored[0].creditedSec, 2 * 3600)
    assert.equal(adherencePct, 100)
  })

  test('a late start beyond 15 minutes only recovers 15 minutes of grace, leaving the rest as a real shortfall', () => {
    // The exact scenario described: 9-11am block, started 30 minutes
    // late (9:30), kept studying past 11:00 up to 11:15 (right to the
    // edge of the 15-minute grace window) and beyond. Overlap counted
    // is 9:30 to 11:15 (105 min) — the grace window recovers 15 of the
    // 30 minutes lost to the late start, leaving a 15-minute shortfall
    // that can't be recovered no matter how much further the session runs.
    const blocks = [{ id: 'b1', title: 'Deep work', type: 'focus', startMs: day0 + 9 * HOUR, endMs: day0 + 11 * HOUR }]
    const sessions = [{ sessionType: 'focus', startedAt: day0 + 9 * HOUR + 30 * 60 * 1000, durationSeconds: 3 * 3600 }] // 9:30, runs 3h to 12:30 — well past the grace edge
    const { blocks: scored, adherencePct } = scoreDay(blocks, sessions)
    assert.equal(scored[0].status, 'short')
    assert.equal(scored[0].creditedSec, 105 * 60)
    assert.equal(scored[0].shortfallSec, 15 * 60)
    assert.equal(adherencePct, 88) // 105/120, rounded
  })

  test('a session starting well after the block, ending inside the grace window, is fully credited for its own length', () => {
    // 9am-12pm block (3h); session runs 9:16am-12:01pm (165min). The
    // grace window extends the block's usable end to 12:15, so the
    // full session (ending 12:01, before 12:15) is credited in full,
    // not just the portion up to the literal 12:00 boundary.
    const blocks = [{ id: 'b1', title: 'Deep work', type: 'focus', startMs: day0 + 9 * HOUR, endMs: day0 + 12 * HOUR }]
    const sessions = [{ sessionType: 'focus', startedAt: day0 + 9 * HOUR + 16 * 60 * 1000, durationSeconds: 165 * 60 }]
    const { blocks: scored, adherencePct } = scoreDay(blocks, sessions)
    assert.equal(scored[0].status, 'short')
    assert.equal(scored[0].creditedSec, 165 * 60)
    assert.equal(adherencePct, 92) // 165/180, rounded
  })

  test('a long, mostly-unrelated session that only brushes the edge of a block is credited for the sliver plus grace', () => {
    // 5-hour session starting 2 minutes before a 1-hour block ends and
    // running well past it. The grace window extends the block's usable
    // end by 15 minutes, so the credited slice is 17 minutes (2 real +
    // 15 grace), not just the literal 2-minute overlap. Still reads as
    // "short" with a large shortfall rather than "missed" — there's no
    // minimum-overlap floor.
    const blocks = [{ id: 'b1', title: 'Physics', type: 'focus', startMs: day0 + 8 * HOUR, endMs: day0 + 9 * HOUR }]
    const sessions = [{ sessionType: 'focus', startedAt: day0 + 8 * HOUR + 58 * 60 * 1000, durationSeconds: 5 * 3600 }]
    const { blocks: scored } = scoreDay(blocks, sessions)
    assert.equal(scored[0].status, 'short')
    assert.equal(scored[0].creditedSec, 17 * 60)
  })

  test('the grace window is clamped so it never bleeds into a block that starts less than 15 minutes later', () => {
    // Two blocks only 10 minutes apart (9-10, then 10:10-11). Without
    // clamping, block 1's grace would extend to 10:15 — past block 2's
    // own start — letting a session meant for block 2 get miscredited
    // to block 1's leftover grace room. Clamping caps block 1's usable
    // end at block 2's start (10:10), so only a real 10-minute grace
    // applies here, not the full 15.
    const blocks = [
      { id: 'b1', title: 'Morning', type: 'focus', startMs: day0 + 9 * HOUR, endMs: day0 + 10 * HOUR },
      { id: 'b2', title: 'Late morning', type: 'focus', startMs: day0 + 10 * HOUR + 10 * 60 * 1000, endMs: day0 + 11 * HOUR },
    ]
    const sessions = [{ sessionType: 'focus', startedAt: day0 + 9 * HOUR, durationSeconds: 75 * 60 }] // 9:00-10:15
    const { blocks: scored } = scoreDay(blocks, sessions)
    assert.equal(scored[0].actualSec, 70 * 60) // 9:00-10:10 (clamped to b2's start), not 9:00-10:15
    assert.equal(scored[0].creditedSec, 60 * 60) // still capped at block 1's own 60min plan
    assert.equal(scored[0].status, 'done')
    // The session's last 5 minutes (10:10-10:15) fall inside b2's own
    // window (it started at 10:10), so b2 does still get a small,
    // separate 5-minute credit for that slice — it's just not part of
    // block 1's grace, and nowhere near b2's own 50-minute plan.
    assert.equal(scored[1].creditedSec, 5 * 60)
    assert.equal(scored[1].status, 'short')
  })

  test('a session with zero overlap with the block counts as missed, however close its start was to the day', () => {
    const blocks = [{ id: 'b1', title: 'Physics', type: 'focus', startMs: day0 + 8 * HOUR, endMs: day0 + 9 * HOUR }]
    const sessions = [{ sessionType: 'focus', startedAt: day0 + 14 * HOUR, durationSeconds: 3600 }] // afternoon, unrelated to the 8-9am block
    assert.equal(scoreDay(blocks, sessions).blocks[0].status, 'missed')
  })

  test('a matching session that runs short is credited only for what it covered', () => {
    const blocks = [{ id: 'b1', title: 'Physics', type: 'focus', startMs: day0 + 8 * HOUR, endMs: day0 + 10 * HOUR }]
    const sessions = [{ sessionType: 'focus', startedAt: day0 + 8 * HOUR, durationSeconds: 3600 }] // 1h of a 2h block
    const { blocks: scored, adherencePct } = scoreDay(blocks, sessions)
    assert.equal(scored[0].status, 'short')
    assert.equal(scored[0].shortfallSec, 3600)
    assert.equal(adherencePct, 50)
  })

  test('a session of the wrong type does not satisfy a block', () => {
    const blocks = [{ id: 'b1', title: 'Mock test', type: 'focus', startMs: day0 + 8 * HOUR, endMs: day0 + 9 * HOUR }]
    const sessions = [{ sessionType: 'semiFocus', startedAt: day0 + 8 * HOUR, durationSeconds: 3600 }]
    assert.equal(scoreDay(blocks, sessions).blocks[0].status, 'missed')
  })

  test('one unbroken session spanning two back-to-back blocks credits each block for its own slice', () => {
    // This is the core fix: previously a single long session was
    // claimed entirely by whichever block was scored first, leaving
    // the next block "missed" even though it was studied through.
    // Now each block is credited independently for the slice of the
    // session that actually falls inside it.
    const blocks = [
      { id: 'b1', title: 'Morning', type: 'focus', startMs: day0 + 9 * HOUR, endMs: day0 + 10 * HOUR },
      { id: 'b2', title: 'Late morning', type: 'focus', startMs: day0 + 10 * HOUR, endMs: day0 + 11 * HOUR },
    ]
    // 9:05-10:50 (105min) overlaps b1 for 55min and b2 for 50min.
    const sessions = [{ sessionType: 'focus', startedAt: day0 + 9 * HOUR + 5 * 60 * 1000, durationSeconds: 105 * 60 }]
    const { blocks: scored } = scoreDay(blocks, sessions)
    assert.equal(scored[0].status, 'short')
    assert.equal(scored[0].creditedSec, 55 * 60)
    assert.equal(scored[1].status, 'short')
    assert.equal(scored[1].creditedSec, 50 * 60)
  })

  test('an unbroken session that fully covers two adjacent blocks marks both done, with the gap between them uncredited', () => {
    // The exact real-world case this fix targets: two blocks with a
    // gap between them (12:30-2:00, then a 30min gap, then 2:30-5:00),
    // studied straight through without stopping the timer at 2:00.
    const blocks = [
      { id: 'b1', title: 'Afternoon', type: 'focus', startMs: day0 + 12.5 * HOUR, endMs: day0 + 14 * HOUR },
      { id: 'b2', title: 'Afternoon', type: 'focus', startMs: day0 + 14.5 * HOUR, endMs: day0 + 17 * HOUR },
    ]
    const sessions = [{ sessionType: 'focus', startedAt: day0 + 12.5 * HOUR, durationSeconds: 4.5 * 3600 }] // 12:30-17:00
    const { blocks: scored } = scoreDay(blocks, sessions)
    assert.equal(scored[0].status, 'done')
    assert.equal(scored[1].status, 'done')
  })

  test('a day with no planned blocks has no adherence percentage', () => {
    assert.equal(scoreDay([], []).adherencePct, null)
  })

  test('a block later today that has not started yet is upcoming, not missed', () => {
    const blocks = [{ id: 'b1', title: 'Evening revision', type: 'focus', startMs: day0 + 20 * HOUR, endMs: day0 + 21 * HOUR }]
    const now = day0 + 10 * HOUR // morning — well before the block starts
    const { blocks: scored, adherencePct } = scoreDay(blocks, [], now)
    assert.equal(scored[0].status, 'upcoming')
    assert.equal(adherencePct, null) // excluded entirely, not counted as 0%
  })

  test('a block currently in progress is upcoming, not missed, even past its own start time', () => {
    const blocks = [{ id: 'b1', title: 'Midday session', type: 'focus', startMs: day0 + 9 * HOUR, endMs: day0 + 12 * HOUR }]
    const now = day0 + 10 * HOUR // an hour into the block's own 3-hour window
    assert.equal(scoreDay(blocks, [], now).blocks[0].status, 'upcoming')
  })

  test('an upcoming block does not drag down a day that already has a completed one', () => {
    const blocks = [
      { id: 'b1', title: 'Morning', type: 'focus', startMs: day0 + 8 * HOUR, endMs: day0 + 9 * HOUR },
      { id: 'b2', title: 'Evening', type: 'focus', startMs: day0 + 20 * HOUR, endMs: day0 + 21 * HOUR },
    ]
    const sessions = [{ sessionType: 'focus', startedAt: day0 + 8 * HOUR, durationSeconds: 3600 }]
    const now = day0 + 10 * HOUR
    const { blocks: scored, adherencePct } = scoreDay(blocks, sessions, now)
    assert.equal(scored[0].status, 'done')
    assert.equal(scored[1].status, 'upcoming')
    assert.equal(adherencePct, 100) // only the morning block (already due) counts
  })

  test('once its own end time has passed with no overlapping session, a block becomes missed', () => {
    const blocks = [{ id: 'b1', title: 'Evening revision', type: 'focus', startMs: day0 + 20 * HOUR, endMs: day0 + 21 * HOUR }]
    const now = day0 + 21 * HOUR + 1000 // just after the block's own window closed, still no session
    assert.equal(scoreDay(blocks, [], now).blocks[0].status, 'missed')
  })

  test('scoring a fully past day (no now given) treats every unmatched block as missed', () => {
    const blocks = [{ id: 'b1', title: 'Evening revision', type: 'focus', startMs: day0 + 20 * HOUR, endMs: day0 + 21 * HOUR }]
    assert.equal(scoreDay(blocks, []).blocks[0].status, 'missed')
  })
})

describe('scoreDay — paused sessions (fragment-based overlap)', () => {
  test('a paused session is not compressed earlier in time — no phantom credit for time never studied inside the block', () => {
    // 9-10am block, grace to 10:15. Studies 9:50-9:55 (5min, inside the
    // block), takes a 45min break, resumes and studies 10:40-11:00
    // (20min — well past the grace cutoff). Real overlap: only the
    // 9:50-9:55 slice (5min) is inside the block-plus-grace window; the
    // 10:40-11:00 slice starts after the 10:15 grace cutoff, so it
    // contributes nothing. Real credit: 5 minutes.
    // The old bug compressed the 25-minute total duration into one block
    // starting at 9:50 (9:50-10:15), which lands entirely inside the
    // grace window and wrongly credits the full 25 minutes.
    const blocks = [{ id: 'b1', title: 'Physics', type: 'focus', startMs: day0 + 9 * HOUR, endMs: day0 + 10 * HOUR }]
    const sessions = [{
      sessionType: 'focus',
      startedAt: day0 + 9 * HOUR + 50 * 60 * 1000,
      durationSeconds: 25 * 60,
      endedAt: day0 + 11 * HOUR, // real stop at 11:00
      pauseLog: [{ start: day0 + 9 * HOUR + 55 * 60 * 1000, end: day0 + 10 * HOUR + 40 * 60 * 1000, type: 'pause' }],
    }]
    const { blocks: scored } = scoreDay(blocks, sessions)
    assert.equal(scored[0].creditedSec, 5 * 60)
    assert.equal(scored[0].status, 'short')
  })

  test('a paused session does not get its real, in-window overlap dragged out of the block by compression', () => {
    // Block 9-10am, grace to 10:15. Studies 8:00-8:10 (10min, before the
    // block), takes a 70min break, resumes and studies 9:20-9:40
    // (20min, genuinely inside the block). Real credit: 20 minutes (the
    // second stretch). The old bug compressed the 30-minute total
    // duration into one block starting at 8:00 (8:00-8:30), dragging
    // that real in-window study backward out of the block entirely and
    // crediting 0 (reading as "missed" despite genuine study inside it).
    const blocks = [{ id: 'b1', title: 'Physics', type: 'focus', startMs: day0 + 9 * HOUR, endMs: day0 + 10 * HOUR }]
    const sessions = [{
      sessionType: 'focus',
      startedAt: day0 + 8 * HOUR,
      durationSeconds: 30 * 60,
      endedAt: day0 + 9 * HOUR + 40 * 60 * 1000,
      pauseLog: [{ start: day0 + 8 * HOUR + 10 * 60 * 1000, end: day0 + 9 * HOUR + 20 * 60 * 1000, type: 'pause' }],
    }]
    const { blocks: scored } = scoreDay(blocks, sessions)
    assert.equal(scored[0].creditedSec, 20 * 60)
    assert.notEqual(scored[0].status, 'missed') // real study did land inside the block
  })

  test('grace only credits time actually spent studying past the scheduled end — sitting paused through it earns nothing', () => {
    // 9-10am block. Studies 9:00-10:00 right on time, then stays paused
    // straight through the whole 15-minute grace window instead of
    // resuming. No studied time falls in the grace window, so it
    // contributes zero — grace is not activated just because the pause
    // happens to sit inside its clock range.
    const blocks = [{ id: 'b1', title: 'Physics', type: 'focus', startMs: day0 + 9 * HOUR, endMs: day0 + 10 * HOUR }]
    const sessions = [{
      sessionType: 'focus',
      startedAt: day0 + 9 * HOUR,
      durationSeconds: 60 * 60,
      endedAt: day0 + 10 * HOUR + 15 * 60 * 1000, // stayed paused right up to the grace edge
      pauseLog: [{ start: day0 + 10 * HOUR, end: day0 + 10 * HOUR + 15 * 60 * 1000, type: 'pause' }],
    }]
    const { blocks: scored } = scoreDay(blocks, sessions)
    assert.equal(scored[0].creditedSec, 60 * 60) // exactly the planned length, no bonus from the idle grace time
    assert.equal(scored[0].status, 'done')
  })

  test('a stillLive flag on the session no longer overrides endedAt — the exact regression this consolidation fixed', () => {
    // The real bug: caller-side code used to pass a boolean "stillLive"
    // flag and let THIS function substitute Date.now() whenever it was
    // true — which wrongly treated a session that's merely "not yet
    // stopped" (e.g. currently paused, sitting mid-break) as if it were
    // actively accruing studied time all the way up to the current
    // instant. There's no such branch left at all now: whatever endedAt
    // the caller passes is trusted as-is, even with a stillLive flag
    // also present on the object.
    const blocks = [{ id: 'b1', title: 'Physics', type: 'focus', startMs: day0 + 9 * HOUR, endMs: day0 + 10 * HOUR }]
    const frozenPauseMs = day0 + 9 * HOUR + 10 * 60 * 1000 // paused 10 minutes in
    const sessions = [{
      sessionType: 'focus',
      startedAt: day0 + 9 * HOUR,
      durationSeconds: 10 * 60,
      endedAt: frozenPauseMs, // the moment it paused -- NOT Date.now()
      pauseLog: [],
      stillLive: true, // present, but must not change the result
    }]
    const { blocks: scored } = scoreDay(blocks, sessions)
    // Credited exactly the 10 minutes up to the pause — not however
    // much real time has passed since, whatever "now" happens to be
    // when this test runs.
    assert.equal(scored[0].creditedSec, 10 * 60)
  })

  test('grace still credits real study time in the grace window, and a mid-session pause is correctly excluded either way', () => {
    // 2-hour block (9-11am), grace to 11:15. Starts 20min late (9:20),
    // takes a real 10min break (10:00-10:10), then keeps studying right
    // up to 11:05 — 5 minutes into the grace window. Real studied time
    // is two fragments: 9:20-10:00 (40min) and 10:10-11:05 (55min) = 95
    // minutes, under the 2-hour plan, so nothing here is capped by the
    // block's own planned length — this isolates the fragment math and
    // the grace credit at the same time.
    const blocks = [{ id: 'b1', title: 'Deep work', type: 'focus', startMs: day0 + 9 * HOUR, endMs: day0 + 11 * HOUR }]
    const sessions = [{
      sessionType: 'focus',
      startedAt: day0 + 9 * HOUR + 20 * 60 * 1000,
      durationSeconds: 95 * 60,
      endedAt: day0 + 11 * HOUR + 5 * 60 * 1000,
      pauseLog: [{ start: day0 + 10 * HOUR, end: day0 + 10 * HOUR + 10 * 60 * 1000, type: 'pause' }],
    }]
    const { blocks: scored } = scoreDay(blocks, sessions)
    assert.equal(scored[0].creditedSec, 95 * 60)
    assert.equal(scored[0].status, 'short') // 95 of 120 planned minutes
  })

  test('a session with no endedAt/pauseLog (pre-pause-tracking data) falls back to the old compressed approximation, unchanged', () => {
    const blocks = [{ id: 'b1', title: 'Physics', type: 'focus', startMs: day0 + 8 * HOUR, endMs: day0 + 9 * HOUR }]
    const sessions = [{ sessionType: 'focus', startedAt: day0 + 8 * HOUR, durationSeconds: 3600 }]
    const { blocks: scored } = scoreDay(blocks, sessions)
    assert.equal(scored[0].status, 'done')
    assert.equal(scored[0].creditedSec, 3600)
  })
})

describe('scoreDay — grace window never bleeds into the next calendar day', () => {
  test('a block ending at 11:59pm only gets 1 minute of grace, not the full 15', () => {
    const dayEnd = day0 + 24 * HOUR // local midnight starting the next day
    const blocks = [{ id: 'b1', title: 'Late night', type: 'focus', startMs: dayEnd - 60 * 60 * 1000, endMs: dayEnd - 60 * 1000 }] // 10:59pm-11:59pm
    const { blocks: scored } = scoreDay(blocks, [])
    assert.equal(scored[0].graceEndMs, dayEnd) // capped at midnight, not 12:14am
  })

  test('a block ending at 11:50pm only gets 10 minutes of grace', () => {
    const dayEnd = day0 + 24 * HOUR
    const blocks = [{ id: 'b1', title: 'Late night', type: 'focus', startMs: dayEnd - 70 * 60 * 1000, endMs: dayEnd - 10 * 60 * 1000 }] // 10:50pm-11:50pm
    const { blocks: scored } = scoreDay(blocks, [])
    assert.equal(scored[0].graceEndMs, dayEnd - 10 * 60 * 1000 + 10 * 60 * 1000)
    assert.equal(scored[0].graceEndMs, dayEnd)
  })

  test('a block ending well before midnight still gets its full 15-minute grace, unaffected by the day-end cap', () => {
    const blocks = [{ id: 'b1', title: 'Physics', type: 'focus', startMs: day0 + 8 * HOUR, endMs: day0 + 9 * HOUR }]
    const { blocks: scored } = scoreDay(blocks, [])
    assert.equal(scored[0].graceEndMs, day0 + 9 * HOUR + 15 * 60 * 1000)
  })
})

describe('summarize', () => {
  test('a perfect day gets an affirming line, not a percentage repeat', () => {
    const blocks = [{ id: 'b1', title: 'Physics', status: 'done' }]
    assert.match(summarize(blocks), /every planned block happened/i)
  })

  test('mentions both a short session and a missed slot when both occur', () => {
    const blocks = [
      { id: 'b1', title: 'Coaching lecture', status: 'short' },
      { id: 'b2', title: 'Mock test', status: 'missed' },
    ]
    const line = summarize(blocks)
    assert.match(line, /studied less than planned/i)
    assert.match(line, /missed the mock test slot/i)
  })

  test('studying meaningfully more than the whole day\'s schedule gets a congratulatory line, even with a missed slot', () => {
    const blocks = [{ id: 'b1', title: 'Mock test', status: 'missed' }]
    const line = summarize(blocks, { actualSec: 12 * 3600, plannedSec: 10 * 3600 }) // 12h studied, 10h scheduled
    assert.match(line, /great work/i)
    assert.doesNotMatch(line, /missed/i) // the overall win takes priority over one slipped slot
  })

  test('a trivial overage (a few minutes) does not trigger the congratulatory line', () => {
    const blocks = [{ id: 'b1', title: 'Mock test', status: 'missed' }]
    const line = summarize(blocks, { actualSec: 10 * 3600 + 5 * 60, plannedSec: 10 * 3600 }) // 5 min over
    assert.match(line, /missed the mock test slot/i)
  })

  test('no scheduled time at all does not trigger the congratulatory line', () => {
    const blocks = [{ id: 'b1', title: 'Mock test', status: 'missed' }]
    const line = summarize(blocks, { actualSec: 3600, plannedSec: 0 })
    assert.match(line, /missed the mock test slot/i)
  })
})
