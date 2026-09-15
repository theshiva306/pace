// Matches each scheduled block against completed sessions of the same
// type and scores how closely the day was followed. See the design
// discussion this came out of: a block counts as attempted if some
// session of the right type started within START_TOLERANCE_MS of the
// block's planned start — starting a few minutes early or late still
// counts, since that's normal and shouldn't read as "missed." Once
// matched, the block is scored by how much of its planned duration that
// session actually covered.
const START_TOLERANCE_MS = 15 * 60 * 1000

// blocks: [{ id, type: 'focus'|'semiFocus', startMs, endMs }]
// sessions: [{ sessionType, startedAt, durationSeconds }] — completed
// sessions whose startedAt falls on the same calendar day as the blocks.
// now: current time in ms — defaults to Infinity so callers scoring a
// day that's already fully in the past (the normal case) don't need to
// pass it. Only matters for scoring *today* while it's still in
// progress: without it, a block later this evening that simply hasn't
// happened yet would be indistinguishable from one that was skipped.
//
// Returns each block annotated with a status:
//   'missed'   — no matching session started within the tolerance window,
//                and the block's own start (+ tolerance) has already passed
//   'short'    — a session matched, but ran less than the planned duration
//   'done'     — a session matched and covered the full planned duration
//   'upcoming' — the block's start (+ tolerance) hasn't arrived yet, so
//                there's nothing to judge — excluded from the percentage
//                entirely rather than counted against it
// plus the day's overall adherencePct: credited minutes (capped per
// block at that block's own planned length) over total planned minutes
// of blocks that have actually had their chance to happen.
// A session that doesn't match any block still happened — it's just not
// tied to a slot, so it doesn't add to or subtract from this score;
// lib/schedule.js's actual-time totals count it regardless.
export function scoreDay(blocks, sessions, now = Infinity) {
  const pool = [...sessions].sort((a, b) => a.startedAt - b.startedAt)
  let totalPlannedSec = 0
  let totalCreditedSec = 0

  const scoredBlocks = [...blocks]
    .sort((a, b) => a.startMs - b.startMs)
    .map((block) => {
      const plannedSec = Math.max(0, (block.endMs - block.startMs) / 1000)

      const matchIndex = pool.findIndex(
        (s) => s.sessionType === block.type && Math.abs(s.startedAt - block.startMs) <= START_TOLERANCE_MS,
      )
      if (matchIndex === -1) {
        if (now < block.startMs + START_TOLERANCE_MS) {
          return { ...block, status: 'upcoming', creditedSec: 0, actualSec: 0, shortfallSec: plannedSec }
        }
        totalPlannedSec += plannedSec
        return { ...block, status: 'missed', creditedSec: 0, actualSec: 0, shortfallSec: plannedSec }
      }
      totalPlannedSec += plannedSec
      const [match] = pool.splice(matchIndex, 1) // consumed — a session can't cover two blocks
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
