// Matches each scheduled block against completed sessions of the same
// type and scores how closely the day was followed.
//
// Credit is based on actual time OVERLAP between a session and the
// block's own window, not on how close the session's start time was to
// the block's planned start. A session that begins 20 minutes late but
// still covers nearly the whole block should be credited for that
// overlap — not zeroed out just because it didn't start on the dot.
// A pure start-time-tolerance check (an earlier version of this used a
// flat 15-minute window) has no way to represent "mostly did it, just
// started late," which is a common and legitimate case.
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
//   'missed'   — no session of the matching type overlapped the block's
//                window at all, and the block's own end time has passed
//   'short'    — some overlap, but less than the block's full length
//   'done'     — the overlap covers the block's full planned length
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

      // Whichever remaining session of the right type overlaps this
      // block's window the most — not necessarily the one that started
      // closest to it.
      let bestIndex = -1
      let bestOverlapSec = 0
      pool.forEach((s, i) => {
        if (s.sessionType !== block.type) return
        const overlapMs = Math.min(block.endMs, s.endedAt) - Math.max(block.startMs, s.startedAt)
        const overlapSec = Math.max(0, overlapMs) / 1000
        if (overlapSec > bestOverlapSec) {
          bestOverlapSec = overlapSec
          bestIndex = i
        }
      })

      if (bestIndex === -1) {
        return { ...block, status: 'missed', creditedSec: 0, actualSec: 0, shortfallSec: plannedSec }
      }
      const [match] = pool.splice(bestIndex, 1) // consumed — a session can't cover two blocks
      const creditedSec = Math.min(bestOverlapSec, plannedSec)
      totalCreditedSec += creditedSec
      const status = creditedSec >= plannedSec ? 'done' : 'short'
      return {
        ...block,
        status,
        creditedSec,
        actualSec: match.durationSeconds,
        shortfallSec: Math.max(0, plannedSec - creditedSec),
      }
    })

  const adherencePct = totalPlannedSec > 0 ? Math.round((totalCreditedSec / totalPlannedSec) * 100) : null
  return { blocks: scoredBlocks, adherencePct }
}

// A short, plain-language line for the insight card — the "oh no, I need
// to not miss this tomorrow" nudge, built from what actually went wrong
// rather than just stating the percentage again.
export function summarize(scoredBlocks) {
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
