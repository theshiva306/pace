from pathlib import Path
import re

path = Path('src/pages/GroupDetail.jsx')
source = path.read_text()

new_live = '''// Live keeps the original card/list presentation while using the new realtime daily totals.
export function Live({ memberList, live, totals, currentUid, onRefresh, refreshing, updatedAt, onSelectMember }) {
  const liveMembers = memberList.filter((m) => {
    const status = live[m.uid]?.status
    return status === 'active' || status === 'paused' || status === 'onBreak'
  })
  const idleMembers = memberList.filter((m) => !liveMembers.some((x) => x.uid === m.uid))

  return <div className="animate-fade-in">
    <RefreshRow label="TODAY" onRefresh={onRefresh} refreshing={refreshing} updatedAt={updatedAt} />

    {liveMembers.length === 0 ? (
      <p className="text-text-dim text-sm py-6">No one studying</p>
    ) : (
      <div className="grid grid-cols-3 gap-3 mb-8">
        {liveMembers.map((m) => {
          const status = live[m.uid]?.status
          const paused = status === 'paused' || status === 'onBreak'
          return <LiveTile key={m.uid} member={m} seconds={totals[m.uid] || 0} self={m.uid === currentUid} paused={paused} status={status} onClick={() => onSelectMember(m.uid)} />
        })}
      </div>
    )}

    {idleMembers.length > 0 && <>
      <div className="text-[13px] tracking-[0.25em] text-text-faint mb-3">NOT FOCUSING</div>
      <div className="flex flex-col gap-3">
        {idleMembers.map((m) => (
          <button key={m.uid} onClick={() => onSelectMember(m.uid)} className="flex items-center gap-3 text-left w-full">
            <Avatar name={m.displayName} photoURL={m.photoURL} size="sm" />
            <span className="text-sm text-text-dim flex-1 truncate">{m.uid === currentUid ? 'You' : m.displayName}</span>
            <span className="text-xs tabular-nums text-text-faint">{formatDuration(totals[m.uid] || 0)}</span>
          </button>
        ))}
      </div>
    </>}
  </div>
}

function LiveTile({ member, seconds, self, paused, status, onClick }) {
  const label = paused ? (status === 'onBreak' ? 'BREAK' : 'PAUSED') : 'STUDYING'
  return <button onClick={onClick} className={`flex flex-col items-center gap-2 bg-surface border border-border rounded-2xl py-4 ${paused ? 'opacity-55' : ''}`}>
    <Avatar name={member.displayName} photoURL={member.photoURL} size="md" live={!paused} />
    <span className="text-xs font-medium truncate max-w-full px-1">{self ? 'You' : member.displayName}</span>
    <span className={`text-[10px] tracking-wide ${paused ? 'text-text-faint' : 'text-live'}`}>{label}</span>
    <span className={`text-xs tabular-nums ${paused ? 'text-text-faint' : 'text-live'}`}>{formatDuration(seconds)}</span>
  </button>
}'''

pattern = r'// Daily leaderboard:.*?\nfunction Chat\('
updated, count = re.subn(pattern, new_live + '\n\nfunction Chat(', source, count=1, flags=re.S)
if count != 1:
    raise SystemExit('Current Live block was not found; refusing to modify the file.')
if updated != source:
    path.write_text(updated)
    print('Live layout restored.')
else:
    print('Live layout already restored.')
