import { formatDuration, formatMessageTime } from '../../lib/format'
import Sheet from '../../components/Sheet'
import { STATUS_STYLE } from './statusStyle'

// Splits a block's own window PLUS its grace extension into a flat,
// ordered list of segments for the timeline bar: studied, studied
// during the grace extension (kept separate so it can render with its
// own hatched look), paused, and gap (nothing happened). Built from
// every session's active/paused stretches. A session with no pauseLog
// (saved before pause tracking existed) is just one continuous studied
// stretch.
function buildTimelineSegments(block, sessions) {
  const winStart = block.startMs
  const winEnd = block.graceEndMs
  const winLen = winEnd - winStart
  if (winLen <= 0) return []

  const intervals = []
  for (const s of sessions) {
    // endedAt is already the correct, current real end for whatever
    // state the session is in — actively studying (ticking "now"),
    // paused/on a break (frozen at the pause), or genuinely finished.
    // No separate "is it still live" branch here on purpose: that used
    // to independently decide "treat this as up-to-the-minute" using
    // only a not-yet-stopped flag, which wrongly extended a currently
    // PAUSED session's timeline all the way to right now — see
    // lib/adherence.js's studiedIntervals for the fuller explanation.
    const sessionEnd = s.endedAt ?? (s.startedAt + s.durationSeconds * 1000)
    const pauses = (s.pauseLog || []).filter((p) => p.end > winStart && p.start < winEnd)
    let cursor = s.startedAt
    for (const p of [...pauses].sort((a, b) => a.start - b.start)) {
      if (p.start > cursor) intervals.push({ type: 'studied', start: cursor, end: p.start })
      cursor = Math.max(cursor, p.end)
      intervals.push({ type: 'paused', start: p.start, end: p.end })
    }
    if (sessionEnd > cursor) intervals.push({ type: 'studied', start: cursor, end: sessionEnd })
  }

  // A studied stretch that straddles the block's own end gets split so
  // the part past it (the grace extension) can carry its own look.
  const split = []
  for (const iv of intervals) {
    if (iv.type === 'studied' && iv.start < block.endMs && iv.end > block.endMs) {
      split.push({ type: 'studied', start: iv.start, end: block.endMs })
      split.push({ type: 'studiedGrace', start: block.endMs, end: iv.end })
    } else if (iv.type === 'studied' && iv.start >= block.endMs) {
      split.push({ type: 'studiedGrace', start: iv.start, end: iv.end })
    } else {
      split.push(iv)
    }
  }

  const clipped = split
    .map((iv) => ({ ...iv, start: Math.max(iv.start, winStart), end: Math.min(iv.end, winEnd) }))
    .filter((iv) => iv.end > iv.start)
    .sort((a, b) => a.start - b.start)

  const segments = []
  let cursor = winStart
  for (const iv of clipped) {
    if (iv.start > cursor) segments.push({ type: 'gap', start: cursor, end: iv.start })
    segments.push(iv)
    cursor = Math.max(cursor, iv.end)
  }
  if (cursor < winEnd) segments.push({ type: 'gap', start: cursor, end: winEnd })

  return segments.map((seg) => ({ ...seg, pct: ((seg.end - seg.start) / winLen) * 100 }))
}

// Same colors everywhere a timeline appears, and none of them double as
// a meaning used elsewhere in the app for something else: studied is
// always live-green (studying is always the good outcome, regardless of
// how the block as a whole scored), a pause or break is a neutral
// dashed pattern — it isn't a "win" or "loss" on its own, so it doesn't
// get a color that means either — a gap is a plain dark tone, and
// studying during the grace extension is the same green as ordinary
// studying but hatched, so it visually reads as "studied, just the
// bonus bit."
const SEGMENT_BG = {
  studied: 'var(--color-live)',
  studiedGrace: 'repeating-linear-gradient(45deg, var(--color-live), var(--color-live) 4px, var(--color-elevated) 4px, var(--color-elevated) 8px)',
  paused: 'repeating-linear-gradient(45deg, var(--color-elevated), var(--color-elevated) 4px, var(--color-border) 4px, var(--color-border) 8px)',
  gap: 'var(--color-elevated)',
}

