from pathlib import Path
import re

p = Path('src/pages/GroupDetail.jsx')
s = p.read_text()

if 'const [removeConfirmUid, setRemoveConfirmUid]' not in s:
    s = s.replace(
        '  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)\n',
        '  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)\n  const [removeConfirmUid, setRemoveConfirmUid] = useState(null)\n'
    )

if 'open={!!removeConfirmUid}' not in s:
    marker = '<Sheet open={deleteConfirmOpen}'
    pos = s.find(marker)
    if pos != -1:
        end = s.find('</Sheet>', pos)
        end += len('</Sheet>')
        s = s[:end] + '\n    <Sheet open={!!removeConfirmUid} onClose={() => setRemoveConfirmUid(null)}><ConfirmSheet title="Remove this member?" subtitle="They will leave this group and will need a new invite to rejoin." confirmLabel="Remove member" busy={busy} onConfirm={async () => { await handleRemoveMember(removeConfirmUid); setRemoveConfirmUid(null) }} onCancel={() => setRemoveConfirmUid(null)} /></Sheet>' + s[end:]

pattern = r'function SettingsSheetContent\(.*?\n\nfunction computeMemberStats'
replacement = '''function SettingsSheetContent({ group, memberList, currentUid, isAdmin, busy, onRename, onRemoveMember, onRequestLeave, onRequestDelete, onRequestRemove }) {
  const [name, setName] = useState(group?.name || '')
  useEffect(() => { setName(group?.name || '') }, [group?.name])
  const dirty = !!name.trim() && name.trim() !== group?.name
  const admin = memberList.find((m) => m.uid === group?.adminUid)
  const others = memberList.filter((m) => m.uid !== currentUid)

  return <div className="flex flex-col text-left max-h-[78vh] overflow-y-auto no-scrollbar -mx-1">
    <div className="flex items-center gap-3 px-1 mb-7">
      <div className="w-10 h-10 rounded-xl bg-elevated border border-border flex items-center justify-center shrink-0"><SettingsIcon width="19" height="19" /></div>
      <div className="min-w-0"><div className="text-base font-semibold tracking-tight">Group settings</div><div className="text-xs text-text-faint truncate">{group?.name || 'Your group'}</div></div>
    </div>

    <section className="mb-7">
      <div className="text-[10px] tracking-[0.22em] text-text-faint mb-3">MEMBERS · {memberList.length}</div>
      <div className="rounded-2xl border border-border bg-elevated/40 overflow-hidden">
        {admin && <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border-soft">
          <Avatar name={admin.displayName} photoURL={admin.photoURL} size="sm" />
          <div className="flex-1 min-w-0"><div className="text-sm font-medium truncate">{admin.uid === currentUid ? 'You' : admin.displayName}</div><div className="text-[11px] text-text-faint">Group admin</div></div>
          <span className="text-[9px] tracking-[0.16em] text-accent border border-accent/20 bg-accent/5 rounded-full px-2 py-1">ADMIN</span>
        </div>}
        {others.map((m, i) => <div key={m.uid} className={`flex items-center gap-3 px-4 py-3.5 ${i < others.length - 1 ? 'border-b border-border-soft' : ''}`}>
          <Avatar name={m.displayName} photoURL={m.photoURL} size="sm" />
          <div className="flex-1 min-w-0"><div className="text-sm truncate">{m.displayName}</div><div className="text-[11px] text-text-faint">Member</div></div>
          {isAdmin && <button onClick={() => onRequestRemove(m.uid)} disabled={busy} className="text-xs font-medium text-danger px-2 py-1 disabled:opacity-40">Remove</button>}
        </div>)}
        {memberList.length === 1 && <div className="px-4 py-4 text-xs text-text-faint">You're the only member here.</div>}
      </div>
    </section>

    {isAdmin && <section className="mb-7">
      <div className="text-[10px] tracking-[0.22em] text-text-faint mb-3">ADMIN</div>
      <div className="rounded-2xl border border-border bg-elevated/40 overflow-hidden">
        <div className="px-4 py-4">
          <label className="text-xs text-text-faint block mb-2">Group name</label>
          <div className="flex gap-2"><input value={name} onChange={(e) => setName(e.target.value.slice(0, 24))} onKeyDown={(e) => { if (e.key === 'Enter' && dirty) onRename(name) }} className="min-w-0 flex-1 bg-surface border border-border rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-text-faint" placeholder="Group name" /><Button variant="ghost" onClick={() => onRename(name)} disabled={!dirty || busy}>Save</Button></div>
        </div>
        <div className="px-4 py-3.5 border-t border-border-soft text-xs text-text-faint">Only admins can change the group name or remove members.</div>
      </div>
    </section>}

    <section className="mb-2 pt-5 border-t border-border-soft">
      <Button variant="ghost" className="w-full justify-start" onClick={onRequestLeave}><ExitIcon /> Leave group</Button>
      {isAdmin && <Button variant="danger" className="w-full mt-2 justify-start" onClick={onRequestDelete}><TrashIcon /> Delete group</Button>}
    </section>
  </div>
}

function computeMemberStats'''
updated, n = re.subn(pattern, replacement, s, count=1, flags=re.S)
if n != 1:
    raise SystemExit('SettingsSheetContent block not found; refusing to modify')
updated = updated.replace('onRemoveMember={handleRemoveMember} onRequestLeave=', 'onRemoveMember={handleRemoveMember} onRequestRemove={setRemoveConfirmUid} onRequestLeave=')
p.write_text(updated)

ip = Path('src/components/icons.jsx')
icon = ip.read_text()
old = re.search(r'export function SettingsIcon\(props\) \{.*?\n\}', icon, flags=re.S)
if not old:
    raise SystemExit('SettingsIcon not found')
new = '''export function SettingsIcon(props) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M6 7h12M6 12h12M6 17h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="9" cy="7" r="1.8" fill="var(--color-bg)" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="15" cy="12" r="1.8" fill="var(--color-bg)" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="11" cy="17" r="1.8" fill="var(--color-bg)" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}'''
ip.write_text(icon[:old.start()] + new + icon[old.end():])
