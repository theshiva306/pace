import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { dayId } from '../lib/day'
import { weekStart } from '../lib/week'
import { formatDuration, formatMessageTime } from '../lib/format'
import {
  useScheduleBlocks, addScheduleBlock, deleteScheduleBlock, fetchSessionsForDay, fetchWeekActualTotals,
} from '../lib/schedule'
import { scoreDay, summarize } from '../lib/adherence'
import Sheet from '../components/Sheet'
import Button from '../components/Button'
import SegmentedControl from '../components/SegmentedControl'
import { PlusIcon, TrashIcon } from '../components/icons'

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function weekDateIds(anchorMonday) {
  return Array.from({ length: 7 }, (_, i) => dayId(new Date(anchorMonday.getTime() + i * 86400000)))
}

// "HH:MM" (native <input type="time">'s format) -> epoch ms on the given
// calendar day, local time.
function timeToMs(dateId, timeStr) {
  const [y, m, d] = dateId.split('-').map(Number)
  const [h, min] = timeStr.split(':').map(Number)
  return new Date(y, m - 1, d, h, min, 0, 0).getTime()
}

const STATUS_STYLE = {
  done: { label: 'On time', className: 'bg-live-soft text-live' },
  short: { label: null, className: 'bg-accent-soft text-accent' }, // label filled in per-block with the actual shortfall
  missed: { label: 'Missed', className: 'bg-danger-soft text-danger' },
}

function StatusBadge({ block }) {
  if (!block.status) return null
  const style = STATUS_STYLE[block.status]
  const label = block.status === 'short' ? `${formatDuration(block.shortfallSec)} short` : style.label
  return <span className={`text-xs px-2 py-1 rounded-md shrink-0 ${style.className}`}>{label}</span>
}

function BlockRow({ block, onDelete }) {
  const typeLabel = block.type === 'semiFocus' ? 'Semi-focus' : 'Focus'
  const borderClass = block.type === 'semiFocus' ? 'border-l-semi' : 'border-l-accent'
  return (
    <div className={`flex items-center gap-3 px-3.5 py-3 bg-surface border border-border rounded-xl border-l-[3px] ${borderClass}`}>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{block.title}</div>
        <div className="text-xs text-text-dim mt-0.5">
          {formatMessageTime(block.startMs)} - {formatMessageTime(block.endMs)} · {typeLabel}
        </div>
      </div>
      <StatusBadge block={block} />
      <button onClick={() => onDelete(block.id)} aria-label="Delete block" className="text-text-faint hover:text-danger p-1">
        <TrashIcon width="16" height="16" />
      </button>
    </div>
  )
}

