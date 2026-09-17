import { formatDuration } from './format.js'

// Scores how closely the day was followed by summing, for each block,
// how many seconds of matching-type sessions actually fall inside that
// block's own window.
//
// Credit is pure time-overlap — nothing more. A block is not "claimed"
// by one session and closed off; every session of the matching type
// contributes whatever slice of itself lands inside the block, capped
// at the block's own planned length. This means one long, unbroken
// session that runs across several back-to-back blocks (e.g. someone
// who keeps going past the end of one slot straight into the next
// without stopping the timer) correctly credits EACH block for its own
// slice, instead of the whole session being swallowed by whichever
// block happens to be scored first.
//
// The flip side, deliberately accepted: there's no forgiveness for
// starting late or finishing early. A block started 15 minutes late is
// short by 15 minutes' worth of overlap, even if the total time studied
// that day matches the plan exactly — clock alignment is what's being
// measured here, not just total minutes banked. Any time outside a
// block's window — running early, running late, or sitting in the gap
// between two blocks — isn't credited to a slot; it still shows up in
// the day's raw actual-time total (lib/schedule.js), just not pinned
// to a slot.
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
//   'missed'   — zero overlap with any matching-type session, and the
//                block's own end time has passed
//   'short'    — some overlap, but less than the block's planned length
//   'done'     — overlap at least covers the block's planned length
//   'upcoming' — the block's own end time hasn't passed yet (it hasn't
//                started, or is still in progress) — excluded from the
//                percentage entirely rather than counted against it
// plus the day's overall adherencePct: credited minutes (capped per
// block at that block's own planned length) over total planned minutes
// of blocks that have actually had their chance to happen.
//
// Note: this sums overlap independently per block, so if two blocks
// were ever allowed to overlap each other in time, the same stretch of
// study could double-credit both. That's a non-issue today because
// Schedule.jsx already rejects overlapping blocks at creation time
// (see the `overlaps` check in handleSave) — this function relies on
// that guarantee rather than re-enforcing it itself.
//
// One deliberate exception to "pure overlap, nothing more": a 15-minute
// grace window is added to each block's END only. Running up to 15
// minutes past a block's scheduled end still counts toward it — this
// is the only way a late start can be partially clawed back, by
// continuing to study that much further past the original end time.
// It is NOT symmetric: starting early doesn't get the same treatment,
// and the grace only recovers up to 15 minutes — a 30-minute-late start
// still nets a 15-minute shortfall even if you keep going well past
// the scheduled end. The grace window is clamped so it never bleeds
// into whatever block comes right after it (relevant if two blocks are
// scheduled less than 15 minutes apart).
const GRACE_MS = 15 * 60 * 1000

export function scoreDay(blocks, sessions, now = Infinity) {
  let totalPlannedSec = 0
  let totalCreditedSec = 0
  const sortedBlocks = [...blocks].sort((a, b) => a.startMs - b.startMs)

  const scoredBlocks = sortedBlocks.map((block, i) => {
    const plannedSec = Math.max(0, (block.endMs - block.startMs) / 1000)
    const nextBlock = sortedBlocks[i + 1]
    // Computed up front, before the upcoming/scored branch, so a caller
    // (e.g. a "Live" indicator on the schedule page) can tell exactly
    // when a block's own credit window actually closes — whether the
    // block has been scored yet or not.
    const graceEndMs = nextBlock ? Math.min(block.endMs + GRACE_MS, nextBlock.startMs) : block.endMs + GRACE_MS

    if (now < block.endMs) {
      return { ...block, status: 'upcoming', creditedSec: 0, actualSec: 0, shortfallSec: plannedSec, graceEndMs }
    }
    totalPlannedSec += plannedSec

    let overlapSec = 0
    for (const s of sessions) {
      if (s.sessionType !== block.type) continue
      const sessionEndMs = s.startedAt + s.durationSeconds * 1000
      const overlapMs = Math.min(graceEndMs, sessionEndMs) - Math.max(block.startMs, s.startedAt)
      if (overlapMs > 0) overlapSec += overlapMs / 1000
    }

    const creditedSec = Math.min(overlapSec, plannedSec)
    totalCreditedSec += creditedSec
    const status = creditedSec === 0 ? 'missed' : creditedSec < plannedSec ? 'short' : 'done'

    return {
      ...block,
      status,
      creditedSec,
      graceEndMs,
      actualSec: overlapSec, // raw overlap before capping — can exceed plannedSec
      shortfallSec: Math.max(0, plannedSec - creditedSec),
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
