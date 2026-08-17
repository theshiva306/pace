import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { updateDisplayName } from '../lib/sessions'
import Avatar from '../components/Avatar'
import Sheet from '../components/Sheet'
import Button from '../components/Button'

export default function Profile() {
  const { user, profile, groupIds, logout } = useAuth()
  const [editOpen, setEditOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [notifications, setNotifications] = useState(true)

  useEffect(() => {
    if (editOpen) setName(profile?.displayName || '')
  }, [editOpen, profile])

  async function handleSave() {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      await updateDisplayName({ uid: user.uid, groupIds, name: name.trim() })
      setEditOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-svh px-5 pt-[calc(env(safe-area-inset-top)+24px)] pb-32 max-w-md mx-auto md:max-w-lg md:pt-16">
      <h1 className="font-display text-2xl font-semibold mb-8">Profile</h1>

      <div className="flex flex-col items-center mb-10">
        <Avatar name={profile?.displayName} photoURL={profile?.photoURL} size="xl" className="mb-4" />
        <div className="font-display text-xl font-semibold mb-1">{profile?.displayName || '—'}</div>
        <button onClick={() => setEditOpen(true)} className="text-xs text-accent font-medium">
          Edit profile
        </button>
      </div>

      <Section title="Account">
        <Row label="Name" value={profile?.displayName || '—'} />
        <Row label="Email" value={user.email || '—'} last />
      </Section>

      <Section title="Settings">
        <ToggleRow label="Notifications" checked={notifications} onChange={setNotifications} last />
      </Section>

      <button
        onClick={logout}
        className="w-full text-center text-sm font-medium text-danger py-4 mt-2"
      >
        Sign out
      </button>

      <Sheet open={editOpen} onClose={() => setEditOpen(false)}>
        <div className="flex flex-col items-center text-center">
          <div className="text-[13px] tracking-[0.25em] text-text-faint mb-5">NAME</div>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 24))}
            className="w-full text-center font-display text-2xl bg-transparent border-b border-border focus:border-accent outline-none pb-3 mb-8"
          />
          <Button variant="primary" className="w-full" onClick={handleSave} disabled={busy || !name.trim()}>
            Save
          </Button>
        </div>
      </Sheet>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="mb-8">
      <div className="text-[13px] tracking-[0.25em] text-text-faint mb-3">{title.toUpperCase()}</div>
      <div className="bg-surface border border-border rounded-2xl px-5">{children}</div>
    </div>
  )
}

function Row({ label, value, last }) {
  return (
    <div className={`flex items-center justify-between py-4 ${last ? '' : 'border-b border-border-soft'}`}>
      <span className="text-sm text-text-dim">{label}</span>
      <span className="text-sm font-medium truncate max-w-[60%]">{value}</span>
    </div>
  )
}

function ToggleRow({ label, checked, onChange, last }) {
  return (
    <div className={`flex items-center justify-between py-4 ${last ? '' : 'border-b border-border-soft'}`}>
      <span className="text-sm text-text-dim">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        className={`rounded-full transition-colors relative ${checked ? 'bg-accent' : 'bg-elevated border border-border'}`}
        style={{ height: '26px', width: '44px' }}
      >
        <span
          className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-[22px]' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  )
}
