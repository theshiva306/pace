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
import Sheet from '../components/Sheet'
import Button from '../components/Button'
import SegmentedControl from '../components/SegmentedControl'
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

function StatusBadge({ block }) {
  if (!block.status || block.status === 'upcoming') return null
  const style = STATUS_STYLE[block.status]
  const label = block.status === 'short' ? `${formatDuration(block.shortfallSec)} short` : style.label
  return <span className={`text-xs px-2 py-1 rounded-md shrink-0 ${style.className}`}>{label}</span>
}

function BlockRow({ block, onEdit, onDeleteRequest }) {
  const typeLabel = block.type === 'semiFocus' ? 'Semi-focus' : 'Focus'
  const borderClass = block.type === 'semiFocus' ? 'border-l-semi' : 'border-l-accent'
  return (
    <div className={`flex items-center gap-3 px-3.5 py-3 bg-surface border border-border rounded-xl border-l-[3px] ${borderClass}`}>
      <button onClick={() => onEdit(block)} className="flex-1 min-w-0 text-left">
        <div className="text-sm font-medium truncate">{block.title}</div>
        <div className="text-xs text-text-dim mt-0.5">
          {formatMessageTime(block.startMs)} - {formatMessageTime(block.endMs)} · {typeLabel}
        </div>
      </button>
      <StatusBadge block={block} />
      <button onClick={() => onDeleteRequest(block.id)} aria-label="Delete block" className="text-text-faint hover:text-danger p-1">
        <TrashIcon width="16" height="16" />
      </button>
    </div>
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
  const liveBelongsToToday = liveSession && dayId(new Date(liveSession.startedAt)) === todayId
  const liveDurationSec = liveSession?.status === 'stopped'
    ? Math.round(liveSession.finalDurationSeconds ?? 0)
    : Math.round(liveClock.focusElapsed)

  const blocks = useScheduleBlocks(user.uid, selectedDateId)

  useEffect(() => {
    fetchWeekActualTotals(user.uid, dateIds).then(setWeekTotals).catch(() => {})
  }, [user.uid, dateIds])

  useEffect(() => {
    setDaySessions(undefined)
    setCopyNote('')
    fetchSessionsForDay(user.uid, selectedDateId).then(setDaySessions).catch(() => setDaySessions([]))
    // Re-fetch whenever the live session's own identity changes (one
    // starts, stops, or a different one begins) — not just on day/user
    // change. Otherwise, finally tapping "Save" on a session that was
    // sitting in limbo wouldn't show up here until the page is
    // revisited: the merge below stops including it the moment it's no
    // longer "live," but this fetch wouldn't yet know it just became a
    // real completed session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.uid, selectedDateId, liveSession?.sessionId ?? null])

  const isFuture = selectedDateId > todayId
  const isToday = selectedDateId === todayId

  // Today's fetched (completed) sessions, plus the live/stopped-pending
  // one if there is one — so scoring and totals both reflect what's
  // actually happening, not just what's already been saved.
  const daySessionsWithLive = useMemo(() => {
    if (!daySessions) return daySessions
    if (!isToday || !liveBelongsToToday || liveDurationSec <= 0) return daySessions
    return [
      ...daySessions,
      { sessionType: liveSession.sessionType || 'focus', startedAt: liveSession.startedAt, durationSeconds: liveDurationSec },
    ]
  }, [daySessions, isToday, liveBelongsToToday, liveSession, liveDurationSec])

  const scored = useMemo(() => {
    if (isFuture || !blocks || !daySessionsWithLive) return null
    // Only today needs an actual cutoff — a block later this evening
    // hasn't happened yet and shouldn't be judged as missed. Past days
    // are scored as fully settled regardless (scoreDay's default of
    // Infinity does that on its own), so this only branches for today.
    const now = isToday ? Date.now() + serverOffset : Infinity
    return scoreDay(blocks, daySessionsWithLive, now)
  }, [isFuture, isToday, blocks, daySessionsWithLive, serverOffset])

  const rows = scored ? scored.blocks : blocks

  // Today's actual-time totals, folding in the live/stopped-pending
  // session too — feeds both the week graph's bar for today and the
  // insight line below, so neither one looks "wrong" relative to a
  // session that's still running or awaiting Save.
  const weekTotalsWithLive = useMemo(() => {
    if (!liveBelongsToToday || liveDurationSec <= 0) return weekTotals
    const key = liveSession.sessionType === 'semiFocus' ? 'semiSec' : 'focusSec'
    const base = weekTotals[todayId] || { focusSec: 0, semiSec: 0 }
    return { ...weekTotals, [todayId]: { ...base, [key]: base[key] + liveDurationSec } }
  }, [weekTotals, liveBelongsToToday, liveSession, liveDurationSec, todayId])

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
        {rows === undefined && <div className="text-sm text-text-faint py-4 text-center">Loading…</div>}
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
        {rows?.map((block) => <BlockRow key={block.id} block={block} onEdit={openEdit} onDeleteRequest={handleDeleteRequest} />)}
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
        <div className="flex flex-col gap-3.5 text-sm text-text-dim leading-relaxed">
          <div className="text-[13px] tracking-[0.25em] text-text-faint text-center mb-1">HOW SCHEDULING WORKS</div>
          <ul className="list-disc pl-4 flex flex-col gap-2.5">
            <li>The % is credited time ÷ planned time, only for blocks whose end has passed — nothing scheduled means no % at all, not 0%.</li>
            <li><span className="text-live font-medium">On time</span> · <span className="text-warn font-medium">Short</span> · <span className="text-danger font-medium">Missed</span> — studied the full length, some of it, or none.</li>
            <li>Credit is exact clock overlap with the block — early or late by any amount loses that portion, except running up to 15 min past a block's end, which still counts. That's the only forgiveness, and it doesn't apply to a late start.</li>
            <li>One long session spanning several back-to-back blocks credits each block for its own slice.</li>
            <li>Studying more than planned still caps at 100% for that block — no rollover to another block.</li>
          </ul>
        </div>
      </Sheet>
    </div>
  )
}
