import { formatDuration } from '../lib/format'
import { leagueStatus } from '../lib/league'
import Avatar from './Avatar'
import { LeagueIcon, PlusIcon } from './icons'

// Was previously defined inside pages/GroupDetail.jsx and imported directly
// from pages/Timer.jsx for its own pinned group panel — that cross-page
// static import silently defeated GroupDetail's route-level code-splitting
// (Vite has to bundle it eagerly if anything outside its own lazy() import
// depends on it directly). Living here means both pages can use it without
// either one dragging the other into its bundle.
export function Live({ memberList, live, totals, weekly, currentUid, onSelectMember, onInvite }) {
  const liveMembers = memberList.filter((m) => {
    const status = live[m.uid]?.status
    return status === 'active' || status === 'paused' || status === 'onBreak'
  })
  const idleMembers = memberList.filter((m) => !liveMembers.some((x) => x.uid === m.uid))
  const ranked = [...memberList]
    .map((m) => ({ ...m, seconds: weekly?.[m.uid] || 0 }))
    .sort((a, b) => b.seconds - a.seconds)
  const tierFor = (uid) => {
    const status = weekly?.[uid] > 0 ? leagueStatus(ranked, uid) : null
    return status && status.name !== 'Unranked' ? status : null
  }

  return (
    <div className="animate-fade-in">
      <SectionDivider dotClassName="bg-live" label={`${liveMembers.length} focusing`} labelClassName="text-live" />
      <div className="grid grid-cols-3 gap-3 mb-8">
        <InviteTile onClick={onInvite} />
        {liveMembers.map((m) => {
          const status = live[m.uid]?.status
          const paused = status === 'paused' || status === 'onBreak'
          return (
            <LiveTile
              key={m.uid}
              member={m}
              seconds={totals[m.uid] || 0}
              self={m.uid === currentUid}
              paused={paused}
              tier={tierFor(m.uid)}
              onClick={() => onSelectMember(m.uid)}
            />
          )
        })}
      </div>
      {idleMembers.length > 0 && (
        <>
          <SectionDivider dotClassName="bg-text-faint/60" label="Not focusing" labelClassName="text-text-dim" />
          <div className="grid grid-cols-3 gap-3">
            {idleMembers.map((m) => (
              <IdleTile
                key={m.uid}
                member={m}
                seconds={totals[m.uid] || 0}
                self={m.uid === currentUid}
                tier={tierFor(m.uid)}
                onClick={() => onSelectMember(m.uid)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function SectionDivider({ label, dotClassName, labelClassName }) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <span className={`w-2 h-2 rounded-full shrink-0 ${dotClassName}`} aria-hidden />
      <span className={`text-sm font-medium shrink-0 ${labelClassName}`}>{label}</span>
      <span className="flex-1 border-t border-dashed border-border-soft" aria-hidden />
    </div>
  )
}

export function TierBadge({ tier, size = 'md' }) {
  if (!tier) return null
  const box = size === 'sm'
    ? 'w-[13px] h-[13px] rounded-[4px] -bottom-0.5 -right-1.5'
    : 'w-[16px] h-[16px] rounded-[5px] -bottom-0.5 -right-2'
  const icon = size === 'sm' ? 8 : 10
  return (
    <span className={`absolute flex items-center justify-center shadow-sm shadow-black/40 ${box} ${tier.chipClass}`}>
      <LeagueIcon width={icon} height={icon} className="text-bg" />
    </span>
  )
}

function InviteTile({ onClick }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-2 bg-surface border border-dashed border-border-soft rounded-2xl py-4">
      <div className="w-10 h-10 rounded-full border border-dashed border-border-soft flex items-center justify-center text-text-faint">
        <PlusIcon />
      </div>
      <span className="text-xs text-text-faint leading-tight px-1 text-center">Invite a friend</span>
    </button>
  )
}

function LiveTile({ member, seconds, self, paused, tier, onClick }) {
  return (
    <button onClick={onClick} className={`flex flex-col items-center gap-2 bg-surface border border-border rounded-2xl py-4 ${paused ? 'opacity-55' : ''}`}>
      <div className="relative">
        <Avatar name={member.displayName} photoURL={member.photoURL} size="md" live={!paused} showDot={false} tier={tier} />
        <TierBadge tier={tier} />
      </div>
      <span className="text-xs font-medium truncate max-w-full px-1">{self ? 'You' : member.displayName}</span>
      <span className={`text-xs tabular-nums ${paused ? 'text-text-faint' : 'text-live'}`}>{formatDuration(seconds)}</span>
    </button>
  )
}

function IdleTile({ member, seconds, self, tier, onClick }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-2 bg-surface border border-border rounded-2xl py-4 opacity-70">
      <div className="relative">
        <Avatar name={member.displayName} photoURL={member.photoURL} size="md" tier={tier} />
        <TierBadge tier={tier} />
      </div>
      <span className="text-xs font-medium text-text-dim truncate max-w-full px-1">{self ? 'You' : member.displayName}</span>
      <span className="text-xs tabular-nums text-text-faint">{formatDuration(seconds)}</span>
    </button>
  )
}
