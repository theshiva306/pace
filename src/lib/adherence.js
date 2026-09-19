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
// scheduled less than 15 minutes apart), and it never bleeds past the
// end of the block's own calendar day either — a block ending at 11:59pm
// only gets 1 minute of grace, not the full 15, so a "late" credit never
// gets attributed to the wrong day.
const GRACE_MS = 15 * 60 * 1000

// End of the local calendar day that `ms` falls on (the next local
// midnight). Used to stop a block's grace window from bleeding into the
// next day — see the GRACE_MS note above.
function endOfDayMs(ms) {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime()
}

// Reconstructs the real, fragmented "actually studying" timeline for one
// session instead of treating it as one unbroken stretch from start to
// start+duration. That naive shape is wrong for any paused session:
// `durationSeconds` already has pause time subtracted out, so
// `startedAt + durationSeconds*1000` silently slides everything after a
// pause EARLIER in time, compressing the session into a shorter window
// than it actually ran in. Depending on exactly where the pause falls
// relative to a block's boundaries, that compression can credit time
// that was never really inside the block (dragged in from later) just
// as easily as it can drag real, valid overlap OUT of the block entirely
// — i.e. it can over- or under-count in either direction, which is
// exactly the "sometimes short, sometimes not" behavior this was built
// to fix.
//
// Returns a list of { start, end } studied intervals with every logged
// pause/break carved out. Only possible when the session actually
// carries real timing data (a real end time, in `endedAt`) — a session
// saved before pause logging existed has neither `endedAt` nor
// `pauseLog`, so there's no way to recover where its real pauses fell;
// those fall back to the old single-block approximation, same as before
// this fix (no regression for old data).
//
// `endedAt` must be the session's real, current end moment — for an
// in-progress session that's actively studying right now, the CALLER is
// responsible for passing the live "now" (re-passed on every re-render
// so it keeps ticking); for one that's currently paused or on a break,
// the caller must pass the moment it paused, frozen, NOT "now" — this
// function has no way to tell "genuinely still studying" apart from
// "merely not yet stopped" on its own, so it never guesses.
function studiedIntervals(session) {
  if (session.endedAt == null) {
    return [{ start: session.startedAt, end: session.startedAt + session.durationSeconds * 1000 }]
  }
  const pauses = [...(session.pauseLog || [])].sort((a, b) => a.start - b.start)
  const intervals = []
  let cursor = session.startedAt
  for (const p of pauses) {
    if (p.start > cursor) intervals.push({ start: cursor, end: p.start })
    cursor = Math.max(cursor, p.end)
  }
  if (session.endedAt > cursor) intervals.push({ start: cursor, end: session.endedAt })
  return intervals
}

// How many seconds of a session's real, pause-excluded studied time land
// inside a block's window (through its grace extension). This is the
// single source of truth for "overlap" — scoreDay uses it to score each
// block, and the schedule page's own insights sheet uses the same
// function so the per-session breakdown it shows can never disagree with
// the badge/percentage above it.
export function sessionOverlapSec(session, block) {
  let sec = 0
  for (const iv of studiedIntervals(session)) {
    const overlapMs = Math.min(block.graceEndMs, iv.end) - Math.max(block.startMs, iv.start)
    if (overlapMs > 0) sec += overlapMs / 1000
  }
  return sec
}

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
    // block has been scored yet or not. Clamped against whichever comes
    // first: the next block's own start, or the end of the calendar day
    // the block itself belongs to.
    const graceEndMs = Math.min(
      block.endMs + GRACE_MS,
      nextBlock ? nextBlock.startMs : Infinity,
      endOfDayMs(block.startMs),
    )

    if (now < block.endMs) {
      return { ...block, status: 'upcoming', creditedSec: 0, actualSec: 0, shortfallSec: plannedSec, graceEndMs }
    }
    totalPlannedSec += plannedSec

    let overlapSec = 0
    for (const s of sessions) {
      if (s.sessionType !== block.type) continue
      overlapSec += sessionOverlapSec(s, { startMs: block.startMs, graceEndMs })
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
