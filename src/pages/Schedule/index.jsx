import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { dayId, addDays } from '../../lib/day'
import { weekStart, weekInfo } from '../../lib/week'
import {
  useScheduleBlocks, addScheduleBlock, updateScheduleBlock, deleteScheduleBlock, copyScheduleBlocks,
  fetchSessionsForDay, fetchWeekActualTotals,
} from '../../lib/schedule'
import { scoreDay, summarize, sessionOverlapSec } from '../../lib/adherence'
import { useServerOffset } from '../../hooks/useServerOffset'
import { useActiveSession } from '../../hooks/useActiveSession'
import { useSessionClock } from '../../hooks/useSessionClock'
import { readPendingCompleted } from '../../lib/pendingCompleted'
import Sheet from '../../components/Sheet'
import Button from '../../components/Button'
import SegmentedControl from '../../components/SegmentedControl'
import { ScheduleListSkeleton } from '../../components/Skeleton'
import {
  PlusIcon, CopyIcon, QuestionIcon, ChevronLeft, ChevronRight,
} from '../../components/icons'
import { WEEKDAY_LABELS, weekdayName, weekDateIds, timeToMs, msToTimeStr } from './dateUtils'
import BlockRow from './BlockRow'
import WeekGraph from './WeekGraph'
import SessionInsightsSheet from './SessionInsightsSheet'

const TITLE_MAX_LENGTH = 60

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

  // Real "now" for live-session math -- recomputed fresh every render
  // (this component already re-renders every second while a live
  // session exists, via useSessionClock's own internal tick). Needed up
  // here (not just for the Live-badge lookup further below) because the
  // merged live session entry below needs it to build its own endedAt.
  const liveNow = Date.now() + serverOffset

  // Today's fetched (completed) sessions, plus:
  //  - any locally-saved-but-not-yet-synced session for this day
  //    (pendingCompleted, filtered to this day and deduped against
  //    daySessions by startedAt in case a record is fetched from
  //    Firebase in the same beat it'd otherwise flush and get removed
  //    from the local queue), and
  //  - the live/stopped-pending one, if there is one for this day
  // — so scoring, the insights sheet, and totals all reflect what's
  // actually happened, not just what's already confirmed synced.
  //
  // Kept in full detail (id, endedAt, pauseLog) rather than a separate
  // lean shape for scoring vs. a separate detailed one for the insights
  // sheet — this used to be two nearly-identical copies of the same
  // merge, which is exactly how a real bug went unnoticed: the live
  // entry's endedAt/realEnd was being derived two different ways in two
  // different places. One of those ways used a plain "is this session
  // stopped yet?" flag to decide whether to treat its end as "right
  // now" — which is wrong for a session that's currently paused or on a
  // break (not stopped, but also not actively accruing studied time
  // right now): it would count from the moment it paused all the way to
  // "now" as if you were still studying through the pause. endedAt
  // below is computed once, correctly, for whichever state the live
  // session is actually in — active, paused/on a break, or sitting
  // stopped-but-unsaved on the Save screen — and lib/adherence.js's own
  // studiedIntervals now trusts endedAt alone rather than guessing from
  // a separate "still live" flag.
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
    // Actively studying right now -> the live, ticking clock. Paused or
    // on a break -> frozen at the exact moment it paused, since nothing
    // is accruing until it's resumed. Sitting stopped-but-unsaved on the
    // Save screen -> the real stop moment, not whenever Save eventually
    // gets tapped.
    const liveEndedAt = liveSession.status === 'stopped'
      ? liveSession.stoppedAt
      : liveSession.status === 'active'
        ? liveNow
        : liveSession.pausedAt
    return [
      ...merged,
      {
        id: liveSession.sessionId,
        sessionType: liveSession.sessionType || 'focus',
        startedAt: liveSession.startedAt,
        durationSeconds: liveDurationSec,
        endedAt: liveEndedAt,
        pauseLog: liveSession.pauseLog,
        // Display-only from here on (the insights sheet's "→ now" label)
        // -- the scoring math above no longer branches on this; endedAt
        // is already the single correct value for whatever state the
        // session is actually in.
        stillLive: liveSession.status !== 'stopped',
      },
    ]
  }, [daySessions, pendingCompleted, selectedDateId, liveBelongsToSelectedDay, liveSession, liveDurationSec, liveNow])

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
    if (!insightsBlock || !daySessionsWithLive) return []
    return daySessionsWithLive
      .filter((s) => s.sessionType === insightsBlock.type)
      // Same fragment-aware overlap scoreDay uses, so a session never
      // gets silently dropped from (or wrongly added to) this list based
      // on a naive "compressed" overlap that disagrees with what the
      // badge above actually credited it for.
      .map((s) => ({ ...s, overlapSec: sessionOverlapSec(s, insightsBlock) }))
      .filter((s) => s.overlapSec > 0)
      .sort((a, b) => a.startedAt - b.startedAt)
  }, [insightsBlock, daySessionsWithLive])

  // Which block (if any) counts as "Live" right now — a session of the
  // matching type is actually running (not paused/on-break is fine, not
  // stopped) and the current moment falls inside that block's own window
  // through its grace period. Gated on liveBelongsToSelectedDay (not
  // "isToday") for the same midnight reason as above — this needs to
  // keep working for a late-night block on selectedDateId even in the
  // few minutes right after the calendar rolls over to a new day.
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
