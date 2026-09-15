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

  test('starting within the 15 minute tolerance still matches', () => {
    const blocks = [{ id: 'b1', title: 'Physics', type: 'focus', startMs: day0 + 8 * HOUR, endMs: day0 + 9 * HOUR }]
    const early = [{ sessionType: 'focus', startedAt: day0 + 8 * HOUR - 14 * 60 * 1000, durationSeconds: 3600 }]
    const late = [{ sessionType: 'focus', startedAt: day0 + 8 * HOUR + 14 * 60 * 1000, durationSeconds: 3600 }]
    assert.equal(scoreDay(blocks, early).blocks[0].status, 'done')
    assert.equal(scoreDay(blocks, late).blocks[0].status, 'done')
  })

  test('starting outside the tolerance window counts as missed', () => {
    const blocks = [{ id: 'b1', title: 'Physics', type: 'focus', startMs: day0 + 8 * HOUR, endMs: day0 + 9 * HOUR }]
    const tooLate = [{ sessionType: 'focus', startedAt: day0 + 8 * HOUR + 16 * 60 * 1000, durationSeconds: 3600 }]
    assert.equal(scoreDay(blocks, tooLate).blocks[0].status, 'missed')
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

  test('a session cannot be double-counted toward two blocks', () => {
    const blocks = [
      { id: 'b1', title: 'A', type: 'focus', startMs: day0 + 8 * HOUR, endMs: day0 + 9 * HOUR },
      { id: 'b2', title: 'B', type: 'focus', startMs: day0 + 8 * HOUR + 5 * 60 * 1000, endMs: day0 + 9 * HOUR },
    ]
    const sessions = [{ sessionType: 'focus', startedAt: day0 + 8 * HOUR, durationSeconds: 3600 }]
    const { blocks: scored } = scoreDay(blocks, sessions)
    const doneCount = scored.filter((b) => b.status === 'done').length
    assert.equal(doneCount, 1)
  })

  test('a day with no planned blocks has no adherence percentage', () => {
    assert.equal(scoreDay([], []).adherencePct, null)
  })

  test('a block later today that has not reached its own start yet is upcoming, not missed', () => {
    const blocks = [{ id: 'b1', title: 'Evening revision', type: 'focus', startMs: day0 + 20 * HOUR, endMs: day0 + 21 * HOUR }]
    const now = day0 + 10 * HOUR // morning — well before the block starts
    const { blocks: scored, adherencePct } = scoreDay(blocks, [], now)
    assert.equal(scored[0].status, 'upcoming')
    assert.equal(adherencePct, null) // excluded entirely, not counted as 0%
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

  test('once its tolerance window has passed with no match, an unstarted block becomes missed', () => {
    const blocks = [{ id: 'b1', title: 'Evening revision', type: 'focus', startMs: day0 + 20 * HOUR, endMs: day0 + 21 * HOUR }]
    const now = day0 + 20 * HOUR + 16 * 60 * 1000 // 16 minutes past its start, still no session
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
