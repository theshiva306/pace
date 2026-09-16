import { formatDuration } from './format.js'

// Matches each scheduled block against completed sessions of the same
// type and scores how closely the day was followed.
//
// A session "belongs" to a block once a substantial share of it falls
// inside the block's own window — at least half of whichever is
// shorter, the block or the session. That's loose enough that starting
// (or finishing) 15 minutes late doesn't disqualify a session that's
// clearly the one meant for this slot, but tight enough that a long,
// unrelated session that barely brushes the edge of a block doesn't
// get credited for it.
//
// Once a session clears that bar, it's credited by its OWN duration —
// not by the literal overlap length — capped at the block's planned
// length. That matters: pure overlap can never reach 100% once a
// session starts even a minute late (the minutes before the late
// start were never available to overlap), which is the wrong thing to
// measure — a 9-11am block started at 9:15 and studied for the full
// 2 hours (finishing at 11:15) is fully done, not "87% done," even
// though the literal overlap with the 9-11 window is only 1h45m.
// What matters is whether the planned amount of work happened, loosely
// around the right time — not exact clock alignment.
//
// blocks: [{ id, type: 'focus'|'semiFocus', startMs, endMs }]
// sessions: [{ sessionType, startedAt, durationSeconds }] — completed
// sessions whose startedAt falls on the same calendar day as the blocks.
// now: current time in ms — defaults to Infinity so callers scoring a
// day that's already fully in the past (the normal case) don't need to
// pass it. Only matters for scoring *today* while it's still in
// progress: a block can't fairly be judged missed while it might still
// be legitimately underway.
//
// Returns each block annotated with a status:
//   'missed'   — no session of the matching type substantially
//                overlapped the block's window, and the block's own
//                end time has passed
//   'short'    — a matching session ran less than the block's planned
//                length
//   'done'     — a matching session ran at least the block's planned
//                length
//   'upcoming' — the block's own end time hasn't passed yet (it hasn't
//                started, or is still in progress) — excluded from the
//                percentage entirely rather than counted against it
// plus the day's overall adherencePct: credited minutes (capped per
// block at that block's own planned length) over total planned minutes
// of blocks that have actually had their chance to happen.
// A session that doesn't overlap any block still happened — it's just
// not tied to a slot, so it doesn't add to or subtract from this score;
// lib/schedule.js's actual-time totals count it regardless.
export function scoreDay(blocks, sessions, now = Infinity) {
  const pool = sessions.map((s) => ({ ...s, endedAt: s.startedAt + s.durationSeconds * 1000 }))
  let totalPlannedSec = 0
  let totalCreditedSec = 0

  const scoredBlocks = [...blocks]
    .sort((a, b) => a.startMs - b.startMs)
    .map((block) => {
      const plannedSec = Math.max(0, (block.endMs - block.startMs) / 1000)

      if (now < block.endMs) {
        return { ...block, status: 'upcoming', creditedSec: 0, actualSec: 0, shortfallSec: plannedSec }
      }
      totalPlannedSec += plannedSec

      // Whichever remaining session of the right type clears the
      // "belongs to this block" bar with the most overlap — not
      // necessarily the one that started closest to it.
      let bestIndex = -1
      let bestOverlapSec = 0
      pool.forEach((s, i) => {
        if (s.sessionType !== block.type) return
        const overlapMs = Math.min(block.endMs, s.endedAt) - Math.max(block.startMs, s.startedAt)
        const overlapSec = Math.max(0, overlapMs) / 1000
        const requiredSec = 0.5 * Math.min(plannedSec, s.durationSeconds)
        if (overlapSec >= requiredSec && overlapSec > bestOverlapSec) {
          bestOverlapSec = overlapSec
          bestIndex = i
        }
      })

      if (bestIndex === -1) {
        return { ...block, status: 'missed', creditedSec: 0, actualSec: 0, shortfallSec: plannedSec }
      }
      const [match] = pool.splice(bestIndex, 1) // consumed — a session can't cover two blocks
      const creditedSec = Math.min(match.durationSeconds, plannedSec)
      totalCreditedSec += creditedSec
      const status = match.durationSeconds >= plannedSec ? 'done' : 'short'
      return {
        ...block,
        status,
        creditedSec,
        actualSec: match.durationSeconds,
        shortfallSec: Math.max(0, plannedSec - match.durationSeconds),
      }
    })

  const adherencePct = totalPlannedSec > 0 ? Math.round((totalCreditedSec / totalPlannedSec) * 100) : null
  return { blocks: scoredBlocks, adherencePct }
}

// A short, plain-language line for the insight card — the "oh no, I need
// to not miss this tomorrow" nudge, built from what actually went wrong
// rather than just stating the percentage again.
//
// dayTotals (optional): { actualSec, plannedSec } for the WHOLE day —
// every session studied, against every block scheduled — not just the
// per-block credit above. A day where you studied well beyond
// everything you'd planned is a genuine win even if one slot slipped,
// so that gets said first and plainly, instead of leading with a nag
// about the slot that came up short.
export function summarize(scoredBlocks, dayTotals) {
  if (dayTotals && dayTotals.plannedSec > 0) {
    const extraSec = dayTotals.actualSec - dayTotals.plannedSec
    if (extraSec >= 15 * 60) {
      return `You studied ${formatDuration(extraSec)} more than you had scheduled today — great work.`
    }
  }

  const missed = scoredBlocks.filter((b) => b.status === 'missed')
  const short = scoredBlocks.filter((b) => b.status === 'short')
  if (missed.length === 0 && short.length === 0) {
    return scoredBlocks.length > 0 ? 'Every planned block happened, on time and in full.' : null
  }
  const parts = []
  if (short.length > 0) {
    parts.push(`studied less than planned in ${short.length === 1 ? short[0].title : `${short.length} sessions`}`)
  }
  if (missed.length > 0) {
    parts.push(`missed ${missed.length === 1 ? `the ${missed[0].title} slot` : `${missed.length} slots`}`)
  }
  return `You ${parts.join(', and ')}.`
}
