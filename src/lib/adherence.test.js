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
