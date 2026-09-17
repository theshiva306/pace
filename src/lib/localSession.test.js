import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  startLocal, pauseLocal, resumeLocal, startBreakLocal, endBreakLocal, stopLocal,
} from './localSession.js'

const UID = 'test-uid'

describe('pauseLog', () => {
  test('a freshly started session has an empty pauseLog, not an undefined one', () => {
    const session = startLocal(UID, 'stopwatch', null, 0, 0, 1000)
    assert.deepEqual(session.pauseLog, [])
  })

  test('a pause/resume cycle appends one entry, typed "pause"', () => {
    let session = startLocal(UID, 'stopwatch', null, 0, 0, 0)
    session = pauseLocal(UID, session, 60_000) // paused after 1 min
    session = resumeLocal(UID, session, 660_000) // resumed 10 min later
    assert.equal(session.pauseLog.length, 1)
    assert.deepEqual(session.pauseLog[0], { start: 60_000, end: 660_000, type: 'pause' })
    // The running total pausedSeconds isn't replaced by the log — both
    // should agree on the same 10-minute gap.
    assert.equal(session.pausedSeconds, 600)
  })

  test('a break/end-break cycle appends one entry, typed "break"', () => {
    let session = startLocal(UID, 'stopwatch', null, 1, 300, 0)
    session = startBreakLocal(UID, session, 3_600_000) // 1h in
    session = endBreakLocal(UID, session, 3_900_000) // 5 min break
    assert.equal(session.pauseLog.length, 1)
    assert.deepEqual(session.pauseLog[0], { start: 3_600_000, end: 3_900_000, type: 'break' })
  })

  test('multiple pause/resume cycles accumulate in chronological order', () => {
    let session = startLocal(UID, 'stopwatch', null, 0, 0, 0)
    session = pauseLocal(UID, session, 100_000)
    session = resumeLocal(UID, session, 160_000) // +1min pause
    session = pauseLocal(UID, session, 400_000)
    session = resumeLocal(UID, session, 700_000) // +5min pause
    assert.equal(session.pauseLog.length, 2)
    assert.equal(session.pauseLog[0].start, 100_000)
    assert.equal(session.pauseLog[1].start, 400_000)
    assert.equal(session.pausedSeconds, 60 + 300)
  })

  test('stopping directly from "paused" (never resumed) still closes out that pause in the log', () => {
    let session = startLocal(UID, 'stopwatch', null, 0, 0, 0)
    session = pauseLocal(UID, session, 100_000)
    const stopped = stopLocal(UID, session, { durationSeconds: 100, reason: 'manual', now: 400_000 })
    assert.equal(stopped.pauseLog.length, 1)
    assert.deepEqual(stopped.pauseLog[0], { start: 100_000, end: 400_000, type: 'pause' })
  })

  test('stopping directly from "onBreak" (never ended the break) closes it out typed "break"', () => {
    let session = startLocal(UID, 'stopwatch', null, 1, 300, 0)
    session = startBreakLocal(UID, session, 100_000)
    const stopped = stopLocal(UID, session, { durationSeconds: 100, reason: 'manual', now: 250_000 })
    assert.equal(stopped.pauseLog.length, 1)
    assert.equal(stopped.pauseLog[0].type, 'break')
  })

  test('stopping directly from "active" leaves an empty pauseLog untouched — no spurious entry', () => {
    const session = startLocal(UID, 'stopwatch', null, 0, 0, 0)
    const stopped = stopLocal(UID, session, { durationSeconds: 100, reason: 'manual', now: 100_000 })
    assert.deepEqual(stopped.pauseLog, [])
  })
})
