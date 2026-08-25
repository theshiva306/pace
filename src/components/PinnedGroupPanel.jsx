import { usePolledValue } from '../hooks/usePolledValue'
import { useTodayId } from '../hooks/useTodayId'
import { Live } from './LiveView'
import { ChevronRight, PinIcon } from './icons'

export function PinnedGroupPill({ summary, onOpen, onPinSomething }) {
  if (!summary) {
    return (
      <button
        onClick={onPinSomething}
        className="flex items-center gap-1.5 text-xs text-text-faint mb-8 py-1"
      >
        <PinIcon />
        <span className="underline decoration-dotted underline-offset-4">Pin a group to see who's live</span>
      </button>
    )
  }

  const liveCount = summary.liveCount ?? 0

  return (
    <button
      onClick={onOpen}
      className="flex items-center gap-2.5 bg-elevated border border-border rounded-full pl-2.5 pr-3.5 py-2 mb-8 max-w-[86vw] active:scale-[0.97] transition-transform"
    >
      <span className="relative flex items-center justify-center w-4 h-4 shrink-0">
        {liveCount > 0 && <span className="absolute inset-0 rounded-full bg-live/25 animate-breathe" />}
        <span className={`relative w-1.5 h-1.5 rounded-full ${liveCount > 0 ? 'bg-live' : 'bg-text-faint'}`} />
      </span>
      <span className="text-xs font-semibold truncate max-w-[38vw]">{summary.name || '—'}</span>
      <span className="w-px h-3 bg-border shrink-0" />
      <span className="text-xs text-text-dim whitespace-nowrap">{liveCount} focusing</span>
      <ChevronRight className="w-3.5 h-3.5 text-text-faint shrink-0" />
    </button>
  )
}

// Content of the pinned-group popup/sheet: the pinned group's Live view
// (who's focusing + today's totals), reusing the shared Live component so
// this stays visually identical to the group page's own Live tab. Polled,
// not real-time, same as that tab.
export function PinnedGroupLivePanel({ groupId, currentUid, onOpenGroup }) {
  const todayId = useTodayId()
  const name = usePolledValue(`groups/${groupId}/name`)
  const members = usePolledValue(`groups/${groupId}/members`)
  const live = usePolledValue(`groups/${groupId}/live`)
  const daily = usePolledValue(`groups/${groupId}/dailyTotals/${todayId}`)

  const memberList = Object.entries(members.value || {}).map(([uid, m]) => ({ uid, ...m }))

  function refresh() {
    name.refresh()
    members.refresh()
    live.refresh()
    daily.refresh()
  }

  return (
    <div>
      <div className="text-center font-display font-semibold uppercase text-sm tracking-tight mb-4 truncate">
        {name.value || '—'}
      </div>
      <Live
        memberList={memberList}
        live={live.value || {}}
        totals={daily.value || {}}
        currentUid={currentUid}
        onRefresh={refresh}
        refreshing={name.refreshing || members.refreshing || live.refreshing || daily.refreshing}
        updatedAt={live.updatedAt}
      />
      <button
        onClick={onOpenGroup}
        className="w-full text-center text-xs text-text-faint underline decoration-dotted underline-offset-4 mt-6"
      >
        Open full group page
      </button>
    </div>
  )
}