function WeekGraph({ dateIds, totals, selectedDateId, onSelect }) {
  const maxSec = Math.max(60, ...dateIds.map((id) => (totals[id]?.focusSec || 0) + (totals[id]?.semiSec || 0)))
  return (
    <div>
      <div className="text-sm text-text-dim mb-2">This week</div>
      <div className="flex items-end gap-2 h-24 mb-1.5">
        {dateIds.map((id) => {
          const t = totals[id] || { focusSec: 0, semiSec: 0 }
          const focusPct = (t.focusSec / maxSec) * 100
          const semiPct = (t.semiSec / maxSec) * 100
          const isSelected = id === selectedDateId
          return (
            <button
              key={id}
              onClick={() => onSelect(id)}
              className={`flex-1 h-full flex flex-col justify-end rounded-t-sm ${isSelected ? 'ring-1 ring-accent ring-offset-1 ring-offset-bg' : ''}`}
            >
              <div style={{ height: `${semiPct}%` }} className="bg-semi rounded-t-sm min-h-0" />
              <div style={{ height: `${focusPct}%` }} className="bg-accent min-h-0" />
              {focusPct === 0 && semiPct === 0 && <div className="h-0.5 bg-border" />}
            </button>
          )
        })}
      </div>
      <div className="flex gap-2">
        {WEEKDAY_LABELS.map((label, i) => (
          <div key={label} className={`flex-1 text-center text-[11px] ${dateIds[i] === selectedDateId ? 'text-accent font-medium' : 'text-text-faint'}`}>
            {label}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Schedule() {
  const { user } = useAuth()
  const todayId = dayId(new Date())
  const [weekAnchor] = useState(() => weekStart(0))
  const dateIds = useMemo(() => weekDateIds(weekAnchor), [weekAnchor])
  const [selectedDateId, setSelectedDateId] = useState(todayId)

  const [weekTotals, setWeekTotals] = useState({})
  const [daySessions, setDaySessions] = useState(undefined)
  const [addOpen, setAddOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [type, setType] = useState('focus')
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('10:00')
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)

  const blocks = useScheduleBlocks(user.uid, selectedDateId)

  useEffect(() => {
    fetchWeekActualTotals(user.uid, dateIds).then(setWeekTotals).catch(() => {})
  }, [user.uid, dateIds])

  useEffect(() => {
    setDaySessions(undefined)
    fetchSessionsForDay(user.uid, selectedDateId).then(setDaySessions).catch(() => setDaySessions([]))
  }, [user.uid, selectedDateId])

  const isFuture = selectedDateId > todayId
  const isToday = selectedDateId === todayId

  const scored = useMemo(() => {
    if (isFuture || !blocks || !daySessions) return null
    return scoreDay(blocks, daySessions)
  }, [isFuture, blocks, daySessions])

  const rows = scored ? scored.blocks : blocks
  const insightLine = scored ? summarize(scored.blocks) : null

  function openAdd() {
    setTitle('')
    setType('focus')
    setStartTime('09:00')
    setEndTime('10:00')
    setFormError('')
    setAddOpen(true)
  }

  async function handleAdd() {
    if (busy) return
    if (!title.trim()) { setFormError('Enter a name for this block.'); return }
    const startMs = timeToMs(selectedDateId, startTime)
    const endMs = timeToMs(selectedDateId, endTime)
    if (endMs <= startMs) { setFormError('End time must be after the start time.'); return }
    setBusy(true)
    try {
      await addScheduleBlock(user.uid, selectedDateId, { title: title.trim(), type, startMs, endMs })
      setAddOpen(false)
    } catch {
      setFormError("Couldn't save that — check your connection and try again.")
    } finally {
      setBusy(false)
    }
  }

  function handleDelete(blockId) {
    deleteScheduleBlock(user.uid, selectedDateId, blockId).catch(() => {})
  }

  return (
    <div className="min-h-svh px-5 pt-[calc(env(safe-area-inset-top)+24px)] pb-32 max-w-md mx-auto md:max-w-2xl md:pt-16">
      <h1 className="font-display text-2xl font-semibold mb-6">Schedule</h1>

      <div className="flex gap-1.5 mb-6">
        {dateIds.map((id, i) => {
          const dayNum = Number(id.slice(-2))
          const isSelected = id === selectedDateId
          return (
            <button
              key={id}
              onClick={() => setSelectedDateId(id)}
              className={`flex-1 text-center py-2 rounded-lg ${isSelected ? 'bg-accent-soft' : ''}`}
            >
              <div className={`text-[11px] ${isSelected ? 'text-accent' : 'text-text-faint'}`}>{WEEKDAY_LABELS[i]}</div>
              <div className={`text-sm mt-0.5 ${isSelected ? 'text-accent font-medium' : 'text-text-dim'}`}>{dayNum}</div>
            </button>
          )
        })}
      </div>

      {scored && scored.adherencePct !== null && (
        <div className="mb-6">
          <div className="flex items-baseline gap-2">
            <div className="font-display text-4xl font-semibold">{scored.adherencePct}%</div>
            <div className="text-sm text-text-dim">{isToday ? 'on schedule so far' : 'on schedule that day'}</div>
          </div>
          {insightLine && <p className="text-sm text-text-dim mt-1.5 leading-relaxed">{insightLine}</p>}
        </div>
      )}

      <div className="mb-6">
        <WeekGraph dateIds={dateIds} totals={weekTotals} selectedDateId={selectedDateId} onSelect={setSelectedDateId} />
        <div className="flex gap-4 mt-2 text-xs text-text-dim">
          <span><span className="inline-block w-2 h-2 rounded-sm bg-accent mr-1" />Focus</span>
          <span><span className="inline-block w-2 h-2 rounded-sm bg-semi mr-1" />Semi-focus</span>
        </div>
      </div>

      <div className="flex flex-col gap-2.5 mb-4">
        {rows === undefined && <div className="text-sm text-text-faint py-4 text-center">Loading…</div>}
        {rows && rows.length === 0 && (
          <div className="text-sm text-text-faint py-6 text-center">
            {isFuture ? 'Nothing planned yet.' : 'No blocks were scheduled this day.'}
          </div>
        )}
        {rows?.map((block) => <BlockRow key={block.id} block={block} onDelete={handleDelete} />)}
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
          <div className="text-[13px] tracking-[0.25em] text-text-faint text-center mb-1">NEW SCHEDULE</div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter name"
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
          <Button onClick={handleAdd} disabled={busy}>Save</Button>
        </div>
      </Sheet>
    </div>
  )
}