const LEGEND_ITEMS = [
  { key: 'studied', label: 'Studied', dot: 'var(--color-live)' },
  { key: 'paused', label: 'Paused', dot: SEGMENT_BG.paused },
  { key: 'gap', label: 'Unstudied', dot: 'var(--color-elevated)' },
  // "Recovered" rather than "Studied in grace" — the latter needed you to
  // already know what "grace" meant on this screen. This bucket only
  // ever shows the slice of extra time that actually closed the gap
  // between what was studied in the planned window and the planned
  // length itself (see graceActive/neededGraceSec in
  // SessionInsightsSheet) — so "recovered [a shortfall]" is literally
  // what it represents.
  { key: 'studiedGrace', label: 'Recovered', dot: SEGMENT_BG.studiedGrace },
]

// One short callout: a bold lead clause naming the actual studied span,
// then a lighter sentence covering pauses and any grace extension used
// — in plain words, but "grace" is fine to name here since the bar
// right above it already labels and defines that zone visually.
function describeInsight(block, sessions) {
  const segments = buildTimelineSegments(block, sessions)
  const studiedSegs = segments.filter((s) => s.type === 'studied' || s.type === 'studiedGrace')
  if (studiedSegs.length === 0) return { lead: 'No study time overlapped this block', rest: '' }

  const firstStart = Math.min(...studiedSegs.map((s) => s.start))
  const totalStudiedSec = studiedSegs.reduce((a, s) => a + (s.end - s.start) / 1000, 0)
  const lead = `Studied ${formatDuration(totalStudiedSec)}`

  const lateSec = Math.max(0, firstStart - block.startMs) / 1000
  const pauseDurationsSec = segments.filter((s) => s.type === 'paused').map((s) => (s.end - s.start) / 1000)
  const graceSec = segments.filter((s) => s.type === 'studiedGrace').reduce((a, s) => a + (s.end - s.start) / 1000, 0)

  const clauses = []
  if (lateSec >= 60) clauses.push(`started a bit late at ${formatMessageTime(firstStart)}`)
  if (pauseDurationsSec.length === 1) {
    clauses.push(`paused once (${formatDuration(pauseDurationsSec[0])})`)
  } else if (pauseDurationsSec.length > 1) {
    // Durations only, never clock times — how long each pause ran is
    // what's useful here, not when it happened.
    const countWord = pauseDurationsSec.length === 2 ? 'twice' : `${pauseDurationsSec.length} times`
    clauses.push(`paused ${countWord} (${pauseDurationsSec.map((s) => formatDuration(s)).join(', ')})`)
  }
  if (graceSec >= 30) clauses.push(`continued ${formatDuration(graceSec)} past the scheduled end`)

  const rest = clauses.length > 0 ? `${clauses.join(', ')}.` : ''
  return { lead, rest }
}

