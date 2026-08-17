import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { deletePersonalData, updateDisplayName } from '../lib/sessions'
import Avatar from '../components/Avatar'
import Sheet from '../components/Sheet'
import Button from '../components/Button'

export default function Profile() {
  const { user, profile, groupIds, logout } = useAuth()
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')

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

  async function handleDeleteData() {
    if (busy) return
    setBusy(true)
    setDeleteError('')
    try {
      await deletePersonalData(user.uid)
      await logout()
    } catch (err) {
      console.error('Failed to delete personal data', err)
      setDeleteError('Could not delete your data. Nothing was changed. Please try again.')
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

      <div className="pt-2">
        <button
          onClick={logout}
          className="w-full text-center text-sm font-medium text-danger py-4"
        >
          Sign out
        </button>

        <button
          onClick={() => {
            setDeleteError('')
            setDeleteOpen(true)
          }}
          className="w-full text-center text-sm font-medium text-danger/70 py-4"
        >
          Delete my data
        </button>
      </div>

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

      <Sheet open={deleteOpen} onClose={() => !busy && setDeleteOpen(false)}>
        <div className="text-center">
          <div className="font-display text-xl font-semibold mb-3">Delete your data?</div>
          <p className="text-sm leading-6 text-text-dim mb-6">
            This permanently deletes your Pace timer data, completed sessions, study stats, and profile data.
            Your groups and group data will not be deleted.
          </p>

          {deleteError && (
            <p className="text-sm text-danger mb-4">{deleteError}</p>
          )}

          <div className="flex gap-3">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => setDeleteOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={handleDeleteData}
              disabled={busy}
            >
              {busy ? 'Deleting…' : 'Delete data'}
            </Button>
          </div>
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
