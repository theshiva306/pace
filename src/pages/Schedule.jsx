import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { dayId, addDays } from '../lib/day'
import { weekStart, weekInfo } from '../lib/week'
import { formatDuration, formatMessageTime } from '../lib/format'
import {
  useScheduleBlocks, addScheduleBlock, updateScheduleBlock, deleteScheduleBlock, copyScheduleBlocks,
  fetchSessionsForDay, fetchWeekActualTotals,
} from '../lib/schedule'
import { scoreDay, summarize } from '../lib/adherence'
import { useServerOffset } from '../hooks/useServerOffset'
import { useActiveSession } from '../hooks/useActiveSession'
import { useSessionClock } from '../hooks/useSessionClock'
import { readPendingCompleted } from '../lib/pendingCompleted'
import Sheet from '../components/Sheet'
import Button from '../components/Button'
import SegmentedControl from '../components/SegmentedControl'
import {
  PlusIcon, TrashIcon, CopyIcon, QuestionIcon, ChevronLeft, ChevronRight, ChevronDown, TimerIcon,
} from '../components/icons'

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const TITLE_MAX_LENGTH = 60

function weekdayName(dateId) {
  const [y, m, d] = dateId.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'long' })
}

function weekDateIds(anchorMonday) {
  const mondayId = dayId(anchorMonday)
  return Array.from({ length: 7 }, (_, i) => addDays(mondayId, i))
}

function timeToMs(dateId, timeStr) {
  const [y, m, d] = dateId.split('-').map(Number)
  const [h, min] = timeStr.split(':').map(Number)
  return new Date(y, m - 1, d, h, min, 0, 0).getTime()
}

