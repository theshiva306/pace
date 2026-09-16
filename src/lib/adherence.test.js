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

  test('a small timing shift is credited proportionally to how much of the block it still overlaps — not zeroed, but not full either', () => {
    // A 60-minute block can't fully credit a session that starts 14
    // minutes into it (or ends 14 minutes before it) purely by running
    // longer elsewhere — the minutes outside the block's own window
    // were never available to overlap in the first place. That's
    // expected: the shorter the block, the more a given shift costs it
    // proportionally (see the 3-hour block below, where the same kind
    // of shift barely registers).
    const blocks = [{ id: 'b1', title: 'Physics', type: 'focus', startMs: day0 + 8 * HOUR, endMs: day0 + 9 * HOUR }]
    const early = [{ sessionType: 'focus', startedAt: day0 + 8 * HOUR - 14 * 60 * 1000, durationSeconds: 3600 }]
    const late = [{ sessionType: 'focus', startedAt: day0 + 8 * HOUR + 14 * 60 * 1000, durationSeconds: 3600 }]
    assert.equal(scoreDay(blocks, early).blocks[0].creditedSec, 46 * 60)
    assert.equal(scoreDay(blocks, late).blocks[0].creditedSec, 46 * 60)
    assert.equal(scoreDay(blocks, early).blocks[0].status, 'short')
  })

  test('a session starting well after the block, but still covering most of it, is credited for the overlap — not zeroed out', () => {
    // 9am-12pm block; session runs 9:16am to 12:01pm (2h45m), same case
    // that motivated moving off a flat start-time tolerance.
    const blocks = [{ id: 'b1', title: 'Deep work', type: 'focus', startMs: day0 + 9 * HOUR, endMs: day0 + 12 * HOUR }]
    const sessions = [{ sessionType: 'focus', startedAt: day0 + 9 * HOUR + 16 * 60 * 1000, durationSeconds: 165 * 60 }]
    const { blocks: scored, adherencePct } = scoreDay(blocks, sessions)
    assert.equal(scored[0].status, 'short') // overlap is 2h44m of a 3h block — not full, but far from missed
    assert.equal(scored[0].creditedSec, 164 * 60)
    assert.equal(adherencePct, 91) // 164/180, rounded
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

  test('one long session spanning two back-to-back blocks credits only the earlier one, not both', () => {
    const blocks = [
      { id: 'b1', title: 'Morning', type: 'focus', startMs: day0 + 9 * HOUR, endMs: day0 + 10 * HOUR },
      { id: 'b2', title: 'Late morning', type: 'focus', startMs: day0 + 10 * HOUR, endMs: day0 + 11 * HOUR },
    ]
    // 9:05-10:50 — overlaps b1 for 55min, b2 for 50min. Blocks are judged
    // chronologically, so b1 claims the session first (55 of its 60
    // planned minutes — short, not full); the leftover minutes beyond
    // that don't roll over to credit b2, which is left with nothing.
    const sessions = [{ sessionType: 'focus', startedAt: day0 + 9 * HOUR + 5 * 60 * 1000, durationSeconds: 105 * 60 }]
    const { blocks: scored } = scoreDay(blocks, sessions)
    assert.equal(scored[0].status, 'short')
    assert.equal(scored[0].creditedSec, 55 * 60)
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
})