export default function SessionInsightsSheet({ block, sessions, onClose }) {
  const style = block?.status ? STATUS_STYLE[block.status] : null
  if (!block) return <Sheet open={false} onClose={onClose} />

  // Grace only gets shown at all when it actually did something: the
  // block fell short inside its own planned window AND real (not
  // paused) studying genuinely happened during the grace extension. A
  // block that was already fully covered within its planned window has
  // no use for grace, however much extra time was studied past the
  // official end — and a block where the person paused/stopped instead
  // of continuing to focus never activated grace in the first place.
  //
  // And when grace IS active, only as much of it as was actually needed
  // to close that shortfall gets shown — never the full raw time spent
  // studying past the end. Credit is capped at the block's own planned
  // length either way, so once enough grace time has closed the gap,
  // anything studied beyond that point genuinely didn't do anything for
  // this block; narrating it as "grace" here would be misleading.
  //
  // The cutoff is found by walking the real grace-zone segments in
  // chronological order until enough of them add up to what was needed
  // — not just block.endMs plus a flat duration — so a pause sitting
  // right at the boundary (a little studying, a pause, more studying
  // later) still lands the cutoff on time that was actually studied,
  // rather than assuming the recovery started right at the block's end.
  const plannedSec = Math.max(0, (block.endMs - block.startMs) / 1000)
  const fullSegments = buildTimelineSegments(block, sessions)
  const mainStudiedSec = fullSegments.filter((s) => s.type === 'studied').reduce((a, s) => a + (s.end - s.start) / 1000, 0)
  const graceStudiedSec = fullSegments.filter((s) => s.type === 'studiedGrace').reduce((a, s) => a + (s.end - s.start) / 1000, 0)
  const shortfallSec = Math.max(0, plannedSec - mainStudiedSec)
  const neededGraceSec = Math.min(shortfallSec, graceStudiedSec)
  const graceActive = neededGraceSec > 0

  let graceCutoffMs = block.endMs
  if (graceActive) {
    let acc = 0
    for (const seg of fullSegments) {
      if (seg.type !== 'studiedGrace') continue
      const segSec = (seg.end - seg.start) / 1000
      if (acc + segSec >= neededGraceSec) { graceCutoffMs = seg.start + (neededGraceSec - acc) * 1000; break }
      acc += segSec
    }
  }
  const displayBlock = { ...block, graceEndMs: graceCutoffMs }

  const segments = buildTimelineSegments(displayBlock, sessions)
  const plannedMs = block.endMs - block.startMs
  const graceMs = displayBlock.graceEndMs - block.endMs
  const totalMs = plannedMs + graceMs
  const plannedPct = (plannedMs / totalMs) * 100
  const gracePct = (graceMs / totalMs) * 100

  const totalsByType = segments.reduce((acc, seg) => {
    acc[seg.type] = (acc[seg.type] || 0) + (seg.end - seg.start) / 1000
    return acc
  }, {})

  const { lead, rest } = describeInsight(displayBlock, sessions)

  return (
    <Sheet open onClose={onClose}>
      <div className="flex items-center justify-between gap-2 mb-1 pr-8">
        <h2 className="text-base font-semibold truncate">{block.title}</h2>
        {style && (
          <span className={`text-xs px-2 py-1 rounded-md shrink-0 ${style.className}`}>
            {block.status === 'short'
              ? (block.shortfallSec < 60 ? '<1m short' : `${formatDuration(block.shortfallSec)} short`)
              : style.label}
          </span>
        )}
      </div>
      <div className="text-xs text-text-dim mb-4">
        {formatMessageTime(block.startMs)} – {formatMessageTime(block.endMs)} planned
      </div>

      {/* Bracket labels above the bar, sized to match the two zones below.
          The grace bracket only renders at all when grace actually did
          something for this block — see graceActive above. */}
      <div className="flex text-[10px] text-text-faint mb-1">
        <div style={{ width: `${plannedPct}%` }} className="text-center truncate px-1">
          Planned block ({formatDuration(plannedMs / 1000)})
        </div>
        {graceActive && (
          <div style={{ width: `${gracePct}%` }} className="text-center truncate px-1">
            Recovered ({formatDuration(graceMs / 1000)})
          </div>
        )}
      </div>
      <div className="flex mb-1.5">
        <div style={{ width: `${plannedPct}%` }} className="border-b border-border mx-0.5" />
        {graceActive && <div style={{ width: `${gracePct}%` }} className="border-b border-dashed border-border mx-0.5" />}
      </div>

      <div className="relative h-6 rounded-md overflow-hidden bg-elevated mb-1.5">
        {segments.map((seg, i) => {
          let left = 0
          for (let j = 0; j < i; j++) left += segments[j].pct
          return (
            <div
              key={i}
              className="absolute inset-y-0"
              style={{ left: `${left}%`, width: `${seg.pct}%`, background: SEGMENT_BG[seg.type] }}
            />
          )
        })}
      </div>
      <div className="relative h-3.5 text-[10px] text-text-faint mb-4">
        <span className="absolute left-0">{formatMessageTime(block.startMs)}</span>
        {/* Right-anchored at the exact point where the planned block ends
            (the same plannedPct the bar segments above use), not centered
            or evenly spaced — a centered label would drift away from the
            actual planned/grace boundary any time the grace slice isn't
            roughly half the bar's width, which is most of the time. */}
        <span className="absolute -translate-x-full" style={{ left: `${plannedPct}%` }}>
          {formatMessageTime(block.endMs)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 mb-5">
        {LEGEND_ITEMS.filter((item) => graceActive || item.key !== 'studiedGrace').map((item) => (
          <div key={item.key} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: item.dot }} />
            <div className="min-w-0">
              <div className="text-xs text-text-dim leading-tight">{item.label}</div>
              <div className="text-sm leading-tight">{formatDuration(totalsByType[item.key] || 0)}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-3 px-3.5 py-3 bg-elevated rounded-xl">
        <span className="w-7 h-7 rounded-full bg-accent-soft text-accent flex items-center justify-center shrink-0 text-sm">✦</span>
        <p className="text-sm leading-relaxed">
          <span className="font-medium">{lead}{rest ? ',' : '.'}</span>{rest && <span className="text-text-dim"> {rest}</span>}
        </p>
      </div>
    </Sheet>
  )
}
