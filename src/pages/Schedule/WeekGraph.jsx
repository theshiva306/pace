import { formatDuration } from '../../lib/format'
import { WEEKDAY_LABELS } from './dateUtils'

export default function WeekGraph({ dateIds, totals, selectedDateId, onSelect }) {
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