function msToTimeStr(ms) {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const STATUS_STYLE = {
  done: { label: 'On time', className: 'bg-live-soft text-live' },
  short: { label: null, className: 'bg-warn-soft text-warn' },
  missed: { label: 'Missed', className: 'bg-danger-soft text-danger' },
}

function StatusBadge({ block, isLive, onOpenInsights }) {
  if (isLive) {
    return (
      <button onClick={onOpenInsights} className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md shrink-0 bg-live-soft text-live">
        <span className="w-1.5 h-1.5 rounded-full bg-live animate-pulse-soft" aria-hidden />
        Live
      </button>
    )
  }
  if (!block.status || block.status === 'upcoming') return null
  const style = STATUS_STYLE[block.status]
  const label = block.status === 'short'
    ? (block.shortfallSec < 60 ? '<1m short' : `${formatDuration(block.shortfallSec)} short`)
    : style.label
  return <button onClick={onOpenInsights} className={`text-xs px-2 py-1 rounded-md shrink-0 ${style.className}`}>{label}</button>
}

function BlockRow({ block, isLive, onEdit, onDeleteRequest, onOpenInsights }) {
  const typeLabel = block.type === 'semiFocus' ? 'Semi-focus' : 'Focus'
  const borderClass = block.type === 'semiFocus' ? 'border-l-semi' : 'border-l-accent'
  const isFinished = block.status === 'done' || block.status === 'short' || block.status === 'missed'
  return (
    <div className={`flex items-center gap-3 px-3.5 py-3 bg-surface border border-border rounded-xl border-l-[3px] ${borderClass}`}>
      <button onClick={() => (isFinished ? onOpenInsights(block) : onEdit(block))} className="flex-1 min-w-0 text-left">
        <div className="text-sm font-medium truncate">{block.title}</div>
        <div className="text-xs text-text-dim mt-0.5">{formatMessageTime(block.startMs)} - {formatMessageTime(block.endMs)} · {typeLabel}</div>
      </button>
      <StatusBadge block={block} isLive={isLive} onOpenInsights={() => onOpenInsights(block)} />
      {!isFinished && <button onClick={() => onDeleteRequest(block.id)} aria-label="Delete block" className="text-text-faint hover:text-danger p-1"><TrashIcon width="16" height="16" /></button>}
    </div>
  )
}

function PauseDetailLine({ session }) {
  const rangeSec = session.endedAt && !session.stillLive
    ? (session.endedAt - session.startedAt) / 1000 - session.durationSeconds
    : null
  if (session.pauseLog === undefined) {
    return <div className="text-xs text-text-faint mt-1.5">{rangeSec !== null && rangeSec > 30 ? `~${formatDuration(rangeSec)} paused (exact pause times weren't tracked for sessions saved before this update)` : "Pause detail wasn't tracked for this session"}</div>
  }
  if (session.pauseLog.length === 0) return <div className="text-xs text-text-faint mt-1.5">No pauses</div>
  return (
    <div className="mt-1.5 flex flex-col gap-0.5">
      {session.pauseLog.map((p, i) => <div key={i} className="text-xs text-text-faint">{p.type === 'break' ? 'Break' : 'Paused'} {formatMessageTime(p.start)} – {formatMessageTime(p.end)} ({formatDuration((p.end - p.start) / 1000)})</div>)}
    </div>
  )
}

function sessionPauseSec(session) {
  return (session.pauseLog || []).reduce((sum, p) => sum + Math.max(0, (p.end - p.start) / 1000), 0)
}

function actualSessionEndMs(session) {
  if (session.endedAt && !session.stillLive) return session.endedAt
  return session.startedAt + (session.durationSeconds + sessionPauseSec(session)) * 1000
}

function formatShortDuration(sec) {
  if (sec < 60) return '<1m'
  return formatDuration(sec)
}

function TimelineSegment({ type, seconds, total }) {
  if (seconds <= 0 || total <= 0) return null
  return <div title={`${formatShortDuration(seconds)}`} className={`h-full ${type} shrink-0`} style={{ width: `${(seconds / total) * 100}%` }} />
}

function SessionInsightsSheet({ block, sessions, onClose }) {
  const [detailsOpen, setDetailsOpen] = useState(true)
  const plannedSec = Math.max(0, (block?.endMs - block?.startMs) / 1000)
  const graceSec = block ? Math.max(0, (block.graceEndMs - block.endMs) / 1000) : 0
  const totalTimelineSec = plannedSec + graceSec

  const timeline = useMemo(() => {
    if (!block) return { segments: [], studiedSec: 0, pausedSec: 0, gapSec: 0, graceStudiedSec: 0, unusedGraceSec: graceSec }
    const start = block.startMs
    const plannedEnd = block.endMs
    const graceEnd = block.graceEndMs
    const events = []
    const inWindow = sessions.map((s) => {
      const wallEnd = Math.min(graceEnd, actualSessionEndMs(s))
      const wallStart = Math.max(start, s.startedAt)
      const pauses = (s.pauseLog || []).map((p) => ({ start: Math.max(start, p.start), end: Math.min(graceEnd, p.end) })).filter((p) => p.end > p.start)
      return { ...s, wallStart, wallEnd, pauses }
    }).filter((s) => s.wallEnd > s.wallStart)

    inWindow.forEach((s) => {
      let cursor = s.wallStart
      const pauses = [...s.pauses].sort((a, b) => a.start - b.start)
      for (const p of pauses) {
        const ps = Math.max(cursor, p.start)
        if (ps > cursor) events.push({ start: cursor, end: ps, type: ps < plannedEnd ? 'studied' : 'graceStudied' })
        if (p.end > ps) events.push({ start: ps, end: p.end, type: 'paused' })
        cursor = Math.max(cursor, p.end)
      }
      if (cursor < s.wallEnd) events.push({ start: cursor, end: s.wallEnd, type: cursor < plannedEnd ? 'studied' : 'graceStudied' })
    })

    const normalized = []
    let cursor = start
    const ordered = events.sort((a, b) => a.start - b.start || a.end - b.end)
    for (const e of ordered) {
      if (e.start > cursor) normalized.push({ start: cursor, end: e.start, type: cursor < plannedEnd ? 'gap' : 'unusedGrace' })
      const s = Math.max(cursor, e.start)
      if (e.end > s) normalized.push({ start: s, end: e.end, type: e.type })
      cursor = Math.max(cursor, e.end)
    }
    if (cursor < graceEnd) normalized.push({ start: cursor, end: graceEnd, type: cursor < plannedEnd ? 'gap' : 'unusedGrace' })

    const merged = []
    for (const seg of normalized) {
      if (seg.end <= seg.start) continue
      const prev = merged[merged.length - 1]
      if (prev && prev.type === seg.type && prev.end === seg.start) prev.end = seg.end
      else merged.push(seg)
    }
    const totals = merged.reduce((a, s) => { a[s.type] += (s.end - s.start) / 1000; return a }, { studied: 0, paused: 0, gap: 0, graceStudied: 0, unusedGrace: 0 })
    return { segments: merged, studiedSec: totals.studied, pausedSec: totals.paused, gapSec: totals.gap, graceStudiedSec: totals.graceStudied, unusedGraceSec: totals.unusedGrace }
  }, [block, sessions, graceSec])

  const statusStyle = block?.status ? STATUS_STYLE[block.status] : null
  const totalStudiedSec = timeline.studiedSec + timeline.graceStudiedSec
  const statusLabel = block?.status === 'short'
    ? `${formatShortDuration(block.shortfallSec)} short`
    : block?.status === 'done'
      ? 'On time'
      : block?.status === 'missed'
        ? 'Missed'
        : null
  const actualStart = timeline.segments.find((s) => s.type === 'studied' || s.type === 'graceStudied')?.start
  const actualEnd = [...timeline.segments].reverse().find((s) => s.type === 'studied' || s.type === 'graceStudied')?.end
  const firstStudy = actualStart ? formatMessageTime(actualStart) : null
  const lastStudy = actualEnd ? formatMessageTime(actualEnd) : null
  const graceUsedSec = timeline.graceStudiedSec

  const ticks = useMemo(() => {
    if (!block) return []
    const points = [0, 0.25, 0.5, 0.75, plannedSec, plannedSec + graceSec]
    const unique = [...new Set(points.map((p) => Math.max(0, Math.min(totalTimelineSec, p))))]
    return unique.map((offset) => ({ offset, label: formatMessageTime(block.startMs + offset * 1000) }))
  }, [block, plannedSec, graceSec, totalTimelineSec])

  const summary = firstStudy
    ? `You studied from ${firstStudy} to ${lastStudy}, with ${formatDuration(totalStudiedSec)} of active study.`
    : 'No study time overlapped this planned block.'
  const context = totalStudiedSec > 0
    ? `${timeline.pausedSec > 0 ? `${formatDuration(timeline.pausedSec)} paused and ` : ''}${timeline.gapSec > 0 ? `${formatDuration(timeline.gapSec)} unstudied inside the window${graceUsedSec > 0 ? ', then ' : ''}` : ''}${graceUsedSec > 0 ? `${formatDuration(graceUsedSec)} continued into grace.` : 'The planned window contains the recorded study time.'}`
    : 'There was no recorded study overlap for this block.'

  return (
    <Sheet open={!!block} onClose={onClose}>
      {block && (
        <div className="flex flex-col">
          <div className="flex items-start justify-between gap-3 pr-8">
            <div className="min-w-0">
              <h2 className="text-xl font-display font-semibold truncate">{block.title}</h2>
              <div className="flex items-center gap-1.5 text-xs text-text-dim mt-1.5">
                <TimerIcon width="15" height="15" />
                {formatMessageTime(block.startMs)} – {formatMessageTime(block.endMs)}
              </div>
            </div>
            {statusStyle && <span className={`text-xs px-2 py-1 rounded-md shrink-0 ${statusStyle.className}`}>{statusLabel}</span>}
          </div>

          <div className="mt-6">
            <div className="flex items-center justify-between text-[11px] text-text-faint mb-1.5">
              <span>Planned · {formatDuration(plannedSec)}</span>
              {graceSec > 0 && <span>Grace · {formatDuration(graceSec)} <span className="inline-block rotate-0"><ChevronDown width="12" height="12" /></span></span>}
            </div>
            <div className="h-7 flex overflow-hidden rounded-lg border border-border bg-elevated">
              {timeline.segments.map((s, i) => <TimelineSegment key={`${s.start}-${s.end}-${i}`} type={s.type === 'graceStudied' ? 'bg-accent' : s.type === 'studied' ? 'bg-live' : s.type === 'paused' ? 'bg-warn' : s.type === 'gap' ? 'bg-text-faint' : 'bg-border'} seconds={(s.end - s.start) / 1000} total={totalTimelineSec} />)}
            </div>
            <div className="relative h-5 mt-1 text-[10px] text-text-faint">
              {ticks.map((tick, i) => <span key={i} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${(tick.offset / totalTimelineSec) * 100}%` }}>{tick.label}</span>)}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3">
              {[
                ['bg-live', 'Studied', timeline.studiedSec],
                ['bg-warn', 'Paused', timeline.pausedSec],
                ['bg-text-faint', 'Unstudied', timeline.gapSec],
                ['bg-accent', 'In grace', timeline.graceStudiedSec],
              ].filter(([, , sec]) => sec > 0).map(([color, label, sec]) => (
                <div key={label} className="flex items-center gap-1.5 text-[11px] text-text-dim"><span className={`w-2 h-2 rounded-sm ${color}`} />{label} <span className="text-text">{formatDuration(sec)}</span></div>
              ))}
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-border bg-elevated/50 px-3.5 py-3 flex gap-2.5">
            <div className="w-6 h-6 rounded-md bg-accent-soft text-accent flex items-center justify-center shrink-0 text-xs">✦</div>
            <p className="text-xs text-text-dim leading-relaxed m-0"><span className="text-text font-medium">{summary}</span> {context}</p>
          </div>

          <div className="mt-6">
            <button onClick={() => setDetailsOpen((v) => !v)} className="w-full flex items-center justify-between text-left py-1">
              <span className="font-display text-sm font-semibold">Session Details</span>
              <span className={`text-text-faint transition-transform ${detailsOpen ? '' : '-rotate-90'}`}><ChevronDown /></span>
            </button>
            {detailsOpen && (
              <div className="mt-2 border-t border-border">
                <div className="flex items-center justify-between gap-4 py-3 border-b border-border">
                  <span className="text-xs text-text-dim">Planned window</span>
                  <span className="text-xs text-right">{formatMessageTime(block.startMs)} – {formatMessageTime(block.endMs)}<span className="block text-text-faint mt-0.5">{formatDuration(plannedSec)}</span></span>
                </div>
                <div className="flex items-center justify-between gap-4 py-3 border-b border-border">
                  <span className="text-xs text-text-dim">Grace window</span>
                  <span className="text-xs text-right">{formatMessageTime(block.endMs)} – {formatMessageTime(block.graceEndMs)}<span className="block text-text-faint mt-0.5">{formatDuration(graceSec)}</span></span>
                </div>
                <div className="flex items-center justify-between gap-4 py-3 border-b border-border">
                  <span className="text-xs text-text-dim">Actual study time</span>
                  <span className="text-xs text-right">{formatDuration(totalStudiedSec)}<span className="block text-text-faint mt-0.5">vs {formatDuration(plannedSec)} planned</span></span>
                </div>
                <div className="flex items-center justify-between gap-4 py-3 border-b border-border">
                  <span className="text-xs text-text-dim">Pause time</span>
                  <span className="text-xs">{formatDuration(timeline.pausedSec)}</span>
                </div>
                <div className="flex items-center justify-between gap-4 py-3">
                  <span className="text-xs text-text-dim">Details</span>
                  <span className="text-xs text-text-faint text-right max-w-[65%]">{graceUsedSec > 0 ? `${formatDuration(graceUsedSec)} of study continued into the grace window.` : timeline.gapSec > 0 ? `${formatDuration(timeline.gapSec)} of unstudied time remained inside the planned window.` : 'The recorded study time stayed within the planned window.'}</span>
                </div>
              </div>
            )}
          </div>

          {sessions.length > 0 && <div className="mt-4"><div className="text-[11px] text-text-faint mb-2">Recorded sessions</div><div className="flex flex-col gap-2">{sessions.map((s) => <div key={s.id ?? s.startedAt} className="px-3 py-2.5 bg-elevated rounded-lg text-xs"><div className="flex items-center justify-between"><span>{formatMessageTime(Math.max(block.startMs, s.startedAt))} – {s.stillLive ? 'now' : formatMessageTime(Math.min(block.graceEndMs, actualSessionEndMs(s)))}</span><span className="text-text-dim">{formatDuration(s.overlapSec)}</span></div><PauseDetailLine session={s} /></div>)}</div></div>}
        </div>
      )}
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
            <button key={id} onClick={() => onSelect(id)} className="flex-1 h-full flex flex-col items-stretch justify-end gap-1">
              <span className={`text-[10px] leading-none text-center ${isSelected ? 'text-accent font-medium' : 'text-text-faint'}`}>{totalSec > 0 ? formatDuration(totalSec) : ''}</span>
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
        {WEEKDAY_LABELS.map((label, i) => <div key={label} className={`flex-1 text-center text-[11px] ${dateIds[i] === selectedDateId ? 'text-accent font-medium' : 'text-text-faint'}`}>{label}</div>)}
      </div>
      <div className="text-xs text-text-dim">
        {selectedTotalSec > 0 ? <><span className="text-accent font-medium">{formatDuration(selected.focusSec)}</span> focus{selected.semiSec > 0 && <> · <span className="text-semi font-medium">{formatDuration(selected.semiSec)}</span> semi-focus</>} · <span className="text-text font-medium">{formatDuration(selectedTotalSec)}</span> combined</> : 'No study time this day.'}
      </div>
    </div>
  )
}

export default function Schedule() {
  const { user } = useAuth()
  const todayId = dayId(new Date())
  const [weekOffset, setWeekOffset] = useState(0)
  const weekAnchor = useMemo(() => weekStart(weekOffset), [weekOffset])
  const dateIds = useMemo(() => weekDateIds(weekAnchor), [weekAnchor])
  const [selectedDateId, setSelectedDateId] = useState(todayId)
  const [weekTotals, setWeekTotals] = useState({})
  const [daySessions, setDaySessions] = useState(undefined)
  const [addOpen, setAddOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
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
  const liveSession = useActiveSession()
  const liveClock = useSessionClock(liveSession)
  const liveBelongsToSelectedDay = liveSession && dayId(new Date(liveSession.startedAt)) === selectedDateId
  const liveBelongsToToday = liveSession && dayId(new Date(liveSession.startedAt)) === todayId
  const liveDurationSec = liveSession?.status === 'stopped' ? Math.round(liveSession.finalDurationSeconds ?? 0) : Math.round(liveClock.focusElapsed)
  const blocks = useScheduleBlocks(user.uid, selectedDateId)
  const pendingCompleted = useMemo(() => readPendingCompleted(user.uid).map((r) => ({ id: r.sessionId, sessionType: r.data.sessionType || 'focus', startedAt: r.data.startedAt, durationSeconds: r.data.durationSeconds, endedAt: r.data.endedAt, pauseLog: r.data.pauseLog })), [user.uid, liveSession?.sessionId ?? null])

  useEffect(() => { fetchWeekActualTotals(user.uid, dateIds).then(setWeekTotals).catch(() => {}) }, [user.uid, dateIds])
  useEffect(() => {
    setDaySessions(undefined)
    setCopyNote('')
    fetchSessionsForDay(user.uid, selectedDateId).then(setDaySessions).catch(() => setDaySessions([]))
  }, [user.uid, selectedDateId, liveSession?.sessionId ?? null])

  const isFuture = selectedDateId > todayId
  const isToday = selectedDateId === todayId
  const daySessionsWithLive = useMemo(() => {
    if (!daySessions) return daySessions
    const knownStarts = new Set(daySessions.map((s) => s.startedAt))
    const pendingForDay = pendingCompleted.filter((s) => !knownStarts.has(s.startedAt) && dayId(new Date(s.startedAt)) === selectedDateId)
    const merged = pendingForDay.length > 0 ? [...daySessions, ...pendingForDay] : daySessions
    if (!liveBelongsToSelectedDay || liveDurationSec <= 0) return merged
    return [...merged, { sessionType: liveSession.sessionType || 'focus', startedAt: liveSession.startedAt, durationSeconds: liveDurationSec }]
  }, [daySessions, pendingCompleted, selectedDateId, liveBelongsToSelectedDay, liveSession, liveDurationSec])

  const daySessionsDetailed = useMemo(() => {
    if (!daySessions) return daySessions
    const knownStarts = new Set(daySessions.map((s) => s.startedAt))
    const pendingForDay = pendingCompleted.filter((s) => !knownStarts.has(s.startedAt) && dayId(new Date(s.startedAt)) === selectedDateId)
    const merged = pendingForDay.length > 0 ? [...daySessions, ...pendingForDay] : daySessions
    if (!liveBelongsToSelectedDay || liveDurationSec <= 0) return merged
    return [...merged, { id: liveSession.sessionId, sessionType: liveSession.sessionType || 'focus', startedAt: liveSession.startedAt, durationSeconds: liveDurationSec, endedAt: liveSession.status === 'stopped' ? liveSession.stoppedAt : null, pauseLog: liveSession.pauseLog, stillLive: liveSession.status !== 'stopped' }]
  }, [daySessions, pendingCompleted, selectedDateId, liveBelongsToSelectedDay, liveSession, liveDurationSec])

  const scored = useMemo(() => {
    if (isFuture || !blocks || !daySessionsWithLive) return null
    const now = isToday ? Date.now() + serverOffset : Infinity
    return scoreDay(blocks, daySessionsWithLive, now)
  }, [isFuture, isToday, blocks, daySessionsWithLive, serverOffset])
  const rows = scored ? scored.blocks : blocks
  const insightsBlock = insightsBlockId ? rows?.find((b) => b.id === insightsBlockId) ?? null : null
  const insightsSessions = useMemo(() => {
    if (!insightsBlock || !daySessionsDetailed) return []
    return daySessionsDetailed.filter((s) => s.sessionType === insightsBlock.type).map((s) => {
      const sessionEndMs = s.startedAt + s.durationSeconds * 1000
      const overlapMs = Math.min(insightsBlock.graceEndMs, sessionEndMs) - Math.max(insightsBlock.startMs, s.startedAt)
      return { ...s, sessionEndMs, overlapSec: Math.max(0, overlapMs) / 1000 }
    }).filter((s) => s.overlapSec > 0).sort((a, b) => a.startedAt - b.startedAt)
  }, [insightsBlock, daySessionsDetailed])
  const liveNow = Date.now() + serverOffset
  const liveBlockId = (() => {
    if (!liveSession || liveSession.status === 'stopped' || !liveBelongsToSelectedDay) return null
    const liveType = liveSession.sessionType || 'focus'
    const hit = rows?.find((b) => b.type === liveType && liveNow >= b.startMs && liveNow < b.graceEndMs)
    return hit?.id ?? null
  })()
  const weekTotalsWithLive = useMemo(() => {
    const pendingForToday = pendingCompleted.filter((s) => dayId(new Date(s.startedAt)) === todayId)
    let totals = weekTotals
    if (pendingForToday.length > 0) {
      const base = totals[todayId] || { focusSec: 0, semiSec: 0 }
      const withPending = pendingForToday.reduce((acc, s) => { const key = s.sessionType === 'semiFocus' ? 'semiSec' : 'focusSec'; return { ...acc, [key]: acc[key] + s.durationSeconds } }, base)
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
    setEditingId(null); setTitle(''); setType('focus')
    const lastEndMs = blocks && blocks.length > 0 ? Math.max(...blocks.map((b) => b.endMs)) : null
    const suggestedEndMs = lastEndMs != null ? lastEndMs + 60 * 60 * 1000 : null
    if (lastEndMs != null && dayId(new Date(suggestedEndMs)) === selectedDateId) { setStartTime(msToTimeStr(lastEndMs)); setEndTime(msToTimeStr(suggestedEndMs)) } else { setStartTime('09:00'); setEndTime('10:00') }
    setFormError(''); setAddOpen(true)
  }
  function openEdit(block) { setEditingId(block.id); setTitle(block.title); setType(block.type); setStartTime(msToTimeStr(block.startMs)); setEndTime(msToTimeStr(block.endMs)); setFormError(''); setAddOpen(true) }
  async function handleSave() {
    if (busy) return
    if (!title.trim()) { setFormError('Enter a name for this block.'); return }
    const startMs = timeToMs(selectedDateId, startTime); const endMs = timeToMs(selectedDateId, endTime)
    if (endMs <= startMs) { setFormError('End time must be after the start time.'); return }
    const overlaps = (blocks || []).some((b) => b.id !== editingId && startMs < b.endMs && endMs > b.startMs)
    if (overlaps) { setFormError('This overlaps another block on this day.'); return }
    setBusy(true)
    try { if (editingId) await updateScheduleBlock(user.uid, selectedDateId, editingId, { title: title.trim(), type, startMs, endMs }); else await addScheduleBlock(user.uid, selectedDateId, { title: title.trim(), type, startMs, endMs }); setAddOpen(false) }
    catch { setFormError("Couldn't save that — check your connection and try again.") }
    finally { setBusy(false) }
  }
  const previousDateId = addDays(selectedDateId, -1)
  function handleDeleteRequest(blockId) { setDeleteTargetId(blockId); setDeleteError('') }
  async function handleConfirmDelete() {
    if (!deleteTargetId || deleteBusy) return
    setDeleteBusy(true)
    try { await deleteScheduleBlock(user.uid, selectedDateId, deleteTargetId); setDeleteTargetId(null) }
    catch { setDeleteError("Couldn't delete that — check your connection and try again.") }
    finally { setDeleteBusy(false) }
  }
  async function handleCopyPrevious() {
    if (copying) return
    setCopying(true); setCopyError(''); setCopyNote('')
    try { const { copied, skipped } = await copyScheduleBlocks(user.uid, previousDateId, selectedDateId); if (copied === 0) setCopyError(`${weekdayName(previousDateId)} had nothing scheduled to copy.`); else if (skipped > 0) setCopyNote(`Copied ${copied} — skipped ${skipped} that would've overlapped.`) }
    catch { setCopyError("Couldn't copy — check your connection and try again.") }
    finally { setCopying(false) }
  }

  return (
    <div className="min-h-svh px-5 pt-[calc(env(safe-area-inset-top)+24px)] pb-32 max-w-md mx-auto md:max-w-2xl md:pt-16">
      <div className="flex items-center gap-2 mb-6"><h1 className="font-display text-2xl font-semibold">Schedule</h1><button onClick={() => setHelpOpen(true)} aria-label="How scheduling works" className="text-text-faint hover:text-text-dim p-1 -m-1"><QuestionIcon /></button></div>
      <div className="flex items-center justify-between mb-3"><button onClick={() => goToWeek(weekOffset + 1)} aria-label="Previous week" className="text-text-faint hover:text-text p-1 -m-1"><ChevronLeft width="18" height="18" /></button><div className="text-xs text-text-faint">{weekOffset === 0 ? 'This week' : weekInfo(weekOffset).label}</div><button onClick={() => goToWeek(weekOffset - 1)} aria-label="Next week" className="text-text-faint hover:text-text p-1 -m-1"><ChevronRight width="18" height="18" /></button></div>
      <div className="flex gap-1.5 mb-6">
        {dateIds.map((id, i) => { const dayNum = Number(id.slice(-2)); const isSelected = id === selectedDateId; const isToday_ = id === todayId; return <button key={id} onClick={() => setSelectedDateId(id)} className={`flex-1 text-center py-2 rounded-lg ${isSelected ? 'bg-accent-soft' : ''}`}><div className={`text-[11px] ${isSelected ? 'text-accent' : 'text-text-faint'}`}>{WEEKDAY_LABELS[i]}</div><div className={`text-sm mt-0.5 ${isSelected ? 'text-accent font-medium' : 'text-text-dim'}`}>{dayNum}</div><div className={`w-1 h-1 rounded-full mx-auto mt-1 ${isToday_ ? 'bg-accent' : 'bg-transparent'}`} /></button> })}
      </div>
      {scored && scored.adherencePct !== null && <div className="mb-6"><div className="flex items-baseline gap-2"><div className="font-display text-4xl font-semibold">{scored.adherencePct}%</div><div className="text-sm text-text-dim">{isToday ? 'today, so far' : 'that day'}</div></div>{insightLine && <p className="text-sm text-text-dim mt-1.5 leading-relaxed">{insightLine}</p>}</div>}
      <div className="mb-6"><WeekGraph dateIds={dateIds} totals={weekTotalsWithLive} selectedDateId={selectedDateId} onSelect={setSelectedDateId} /><div className="flex gap-4 mt-2 text-xs text-text-dim"><span><span className="inline-block w-2 h-2 rounded-sm bg-accent mr-1" />Focus</span><span><span className="inline-block w-2 h-2 rounded-sm bg-semi mr-1" />Semi-focus</span></div></div>
      <div className="flex flex-col gap-2.5 mb-4">
        {rows === undefined && <div className="text-sm text-text-faint py-4 text-center">Loading…</div>}
        {rows && rows.length === 0 && <div className="flex flex-col items-center gap-3 py-6 text-center"><div className="text-sm text-text-faint">{isFuture ? 'Nothing planned yet.' : 'No blocks were scheduled this day.'}</div><button onClick={handleCopyPrevious} disabled={copying} className="flex items-center gap-1.5 text-sm font-medium text-accent disabled:opacity-60"><CopyIcon width="14" height="14" />{copying ? 'Copying…' : `Copy ${weekdayName(previousDateId)}'s schedule`}</button>{copyError && <p className="text-xs text-danger">{copyError}</p>}</div>}
        {rows?.map((block) => <BlockRow key={block.id} block={block} isLive={block.id === liveBlockId} onEdit={openEdit} onDeleteRequest={handleDeleteRequest} onOpenInsights={(b) => setInsightsBlockId(b.id)} />)}
        {copyNote && <p className="text-xs text-text-faint text-center">{copyNote}</p>}
        {deleteError && <p className="text-xs text-danger">{deleteError}</p>}
      </div>
      <button onClick={openAdd} className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl border border-border text-sm font-medium text-text-dim hover:border-text-faint hover:text-text transition-colors"><PlusIcon width="16" height="16" />Add schedule</button>
      <Sheet open={addOpen} onClose={() => setAddOpen(false)}><div className="flex flex-col gap-4"><div className="text-[13px] tracking-[0.25em] text-text-faint text-center mb-1">{editingId ? 'EDIT SCHEDULE' : 'NEW SCHEDULE'}</div><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Enter name" maxLength={TITLE_MAX_LENGTH} className="bg-elevated border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-text-faint" /><SegmentedControl options={[{ value: 'focus', label: 'Focus' }, { value: 'semiFocus', label: 'Semi-focus' }]} value={type} onChange={setType} /><div className="flex gap-3"><label className="flex-1 flex flex-col gap-1.5"><span className="text-xs text-text-faint">From</span><input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="bg-elevated border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-text-faint" /></label><label className="flex-1 flex flex-col gap-1.5"><span className="text-xs text-text-faint">To</span><input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="bg-elevated border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-text-faint" /></label></div>{formError && <p className="text-xs text-danger">{formError}</p>}<Button onClick={handleSave} disabled={busy}>Save</Button></div></Sheet>
      <Sheet open={!!deleteTargetId} onClose={() => setDeleteTargetId(null)}><div className="flex flex-col items-center text-center"><div className="text-base font-medium mb-2">Delete this schedule block?</div><p className="text-xs text-text-faint mb-8">This can't be undone.</p><div className="w-full flex flex-col gap-2.5"><Button variant="ghost" className="w-full" onClick={handleConfirmDelete} disabled={deleteBusy}>Delete</Button><Button variant="text" className="w-full" onClick={() => setDeleteTargetId(null)}>Cancel</Button></div></div></Sheet>
      <Sheet open={helpOpen} onClose={() => setHelpOpen(false)}><div className="flex flex-col gap-4 text-sm text-text-dim leading-relaxed"><div className="text-[13px] tracking-[0.25em] text-text-faint text-center mb-1">HOW SCHEDULING WORKS</div><p>The % is how much of your planned time you actually studied — it only shows up once a block's end time has passed, and not at all if nothing was scheduled that day.</p><ul className="flex flex-col gap-1.5"><li><span className="text-live font-medium">On time</span> — you studied the whole block.</li><li><span className="text-warn font-medium">Short</span> — you studied part of it.</li><li><span className="text-danger font-medium">Missed</span> — you studied none of it.</li></ul><div className="rounded-xl border border-border bg-elevated/50 px-3.5 py-3"><p className="text-text-faint text-xs mb-1.5 tracking-wide">EXAMPLE</p><p>Block is 9–11 AM. You start at 9:15 → you lose those first 15 minutes, unless you also keep studying until 11:15 — going a bit over the end time is the one way to make up for a late start. Nothing else gets that same forgiveness (finishing early, starting early — those minutes are just gone).</p></div><p>Studying way past a block's time doesn't boost that block above 100%, and the extra doesn't carry over to help a different block.</p><p>If one long session runs straight through two or three blocks back to back, each of those blocks still gets credited properly for its own slice — not just the first one.</p></div></Sheet>
      <SessionInsightsSheet block={insightsBlock} sessions={insightsSessions} onClose={() => setInsightsBlockId(null)} />
    </div>
  )
}
