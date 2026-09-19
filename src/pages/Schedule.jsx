import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { dayId, addDays } from '../lib/day'
import { weekStart, weekInfo } from '../lib/week'
import { formatDuration, formatMessageTime } from '../lib/format'
import {
  useScheduleBlocks, addScheduleBlock, updateScheduleBlock, deleteScheduleBlock, copyScheduleBlocks,
  fetchSessionsForDay, fetchWeekActualTotals,
} from '../lib/schedule'
import { scoreDay, summarize, sessionOverlapSec } from '../lib/adherence'
import { useServerOffset } from '../hooks/useServerOffset'
import { useActiveSession } from '../hooks/useActiveSession'
import { useSessionClock } from '../hooks/useSessionClock'
import { readPendingCompleted } from '../lib/pendingCompleted'
import Sheet from '../components/Sheet'
import Button from '../components/Button'
import SegmentedControl from '../components/SegmentedControl'
import { ScheduleListSkeleton } from '../components/Skeleton'
import {
  PlusIcon, TrashIcon, CopyIcon, QuestionIcon, ChevronLeft, ChevronRight,
} from '../components/icons'

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const TITLE_MAX_LENGTH = 60

// "2026-08-17" -> "Monday", for labeling the copy-from-previous-day button.
function weekdayName(dateId) {
  const [y, m, d] = dateId.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'long' })
}

// Built from addDays (calendar-component arithmetic), not raw ms math —
// a week that spans a DST transition would otherwise risk landing on
// the wrong local date for the days after the transition.
function weekDateIds(anchorMonday) {
  const mondayId = dayId(anchorMonday)
  return Array.from({ length: 7 }, (_, i) => addDays(mondayId, i))
}

// "HH:MM" (native <input type="time">'s format) -> epoch ms on the given
// calendar day, local time.
function timeToMs(dateId, timeStr) {
  const [y, m, d] = dateId.split('-').map(Number)
  const [h, min] = timeStr.split(':').map(Number)
  return new Date(y, m - 1, d, h, min, 0, 0).getTime()
}

