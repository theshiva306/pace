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

  test('a small timing shift on either end is still fully credited once the session ran the planned length', () => {
    // The block is 60 minutes; both sessions run the full 60 minutes,
    // just shifted 14 minutes early or late. Credit is based on the
    // session's own duration once it clearly belongs to this block, not
    // on the literal overlap — otherwise even a tiny shift could never
    // reach 100%, which is the wrong thing to penalize.
    const blocks = [{ id: 'b1', title: 'Physics', type: 'focus', startMs: day0 + 8 * HOUR, endMs: day0 + 9 * HOUR }]
    const early = [{ sessionType: 'focus', startedAt: day0 + 8 * HOUR - 14 * 60 * 1000, durationSeconds: 3600 }]
    const late = [{ sessionType: 'focus', startedAt: day0 + 8 * HOUR + 14 * 60 * 1000, durationSeconds: 3600 }]
    assert.equal(scoreDay(blocks, early).blocks[0].status, 'done')
    assert.equal(scoreDay(blocks, late).blocks[0].status, 'done')
  })

  test('starting late but still studying the full planned length is fully credited, not penalized for the shift', () => {
    // 9-11am block (2h); session runs 9:15-11:15 — 15 minutes late, but
    // a full 2 hours of study. This is the case that prompted moving
    // off literal overlap: the overlap with the 9-11 window is only
    // 1h45m, but the person did the whole planned amount of work, just
    // shifted — that should read as 100%, not ~87%.
    const blocks = [{ id: 'b1', title: 'Deep work', type: 'focus', startMs: day0 + 9 * HOUR, endMs: day0 + 11 * HOUR }]
    const sessions = [{ sessionType: 'focus', startedAt: day0 + 9 * HOUR + 15 * 60 * 1000, durationSeconds: 2 * 3600 }]
    const { blocks: scored, adherencePct } = scoreDay(blocks, sessions)
    assert.equal(scored[0].status, 'done')
    assert.equal(scored[0].creditedSec, 2 * 3600)
    assert.equal(adherencePct, 100)
  })

  test('a session starting well after the block, running a bit short of it, is credited for its own length — not zeroed out', () => {
    // 9am-12pm block (3h); session runs 9:16am-12:01pm (2h45m). Same
    // family of case as above, but the session itself falls short of
    // the full 3h, so it's credited proportionally rather than fully.
    const blocks = [{ id: 'b1', title: 'Deep work', type: 'focus', startMs: day0 + 9 * HOUR, endMs: day0 + 12 * HOUR }]
    const sessions = [{ sessionType: 'focus', startedAt: day0 + 9 * HOUR + 16 * 60 * 1000, durationSeconds: 165 * 60 }]
    const { blocks: scored, adherencePct } = scoreDay(blocks, sessions)
    assert.equal(scored[0].status, 'short')
    assert.equal(scored[0].creditedSec, 165 * 60)
    assert.equal(adherencePct, 92) // 165/180, rounded
  })

  test('a long, unrelated session that only brushes the edge of a block does not count toward it', () => {
    // 5-hour session overlapping a 1-hour block by only 2 minutes — the
    // overlap is real but nowhere near substantial, so this shouldn't
    // read as "block done" just because the session itself was long.
    const blocks = [{ id: 'b1', title: 'Physics', type: 'focus', startMs: day0 + 8 * HOUR, endMs: day0 + 9 * HOUR }]
    const sessions = [{ sessionType: 'focus', startedAt: day0 + 8 * HOUR + 58 * 60 * 1000, durationSeconds: 5 * 3600 }]
    assert.equal(scoreDay(blocks, sessions).blocks[0].status, 'missed')
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

  test('a session cannot be double-counted toward two overlapping blocks', () => {
    const blocks = [
      { id: 'b1', title: 'A', type: 'focus', startMs: day0 + 8 * HOUR, endMs: day0 + 9 * HOUR },
      { id: 'b2', title: 'B', type: 'focus', startMs: day0 + 8 * HOUR + 5 * 60 * 1000, endMs: day0 + 9 * HOUR },
    ]
    const sessions = [{ sessionType: 'focus', startedAt: day0 + 8 * HOUR, durationSeconds: 3600 }]
    const { blocks: scored } = scoreDay(blocks, sessions)
    const doneCount = scored.filter((b) => b.status === 'done').length
    assert.equal(doneCount, 1)
  })

  test('one long session spanning two back-to-back blocks is claimed by one of them, in full', () => {
    const blocks = [
      { id: 'b1', title: 'Morning', type: 'focus', startMs: day0 + 9 * HOUR, endMs: day0 + 10 * HOUR },
      { id: 'b2', title: 'Late morning', type: 'focus', startMs: day0 + 10 * HOUR, endMs: day0 + 11 * HOUR },
    ]
    // 9:05-10:50 (105min) overlaps b1 for 55min and b2 for 50min. Blocks
    // are judged chronologically, so b1 claims the session first — and
    // since the session's own 105min duration exceeds b1's 60min plan,
    // b1 is fully credited. b2 is left with nothing (the session is
    // already consumed). Known tradeoff: part of that credited time
    // technically fell within b2's window, not b1's — accepted in
    // exchange for not penalizing ordinary late/early shifts elsewhere.
    const sessions = [{ sessionType: 'focus', startedAt: day0 + 9 * HOUR + 5 * 60 * 1000, durationSeconds: 105 * 60 }]
    const { blocks: scored } = scoreDay(blocks, sessions)
    assert.equal(scored[0].status, 'done')
    assert.equal(scored[0].creditedSec, 60 * 60)
    assert.equal(scored[1].status, 'missed')
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
