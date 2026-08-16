import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useMyGroups } from '../hooks/useMyGroups'
import { createGroup, joinGroupByCode, MAX_GROUP_SIZE } from '../lib/sessions'
import Sheet from '../components/Sheet'
import Button from '../components/Button'
import { PlusIcon } from '../components/icons'

export default function Groups() {
  const { user, profile, groupIds } = useAuth()
  const groups = useMyGroups(groupIds)
  const navigate = useNavigate()

  const [menuOpen, setMenuOpen] = useState(false)
  const [mode, setMode] = useState(null) // 'create' | 'join'
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function closeAll() {
    setMenuOpen(false)
    setMode(null)
    setName('')
    setCode('')
    setError('')
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

  async function handleJoin() {
    if (!code.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const res = await joinGroupByCode({
        uid: user.uid, displayName: profile?.displayName, photoURL: profile?.photoURL, code: code.trim(),
      })
      if (res.error === 'invalid') return setError('Invalid code')
      if (res.error === 'full') return setError('Group full')
      closeAll()
      navigate(`/groups/${res.groupId}`)
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
        {groups.map((g) => (
          <button
            key={g.id}
            onClick={() => navigate(`/groups/${g.id}`)}
            className="text-left bg-surface border border-border rounded-2xl px-5 py-4 hover:border-text-faint transition-colors animate-rise"
          >
            <div className="font-display font-semibold tracking-tight uppercase text-sm mb-1">
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
          </button>
        ))}
      </div>

      <button
        onClick={() => setMenuOpen(true)}
        aria-label="New group"
        className="fixed bottom-28 md:bottom-10 right-6 md:right-10 w-14 h-14 rounded-full bg-accent text-bg flex items-center justify-center shadow-[0_8px_24px_rgba(212,162,76,0.35)] active:scale-95 transition-transform"
      >
        <PlusIcon />
      </button>

      <Sheet open={menuOpen} onClose={closeAll}>
        <div className="flex flex-col gap-2.5">
          <Button variant="ghost" className="w-full" onClick={() => setMode('create')}>Create group</Button>
          <Button variant="ghost" className="w-full" onClick={() => setMode('join')}>Join group</Button>
        </div>
      </Sheet>

      <Sheet open={mode === 'create'} onClose={closeAll}>
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

      <Sheet open={mode === 'join'} onClose={closeAll}>
        <div className="flex flex-col items-center text-center">
          <div className="text-[13px] tracking-[0.25em] text-text-faint mb-5">INVITE CODE</div>
          <input
            autoFocus
            value={code}
            onChange={(e) => { setCode(e.target.value.toUpperCase().slice(0, 6)); setError('') }}
            placeholder="J7K92P"
            className="w-full text-center font-display text-2xl bg-transparent border-b border-border focus:border-accent outline-none pb-3 mb-3 placeholder:text-text-faint/40 tracking-[0.3em]"
          />
          {error && <p className="text-danger text-xs mb-5">{error}</p>}
          {!error && <div className="mb-5" />}
          <Button variant="primary" className="w-full" onClick={handleJoin} disabled={busy || !code.trim()}>
            Join
          </Button>
        </div>
      </Sheet>
    </div>
  )
}
