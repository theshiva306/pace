import { formatDuration, formatMessageTime } from '../../lib/format'
import { TrashIcon } from '../../components/icons'
import { STATUS_STYLE } from './statusStyle'

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

export default function BlockRow({ block, isLive, onEdit, onDeleteRequest, onOpenInsights }) {
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