// epoch ms -> "HH:MM", the inverse of timeToMs — used to prefill the edit
// sheet and to suggest a next-block start time from an existing one.
function msToTimeStr(ms) {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const STATUS_STYLE = {
  done: { label: 'On time', className: 'bg-live-soft text-live' },
  // Deliberately not text-accent — accent is the brand gold used
  // everywhere else (the CTA, the Focus session indicator), so reusing
  // it here would make "you fell short" look like the same color as
  // "this is the primary action." A distinct warning tone keeps a clean
  // good/warning/bad three-way split.
  short: { label: null, className: 'bg-warn-soft text-warn' }, // label filled in per-block with the actual shortfall
  missed: { label: 'Missed', className: 'bg-danger-soft text-danger' },
  // 'upcoming' deliberately has no entry — StatusBadge renders nothing for
  // it, same as a block on a future day. Its time just hasn't come yet,
  // so there's nothing to report.
}

function StatusBadge({ block, isLive, onOpenInsights }) {
  if (isLive) {
    return (
      <button
        onClick={onOpenInsights}
        className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md shrink-0 bg-live-soft text-live"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-live animate-pulse-soft" aria-hidden />
        Live
      </button>
    )
  }
  if (!block.status || block.status === 'upcoming') return null
  const style = STATUS_STYLE[block.status]
  // formatDuration floors to whole minutes, so a shortfall under 60
  // seconds would otherwise render as the confusing "0m short" --
  // technically not wrong, but reads like a rounding bug. "<1m short"
  // says the same true thing without implying more precision than the
  // badge actually has room to show.
  const label = block.status === 'short'
    ? (block.shortfallSec < 60 ? '<1m short' : `${formatDuration(block.shortfallSec)} short`)
    : style.label
  return (
    <button onClick={onOpenInsights} className={`text-xs px-2 py-1 rounded-md shrink-0 ${style.className}`}>
      {label}
    </button>
  )
}

function BlockRow({ block, isLive, onEdit, onDeleteRequest, onOpenInsights }) {
  const typeLabel = block.type === 'semiFocus' ? 'Semi-focus' : 'Focus'
  const borderClass = block.type === 'semiFocus' ? 'border-l-semi' : 'border-l-accent'
  // Once a block has settled into a final verdict (done/short/missed —
  // not 'upcoming' or 'live', and not a future day's unscored raw block,
  // which has no status at all), it's locked: no more editing or
  // deleting a plan that's already history. Tapping it still does
  // something useful though — it opens the same insights view the
  // status badge already opens, instead of a dead row.
  const isFinished = block.status === 'done' || block.status === 'short' || block.status === 'missed'
  return (
    <div className={`flex items-center gap-3 px-3.5 py-3 bg-surface border border-border rounded-xl border-l-[3px] ${borderClass}`}>
      <button onClick={() => (isFinished ? onOpenInsights(block) : onEdit(block))} className="flex-1 min-w-0 text-left">
        <div className="text-sm font-medium truncate">{block.title}</div>
        <div className="text-xs text-text-dim mt-0.5">
          {formatMessageTime(block.startMs)} - {formatMessageTime(block.endMs)} · {typeLabel}
        </div>
      </button>
      <StatusBadge block={block} isLive={isLive} onOpenInsights={() => onOpenInsights(block)} />
      {!isFinished && (
        <button onClick={() => onDeleteRequest(block.id)} aria-label="Delete block" className="text-text-faint hover:text-danger p-1">
          <TrashIcon width="16" height="16" />
        </button>
      )}
    </div>
  )
}

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
    // Real stop time when we have one; falls back to the old compressed
    // approximation only for sessions saved before `endedAt` existed —
    // there's no real timing data to recover for those. See
    // lib/adherence.js's studiedIntervals for the same fallback.
    const sessionEnd = s.stillLive ? Date.now() : (s.endedAt ?? (s.startedAt + s.durationSeconds * 1000))
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

function SessionInsightsSheet({ block, sessions, onClose }) {
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

function WeekGraph({ dateIds, totals, selectedDateId, onSelect }) {
  const maxSec = Math.max(60, ...dateIds.map((id) => (totals[id]?.focusSec || 0) + (totals[id]?.semiSec || 0)))
  const selected = totals[selectedDateId] || { focusSec: 0, semiSec: 0 }
  const selectedTotalSec = selected.focusSec + selected.semiSec
  return (
    <div>
      <div className="text-sm text-text-dim mb-2">This week</div>
      <div className="flex items-end gap-2 h-28 mb-1.5">
        {dateIds.map((id) => {
          const t = totals[id] || { focusSec: 0, semiSec: 0 }
          const totalSec = t.focusSec + t.semiSec
          const focusPct = (t.focusSec / maxSec) * 100
          const semiPct = (t.semiSec / maxSec) * 100
          const isSelected = id === selectedDateId
          return (
            <button
              key={id}
              onClick={() => onSelect(id)}
              className="flex-1 h-full flex flex-col items-stretch justify-end gap-1"
            >
              {/* Total-time label pinned above the bar — the bar height alone
                  only supports comparing days against each other, not reading
                  an actual amount, so the number carries the exact value. */}
              <span className={`text-[10px] leading-none text-center ${isSelected ? 'text-accent font-medium' : 'text-text-faint'}`}>
                {totalSec > 0 ? formatDuration(totalSec) : ''}
              </span>
              <div className={`flex-1 flex flex-col justify-end rounded-t-sm ${isSelected ? 'ring-1 ring-accent ring-offset-1 ring-offset-bg' : ''}`}>
                <div style={{ height: `${semiPct}%` }} className="bg-semi rounded-t-sm min-h-0" />
                <div style={{ height: `${focusPct}%` }} className="bg-accent rounded-t-sm min-h-0" />
                {focusPct === 0 && semiPct === 0 && <div className="h-0.5 bg-border" />}
              </div>
            </button>
          )
        })}
      </div>
      <div className="flex gap-2 mb-2.5">
        {WEEKDAY_LABELS.map((label, i) => (
          <div key={label} className={`flex-1 text-center text-[11px] ${dateIds[i] === selectedDateId ? 'text-accent font-medium' : 'text-text-faint'}`}>
            {label}
          </div>
        ))}
      </div>
      {/* Exact breakdown for whichever day is selected — the bar labels give
          a fast weekly scan, this gives the precise focus/semi/combined split
          for the one day being looked at right now. */}
      <div className="text-xs text-text-dim">
        {selectedTotalSec > 0 ? (
          <>
            <span className="text-accent font-medium">{formatDuration(selected.focusSec)}</span> focus
            {selected.semiSec > 0 && (
              <> · <span className="text-semi font-medium">{formatDuration(selected.semiSec)}</span> semi-focus</>
            )}
            {' '}· <span className="text-text font-medium">{formatDuration(selectedTotalSec)}</span> combined
          </>
        ) : (
          'No study time this day.'
        )}
      </div>
    </div>
  )
}

export default function Schedule() {
  const { user } = useAuth()
  const todayId = dayId(new Date())
  const [weekOffset, setWeekOffset] = useState(0) // weeks before this one; negative = ahead
  const weekAnchor = useMemo(() => weekStart(weekOffset), [weekOffset])
  const dateIds = useMemo(() => weekDateIds(weekAnchor), [weekAnchor])
  const [selectedDateId, setSelectedDateId] = useState(todayId)

  const [weekTotals, setWeekTotals] = useState({})
  const [daySessions, setDaySessions] = useState(undefined)
  const [addOpen, setAddOpen] = useState(false)
  const [editingId, setEditingId] = useState(null) // null = adding a new block; else the block id being edited
  const [title, setTitle] = useState('')
  const [type, setType] = useState('focus')
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('10:00')
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copying, setCopying] = useState(false)
  const [copyError, setCopyError] = useState('')
  const [copyNote, setCopyNote] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)
  const [insightsBlockId, setInsightsBlockId] = useState(null)
  const [deleteTargetId, setDeleteTargetId] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const serverOffset = useServerOffset()

  // The timer's own live session — local-first, so this reflects a
  // running session immediately even before it's synced anywhere. Used
  // below so a block whose scheduled end has already passed, but which
  // you're still actively studying right now (haven't hit stop yet),
  // reads as in-progress rather than prematurely "Missed": completed
  // sessions alone (fetchSessionsForDay) can't see it since it hasn't
  // been saved as one yet.
  //
  // A stopped-but-not-yet-saved session (status 'stopped' — the Timer
  // tab is sitting on its "Save Session" screen, waiting for you to tap
  // Save) counts too, using its already-frozen finalDurationSeconds
  // rather than the live clock: useSessionClock's focusElapsed has no
  // concept of "stopped," so it would otherwise keep climbing forever
  // past the actual stop moment. Until it's actually saved, it's
  // invisible everywhere else (Schedule, week totals, group
  // leaderboards) too — this only fixes Schedule's own view of it.
  const liveSession = useActiveSession()
  const liveClock = useSessionClock(liveSession)
  // Deliberately compared against selectedDateId, not a separately
  // recomputed "todayId" -- see the note above scored's own now
  // selection for why that distinction matters right at midnight.
  const liveBelongsToSelectedDay = liveSession && dayId(new Date(liveSession.startedAt)) === selectedDateId
  const liveBelongsToToday = liveSession && dayId(new Date(liveSession.startedAt)) === todayId
  const liveDurationSec = liveSession?.status === 'stopped'
    ? Math.round(liveSession.finalDurationSeconds ?? 0)
    : Math.round(liveClock.focusElapsed)

  const blocks = useScheduleBlocks(user.uid, selectedDateId)

  // Sessions saved locally (Timer's Save button) but not yet confirmed
  // written to the database. lib/sessionSync.js flushes this queue to
  // Firebase as soon as a connection is available, but that flush is
  // fire-and-forget from Timer's own Save handler -- it doesn't block
  // anything here. Reading it directly (it's synchronous localStorage)
  // means a session saved a moment ago doesn't silently vanish from
  // this page for however long that write takes to land: without this,
  // the page's own daySessions refetch (below) is racing that network
  // write and, especially on a slow connection, usually loses.
  const pendingCompleted = useMemo(
    () => readPendingCompleted(user.uid).map((r) => ({
      id: r.sessionId,
      sessionType: r.data.sessionType || 'focus',
      startedAt: r.data.startedAt,
      durationSeconds: r.data.durationSeconds,
      endedAt: r.data.endedAt,
      pauseLog: r.data.pauseLog, // may be undefined — see localSession.js
    })),
    // Re-read on the same signal the daySessions refetch below uses --
    // a session finishing and being saved is exactly what populates
    // this queue, so it's the right moment to pick it up too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user.uid, liveSession?.sessionId ?? null],
  )

  useEffect(() => {
    fetchWeekActualTotals(user.uid, dateIds).then(setWeekTotals).catch(() => {})
  }, [user.uid, dateIds])

  useEffect(() => {
    setDaySessions(undefined)
    setCopyNote('')
    // Includes sessions that started the evening before selectedDateId
    // too (see fetchSessionsForDay's includePriorEvening) -- a session
    // running from 11:58pm into the new day needs to be visible here for
    // a block right at the start of THIS day to credit it at all.
    // Without this, a session crossing midnight is invisible to the next
    // day's blocks entirely, not just short-changed by the grace window
    // (which is a separate, already-handled concern in lib/adherence.js).
    fetchSessionsForDay(user.uid, selectedDateId, { includePriorEvening: true }).then(setDaySessions).catch(() => setDaySessions([]))
    // Re-fetch whenever the live session's own identity changes (one
    // starts, stops, or a different one begins) — not just on day/user
    // change. Otherwise, finally tapping "Save" on a session that was
    // sitting in limbo wouldn't show up here until the page is
    // revisited: the merge below stops including it the moment it's no
    // longer "live," but this fetch wouldn't yet know it just became a
    // real completed session. (pendingCompleted, above, is what actually
    // covers the gap until this fetch eventually catches up.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.uid, selectedDateId, liveSession?.sessionId ?? null])

  const isFuture = selectedDateId > todayId
  const isToday = selectedDateId === todayId

  // Today's fetched (completed) sessions, plus:
  //  - any locally-saved-but-not-yet-synced session for this day
  //    (pendingCompleted, filtered to this day and deduped against
  //    daySessions by startedAt in case a record is fetched from
  //    Firebase in the same beat it'd otherwise flush and get removed
  //    from the local queue), and
  //  - the live/stopped-pending one, if there is one for this day
  // — so scoring and totals both reflect what's actually happened, not
  // just what's already confirmed synced.
  const daySessionsWithLive = useMemo(() => {
    if (!daySessions) return daySessions
    const knownStarts = new Set(daySessions.map((s) => s.startedAt))
    // Same widened range as fetchSessionsForDay's includePriorEvening: a
    // pending session that started the evening before selectedDateId is
    // still a legitimate candidate for this day's blocks (crossing
    // midnight) -- not narrowed to selectedDateId alone, but also not
    // left unfiltered (a stale pending entry from weeks ago has no
    // business showing up while looking at today).
    const previousDateId = addDays(selectedDateId, -1)
    const pendingForDay = pendingCompleted.filter((s) => {
      if (knownStarts.has(s.startedAt)) return false
      const d = dayId(new Date(s.startedAt))
      return d === selectedDateId || d === previousDateId
    })
    const merged = pendingForDay.length > 0 ? [...daySessions, ...pendingForDay] : daySessions
    if (!liveBelongsToSelectedDay || liveDurationSec <= 0) return merged
    return [
      ...merged,
      {
        sessionType: liveSession.sessionType || 'focus',
        startedAt: liveSession.startedAt,
        durationSeconds: liveDurationSec,
        // Needed so scoreDay can reconstruct this still-running session's
        // real (pause-excluded) timeline instead of falling back to the
        // old compressed approximation — same reasoning as
        // daySessionsDetailed just below.
        pauseLog: liveSession.pauseLog,
        stillLive: liveSession.status !== 'stopped',
      },
    ]
  }, [daySessions, pendingCompleted, selectedDateId, liveBelongsToSelectedDay, liveSession, liveDurationSec])

  // Same idea as daySessionsWithLive, but keeping every field (id,
  // endedAt, pauseLog) instead of the lean shape scoreDay needs -- this
  // is purely for the "why did this block score the way it did"
  // insights sheet below, never fed into scoring itself.
  const daySessionsDetailed = useMemo(() => {
    if (!daySessions) return daySessions
    const knownStarts = new Set(daySessions.map((s) => s.startedAt))
    const previousDateId = addDays(selectedDateId, -1)
    const pendingForDay = pendingCompleted.filter((s) => {
      if (knownStarts.has(s.startedAt)) return false
      const d = dayId(new Date(s.startedAt))
      return d === selectedDateId || d === previousDateId
    })
    const merged = pendingForDay.length > 0 ? [...daySessions, ...pendingForDay] : daySessions
    if (!liveBelongsToSelectedDay || liveDurationSec <= 0) return merged
    return [
      ...merged,
      {
        id: liveSession.sessionId,
        sessionType: liveSession.sessionType || 'focus',
        startedAt: liveSession.startedAt,
        durationSeconds: liveDurationSec,
        endedAt: liveSession.status === 'stopped' ? liveSession.stoppedAt : null, // null while still actually live
        pauseLog: liveSession.pauseLog,
        stillLive: liveSession.status !== 'stopped',
      },
    ]
  }, [daySessions, pendingCompleted, selectedDateId, liveBelongsToSelectedDay, liveSession, liveDurationSec])

  const scored = useMemo(() => {
    if (isFuture || !blocks || !daySessionsWithLive) return null
    // Only today needs an actual cutoff — a block later this evening
    // hasn't happened yet and shouldn't be judged as missed. Past days
    // are scored as fully settled regardless (scoreDay's default of
    // Infinity does that on its own), so this only branches for today.
    //
    // Using Infinity vs. a real timestamp for a past day never actually
    // changes the result here, even right at midnight: scoreDay's `now`
    // only gates whether a block counts as "upcoming," and any block on
    // a day that's already ended has an endMs earlier than literally any
    // moment after that day is over, real timestamp or not. What DOES
    // need care right at midnight is liveBelongsToSelectedDay above --
    // that's compared against selectedDateId rather than a freshly
    // recomputed "today," so a session that started at, say, 9pm and is
    // still running past midnight keeps counting toward yesterday's
    // block (and its grace window) instead of abruptly stopping the
    // instant the calendar rolls over.
    const now = isToday ? Date.now() + serverOffset : Infinity
    return scoreDay(blocks, daySessionsWithLive, now)
  }, [isFuture, isToday, blocks, daySessionsWithLive, serverOffset])

  const rows = scored ? scored.blocks : blocks

  const insightsBlock = insightsBlockId ? rows?.find((b) => b.id === insightsBlockId) ?? null : null

  // Every session of the matching type that overlaps this block's own
  // window through its grace period, each carrying exactly how much of
  // it overlapped -- the same math scoreDay uses internally to produce
  // the single summed number, just surfaced per-session here so someone
  // can actually see which session (and which part of it) explains the
  // result, instead of just the final badge.
  const insightsSessions = useMemo(() => {
    if (!insightsBlock || !daySessionsDetailed) return []
    return daySessionsDetailed
      .filter((s) => s.sessionType === insightsBlock.type)
      // Same fragment-aware overlap scoreDay uses, so a session never
      // gets silently dropped from (or wrongly added to) this list based
      // on a naive "compressed" overlap that disagrees with what the
      // badge above actually credited it for.
      .map((s) => ({ ...s, overlapSec: sessionOverlapSec(s, insightsBlock) }))
      .filter((s) => s.overlapSec > 0)
      .sort((a, b) => a.startedAt - b.startedAt)
  }, [insightsBlock, daySessionsDetailed])

  // Which block (if any) counts as "Live" right now — a session of the
  // matching type is actually running (not paused/on-break is fine, not
  // stopped) and the current moment falls inside that block's own window
  // through its grace period. Gated on liveBelongsToSelectedDay (not
  // "isToday") for the same midnight reason as above — this needs to
  // keep working for a late-night block on selectedDateId even in the
  // few minutes right after the calendar rolls over to a new day.
  const liveNow = Date.now() + serverOffset
  const liveBlockId = (() => {
    if (!liveSession || liveSession.status === 'stopped' || !liveBelongsToSelectedDay) return null
    const liveType = liveSession.sessionType || 'focus'
    const hit = rows?.find((b) => b.type === liveType && liveNow >= b.startMs && liveNow < b.graceEndMs)
    return hit?.id ?? null
  })()

  // Today's actual-time totals, folding in:
  //  - any locally-saved-but-not-yet-synced session for today
  //    (pendingCompleted) -- the same race fix as daySessionsWithLive
  //    above, applied here too so the week graph's bar and the insight
  //    line don't lag a beat behind the block list right after Save, and
  //  - the live/stopped-pending session, if there is one
  // Both are attributed to todayId specifically (not selectedDateId) --
  // the week graph always shows all 7 days at once, and "today's" bar
  // is always the one that should reflect what's currently in progress,
  // regardless of which day's block list happens to be open below.
  const weekTotalsWithLive = useMemo(() => {
    const pendingForToday = pendingCompleted.filter((s) => dayId(new Date(s.startedAt)) === todayId)
    let totals = weekTotals
    if (pendingForToday.length > 0) {
      const base = totals[todayId] || { focusSec: 0, semiSec: 0 }
      const withPending = pendingForToday.reduce((acc, s) => {
        const key = s.sessionType === 'semiFocus' ? 'semiSec' : 'focusSec'
        return { ...acc, [key]: acc[key] + s.durationSeconds }
      }, base)
      totals = { ...totals, [todayId]: withPending }
    }
    if (!liveBelongsToToday || liveDurationSec <= 0) return totals
    const key = liveSession.sessionType === 'semiFocus' ? 'semiSec' : 'focusSec'
    const base = totals[todayId] || { focusSec: 0, semiSec: 0 }
    return { ...totals, [todayId]: { ...base, [key]: base[key] + liveDurationSec } }
  }, [weekTotals, pendingCompleted, todayId, liveBelongsToToday, liveSession, liveDurationSec])

  const dayTotals = useMemo(() => {
    const actual = weekTotalsWithLive[selectedDateId]
    if (!actual || !blocks) return null
    const plannedSec = blocks.reduce((sum, b) => sum + Math.max(0, (b.endMs - b.startMs) / 1000), 0)
    return { actualSec: actual.focusSec + actual.semiSec, plannedSec }
  }, [weekTotalsWithLive, selectedDateId, blocks])
  const insightLine = scored ? summarize(scored.blocks, dayTotals) : null

  function goToWeek(offset) {
    setWeekOffset(offset)
    const newDateIds = weekDateIds(weekStart(offset))
    setSelectedDateId(offset === 0 ? todayId : newDateIds[0])
  }

  function openAdd() {
    setEditingId(null)
    setTitle('')
    setType('focus')
    // Default to right after the day's last block, if that still lands
    // on the same calendar day — saves retyping 09:00 every time when
    // you're adding a third or fourth block to an already-busy day.
    const lastEndMs = blocks && blocks.length > 0 ? Math.max(...blocks.map((b) => b.endMs)) : null
    const suggestedEndMs = lastEndMs != null ? lastEndMs + 60 * 60 * 1000 : null
    if (lastEndMs != null && dayId(new Date(suggestedEndMs)) === selectedDateId) {
      setStartTime(msToTimeStr(lastEndMs))
      setEndTime(msToTimeStr(suggestedEndMs))
    } else {
      setStartTime('09:00')
      setEndTime('10:00')
    }
    setFormError('')
    setAddOpen(true)
  }

  function openEdit(block) {
    setEditingId(block.id)
    setTitle(block.title)
    setType(block.type)
    setStartTime(msToTimeStr(block.startMs))
    setEndTime(msToTimeStr(block.endMs))
    setFormError('')
    setAddOpen(true)
  }

  async function handleSave() {
    if (busy) return
    if (!title.trim()) { setFormError('Enter a name for this block.'); return }
    const startMs = timeToMs(selectedDateId, startTime)
    const endMs = timeToMs(selectedDateId, endTime)
    if (endMs <= startMs) { setFormError('End time must be after the start time.'); return }
    const overlaps = (blocks || []).some((b) => b.id !== editingId && startMs < b.endMs && endMs > b.startMs)
    if (overlaps) { setFormError('This overlaps another block on this day.'); return }
    setBusy(true)
    try {
      if (editingId) {
        await updateScheduleBlock(user.uid, selectedDateId, editingId, { title: title.trim(), type, startMs, endMs })
      } else {
        await addScheduleBlock(user.uid, selectedDateId, { title: title.trim(), type, startMs, endMs })
      }
      setAddOpen(false)
    } catch {
      setFormError("Couldn't save that — check your connection and try again.")
    } finally {
      setBusy(false)
    }
  }

  const previousDateId = addDays(selectedDateId, -1)

  function handleDeleteRequest(blockId) {
    setDeleteTargetId(blockId)
    setDeleteError('')
  }

  async function handleConfirmDelete() {
    if (!deleteTargetId || deleteBusy) return
    setDeleteBusy(true)
    try {
      await deleteScheduleBlock(user.uid, selectedDateId, deleteTargetId)
      setDeleteTargetId(null)
    } catch {
      setDeleteError("Couldn't delete that — check your connection and try again.")
    } finally {
      setDeleteBusy(false)
    }
  }

  async function handleCopyPrevious() {
    if (copying) return
    setCopying(true)
    setCopyError('')
    setCopyNote('')
    try {
      const { copied, skipped } = await copyScheduleBlocks(user.uid, previousDateId, selectedDateId)
      if (copied === 0) setCopyError(`${weekdayName(previousDateId)} had nothing scheduled to copy.`)
      else if (skipped > 0) setCopyNote(`Copied ${copied} — skipped ${skipped} that would've overlapped.`)
    } catch {
      setCopyError("Couldn't copy — check your connection and try again.")
    } finally {
      setCopying(false)
    }
  }

  return (
    <div className="min-h-svh px-5 pt-[calc(env(safe-area-inset-top)+24px)] pb-32 max-w-md mx-auto md:max-w-2xl md:pt-16">
      <div className="flex items-center gap-2 mb-6">
        <h1 className="font-display text-2xl font-semibold">Schedule</h1>
        <button
          onClick={() => setHelpOpen(true)}
          aria-label="How scheduling works"
          className="text-text-faint hover:text-text-dim p-1 -m-1"
        >
          <QuestionIcon />
        </button>
      </div>

      <div className="flex items-center justify-between mb-3">
        <button onClick={() => goToWeek(weekOffset + 1)} aria-label="Previous week" className="text-text-faint hover:text-text p-1 -m-1">
          <ChevronLeft width="18" height="18" />
        </button>
        <div className="text-xs text-text-faint">{weekOffset === 0 ? 'This week' : weekInfo(weekOffset).label}</div>
        <button
          onClick={() => goToWeek(weekOffset - 1)}
          aria-label="Next week"
          className="text-text-faint hover:text-text p-1 -m-1"
        >
          <ChevronRight width="18" height="18" />
        </button>
      </div>

      <div className="flex gap-1.5 mb-6">
        {dateIds.map((id, i) => {
          const dayNum = Number(id.slice(-2))
          const isSelected = id === selectedDateId
          const isToday_ = id === todayId
          return (
            <button
              key={id}
              onClick={() => setSelectedDateId(id)}
              className={`flex-1 text-center py-2 rounded-lg ${isSelected ? 'bg-accent-soft' : ''}`}
            >
              <div className={`text-[11px] ${isSelected ? 'text-accent' : 'text-text-faint'}`}>{WEEKDAY_LABELS[i]}</div>
              <div className={`text-sm mt-0.5 ${isSelected ? 'text-accent font-medium' : 'text-text-dim'}`}>{dayNum}</div>
              {/* A quiet marker for "today" so it doesn't get lost once
                  you've tapped over to browse a different day. */}
              <div className={`w-1 h-1 rounded-full mx-auto mt-1 ${isToday_ ? 'bg-accent' : 'bg-transparent'}`} />
            </button>
          )
        })}
      </div>

      {scored && scored.adherencePct !== null && (
        <div className="mb-6">
          <div className="flex items-baseline gap-2">
            <div className="font-display text-4xl font-semibold">{scored.adherencePct}%</div>
            <div className="text-sm text-text-dim">{isToday ? "today, so far" : 'that day'}</div>
          </div>
          {insightLine && <p className="text-sm text-text-dim mt-1.5 leading-relaxed">{insightLine}</p>}
        </div>
      )}

      <div className="mb-6">
        <WeekGraph dateIds={dateIds} totals={weekTotalsWithLive} selectedDateId={selectedDateId} onSelect={setSelectedDateId} />
        <div className="flex gap-4 mt-2 text-xs text-text-dim">
          <span><span className="inline-block w-2 h-2 rounded-sm bg-accent mr-1" />Focus</span>
          <span><span className="inline-block w-2 h-2 rounded-sm bg-semi mr-1" />Semi-focus</span>
        </div>
      </div>

      <div className="flex flex-col gap-2.5 mb-4">
        {rows === undefined && <ScheduleListSkeleton />}
        {rows && rows.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="text-sm text-text-faint">
              {isFuture ? 'Nothing planned yet.' : 'No blocks were scheduled this day.'}
            </div>
            <button
              onClick={handleCopyPrevious}
              disabled={copying}
              className="flex items-center gap-1.5 text-sm font-medium text-accent disabled:opacity-60"
            >
              <CopyIcon width="14" height="14" />
              {copying ? 'Copying…' : `Copy ${weekdayName(previousDateId)}'s schedule`}
            </button>
            {copyError && <p className="text-xs text-danger">{copyError}</p>}
          </div>
        )}
        {rows?.map((block) => (
          <BlockRow
            key={block.id}
            block={block}
            isLive={block.id === liveBlockId}
            onEdit={openEdit}
            onDeleteRequest={handleDeleteRequest}
            onOpenInsights={(b) => setInsightsBlockId(b.id)}
          />
        ))}
        {/* Outside the empty-state block on purpose — a partial copy (some
            blocks skipped as overlaps) still populates rows immediately via
            the live subscription, and this note needs to survive that,
            not vanish the instant the empty-state disappears. */}
        {copyNote && <p className="text-xs text-text-faint text-center">{copyNote}</p>}
        {deleteError && <p className="text-xs text-danger">{deleteError}</p>}
      </div>

      <button
        onClick={openAdd}
        className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl border border-border text-sm font-medium text-text-dim hover:border-text-faint hover:text-text transition-colors"
      >
        <PlusIcon width="16" height="16" />
        Add schedule
      </button>

      <Sheet open={addOpen} onClose={() => setAddOpen(false)}>
        <div className="flex flex-col gap-4">
          <div className="text-[13px] tracking-[0.25em] text-text-faint text-center mb-1">
            {editingId ? 'EDIT SCHEDULE' : 'NEW SCHEDULE'}
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter name"
            maxLength={TITLE_MAX_LENGTH}
            className="bg-elevated border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-text-faint"
          />
          <SegmentedControl
            options={[
              { value: 'focus', label: 'Focus' },
              { value: 'semiFocus', label: 'Semi-focus' },
            ]}
            value={type}
            onChange={setType}
          />
          <div className="flex gap-3">
            <label className="flex-1 flex flex-col gap-1.5">
              <span className="text-xs text-text-faint">From</span>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="bg-elevated border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-text-faint"
              />
            </label>
            <label className="flex-1 flex flex-col gap-1.5">
              <span className="text-xs text-text-faint">To</span>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="bg-elevated border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-text-faint"
              />
            </label>
          </div>
          {formError && <p className="text-xs text-danger">{formError}</p>}
          <Button onClick={handleSave} disabled={busy}>Save</Button>
        </div>
      </Sheet>

      <Sheet open={!!deleteTargetId} onClose={() => setDeleteTargetId(null)}>
        <div className="flex flex-col items-center text-center">
          <div className="text-base font-medium mb-2">Delete this schedule block?</div>
          <p className="text-xs text-text-faint mb-8">This can't be undone.</p>
          <div className="w-full flex flex-col gap-2.5">
            <Button variant="ghost" className="w-full" onClick={handleConfirmDelete} disabled={deleteBusy}>
              Delete
            </Button>
            <Button variant="text" className="w-full" onClick={() => setDeleteTargetId(null)}>
              Cancel
            </Button>
          </div>
        </div>
      </Sheet>

      <Sheet open={helpOpen} onClose={() => setHelpOpen(false)}>
        <div className="flex flex-col gap-4 text-sm text-text-dim leading-relaxed">
          <div className="text-[13px] tracking-[0.25em] text-text-faint text-center mb-1">HOW SCHEDULING WORKS</div>

          <p>The % is how much of your planned time you actually studied — it only shows up once a block's end time has passed, and not at all if nothing was scheduled that day.</p>

          <ul className="flex flex-col gap-1.5">
            <li><span className="text-live font-medium">On time</span> — you studied the whole block.</li>
            <li><span className="text-warn font-medium">Short</span> — you studied part of it.</li>
            <li><span className="text-danger font-medium">Missed</span> — you studied none of it.</li>
          </ul>

          <div className="rounded-xl border border-border bg-elevated/50 px-3.5 py-3">
            <p className="text-text-faint text-xs mb-1.5 tracking-wide">EXAMPLE</p>
            <p>Block is 9–11 AM. You start at 9:15 → you lose those first 15 minutes, unless you also keep studying until 11:15 — going a bit over the end time is the one way to make up for a late start. Nothing else gets that same forgiveness (finishing early, starting early — those minutes are just gone).</p>
          </div>

          <p>Studying way past a block's time doesn't boost that block above 100%, and the extra doesn't carry over to help a different block.</p>

          <p>If one long session runs straight through two or three blocks back to back, each of those blocks still gets credited properly for its own slice — not just the first one.</p>
        </div>
      </Sheet>

      <SessionInsightsSheet
        block={insightsBlock}
        sessions={insightsSessions}
        onClose={() => setInsightsBlockId(null)}
      />
    </div>
  )
}
