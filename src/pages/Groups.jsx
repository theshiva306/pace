import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useMyGroups } from '../hooks/useMyGroups'
import { createGroup, setPinnedGroup } from '../lib/sessions'
import Sheet from '../components/Sheet'
import Button from '../components/Button'
import GroupIcon from '../components/GroupIcon'
import { PlusIcon, PinIcon } from '../components/icons'

// Joining is link-only now (see JoinLink.jsx / the Invite button inside a
// group) — there's no code to type here, so the only thing this "+" does
// is create a new group.
export default function Groups() {
  const { user, profile, groupIds } = useAuth()
  const groups = useMyGroups(groupIds)
  const navigate = useNavigate()

  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [pinBusy, setPinBusy] = useState(false)

  const pinnedGroupId = profile?.pinnedGroupId || null

  async function handleTogglePin(e, groupId) {
    e.stopPropagation() // don't trigger the row's navigate
    if (pinBusy) return
    setPinBusy(true)
    try {
      // Tapping the already-pinned group's pin unpins it; tapping any
      // other group's pin replaces whichever was pinned before.
      await setPinnedGroup(user.uid, pinnedGroupId === groupId ? null : groupId)
    } finally {
      setPinBusy(false)
    }
  }

  function closeAll() {
    setCreateOpen(false)
    setName('')
  }

  async function handleCreate() {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const groupId = await createGroup({
        uid: user.uid, displayName: profile?.displayName, photoURL: profile?.photoURL, name: name.trim(),
      })
      closeAll()
      navigate(`/groups/${groupId}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-svh px-5 pt-[calc(env(safe-area-inset-top)+24px)] pb-32 max-w-md mx-auto md:max-w-2xl md:pt-16">
      <h1 className="font-display text-2xl font-semibold mb-6">Groups</h1>

      {groups.length === 0 && (
        <div className="text-center py-20">
          <p className="text-text-dim text-sm">No groups yet</p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {groups.map((g) => {
          const pinned = pinnedGroupId === g.id
          return (
            <button
              key={g.id}
              onClick={() => navigate(`/groups/${g.id}`)}
              className="relative flex items-center gap-3.5 text-left bg-surface border border-border rounded-2xl pl-5 pr-14 py-4 hover:border-text-faint transition-colors animate-rise"
            >
              <GroupIcon groupId={g.id} size="sm" />
              <div className="min-w-0">
                <div className="font-display font-semibold tracking-tight uppercase text-sm mb-1 truncate">
                  {g.name || '—'}
                </div>
                <div className="flex items-center gap-3 text-xs text-text-faint">
                  <span>{g.memberCount ?? 0} members</span>
                  {g.liveCount > 0 && (
                    <span className="flex items-center gap-1.5 text-live">
                      <span className="w-1.5 h-1.5 rounded-full bg-live" />
                      {g.liveCount} live
                    </span>
                  )}
                </div>
              </div>
              <span
                role="button"
                aria-label={pinned ? 'Unpin from timer' : 'Pin to timer'}
                onClick={(e) => handleTogglePin(e, g.id)}
                className={`absolute top-1/2 -translate-y-1/2 right-4 w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                  pinned ? 'text-accent' : 'text-text-faint hover:text-text-dim'
                }`}
              >
                <PinIcon />
              </span>
            </button>
          )
        })}
      </div>

      <button
        onClick={() => setCreateOpen(true)}
        aria-label="New group"
        className="fixed bottom-28 md:bottom-10 right-6 md:right-10 w-14 h-14 rounded-full bg-accent text-bg flex items-center justify-center shadow-[0_8px_24px_rgba(212,162,76,0.35)] active:scale-95 transition-transform"
      >
        <PlusIcon />
      </button>

      <Sheet open={createOpen} onClose={closeAll}>
        <div className="flex flex-col items-center text-center">
          <div className="text-[13px] tracking-[0.25em] text-text-faint mb-5">GROUP NAME</div>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value.toUpperCase().slice(0, 24))}
            placeholder="JEE WARRIORS"
            className="w-full text-center font-display text-2xl bg-transparent border-b border-border focus:border-accent outline-none pb-3 mb-8 placeholder:text-text-faint/40 uppercase tracking-wide"
          />
          <Button variant="primary" className="w-full" onClick={handleCreate} disabled={busy || !name.trim()}>
            Create
          </Button>
        </div>
      </Sheet>
    </div>
  )
}
