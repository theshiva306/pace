import { useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useActiveSession } from '../hooks/useActiveSession'
import { useElapsed } from '../hooks/useElapsed'
import { formatClock } from '../lib/format'
import { startSession, saveSession, deleteSession } from '../lib/sessions'
import Sheet from '../components/Sheet'
import Button from '../components/Button'

const DURATIONS = [
  { label: '25m', seconds: 25 * 60 },
  { label: '50m', seconds: 50 * 60 },
  { label: '60m', seconds: 60 * 60 },
  { label: '90m', seconds: 90 * 60 },
]

export default function Timer() {
  const { user, groupIds } = useAuth()
  const session = useActiveSession()
  const elapsed = useElapsed(session?.startedAt)

  const [mode, setMode] = useState('stopwatch') // stopwatch | countdown
  const [duration, setDuration] = useState(DURATIONS[0].seconds)
  const [customOpen, setCustomOpen] = useState(false)
  const [customMinutes, setCustomMinutes] = useState('')

  const [stopped, setStopped] = useState(null) // { session, durationSeconds } when frozen after STOP
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  const isCountdown = session?.mode === 'countdown'
  const remaining = isCountdown ? Math.max(0, session.targetSeconds - elapsed) : null
  const displaySeconds = stopped ? stopped.durationSeconds : (isCountdown ? remaining : elapsed)

  const loading = session === undefined

  async function handleStart() {
    if (busy || session) return
    setBusy(true)
    try {
      await startSession(user.uid, groupIds, mode, mode === 'countdown' ? duration : null)
    } finally {
      setBusy(false)
    }
  }

  function handleStop() {
    if (!session || stopped) return
    const durationSeconds = isCountdown ? Math.min(elapsed, session.targetSeconds) : elapsed
    setStopped({ session, durationSeconds })
  }

  async function handleSave() {
    if (!stopped || busy) return
    setBusy(true)
    try {
      await saveSession({
        uid: user.uid,
        groupId: groupIds[0],
        groupIds,
        session: stopped.session,
        durationSeconds: Math.round(stopped.durationSeconds),
      })
      setStopped(null)
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!stopped || busy) return
    setBusy(true)
    try {
      await deleteSession({ uid: user.uid, groupIds })
      setStopped(null)
      setConfirmDelete(false)
    } finally {
      setBusy(false)
    }
  }

  function handleCancel() {
    // Preserve the stopped session — just close the sheet.
    setStopped(null)
  }

  const applyCustom = () => {
    const mins = parseInt(customMinutes, 10)
    if (mins > 0) {
      setDuration(mins * 60)
      setMode('countdown')
    }
    setCustomOpen(false)
    setCustomMinutes('')
  }

  return (
    <div className="min-h-svh flex flex-col items-center justify-center px-6">
      <div className="flex flex-col items-center">
        <div className="text-[13px] tracking-[0.3em] text-text-faint mb-6">
          {session ? 'STUDYING' : 'STUDY'}
        </div>

        <div
          className={`font-display font-semibold tabular-nums leading-none select-none ${
            session ? 'text-accent' : 'text-text'
          } text-[15vw] sm:text-7xl md:text-8xl`}
        >
          {loading ? '00:00:00' : formatClock(displaySeconds ?? 0)}
        </div>

        {!session && !stopped && (
          <div className="flex items-center gap-2 mt-8">
            <ModeChip active={mode === 'stopwatch'} onClick={() => setMode('stopwatch')}>
              Stopwatch
            </ModeChip>
            {DURATIONS.map((d) => (
              <ModeChip
                key={d.label}
                active={mode === 'countdown' && duration === d.seconds}
                onClick={() => { setMode('countdown'); setDuration(d.seconds) }}
              >
                {d.label}
              </ModeChip>
            ))}
            <ModeChip active={false} onClick={() => setCustomOpen(true)}>
              Custom
            </ModeChip>
          </div>
        )}

        <div className="mt-12">
          {!session ? (
            <RoundButton onClick={handleStart} disabled={busy || loading} tone="accent">
              Start
            </RoundButton>
          ) : (
            <RoundButton onClick={handleStop} tone="danger">
              Stop
            </RoundButton>
          )}
        </div>
      </div>

      <Sheet open={!!stopped} onClose={() => {}}>
        <div className="flex flex-col items-center text-center">
          <div className="text-[13px] tracking-[0.25em] text-text-faint mb-3">SESSION COMPLETE</div>
          <div className="font-display text-4xl font-semibold tabular-nums mb-8">
            {stopped ? formatClock(stopped.durationSeconds) : '00:00:00'}
          </div>
          <div className="w-full flex flex-col gap-2.5">
            <Button variant="primary" className="w-full" onClick={handleSave} disabled={busy}>
              Save
            </Button>
            <Button variant="danger" className="w-full" onClick={() => setConfirmDelete(true)} disabled={busy}>
              Delete
            </Button>
            <Button variant="text" className="w-full" onClick={handleCancel} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      </Sheet>

      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <div className="flex flex-col items-center text-center">
          <div className="text-base font-medium mb-6">Delete session?</div>
          <div className="w-full flex gap-2.5">
            <Button variant="danger" className="flex-1" onClick={handleDelete} disabled={busy}>
              Delete
            </Button>
            <Button variant="ghost" className="flex-1" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Sheet>

      <Sheet open={customOpen} onClose={() => setCustomOpen(false)}>
        <div className="flex flex-col items-center text-center">
          <div className="text-[13px] tracking-[0.25em] text-text-faint mb-5">CUSTOM DURATION</div>
          <input
            autoFocus
            inputMode="numeric"
            value={customMinutes}
            onChange={(e) => setCustomMinutes(e.target.value.replace(/\D/g, ''))}
            placeholder="45"
            className="w-full text-center font-display text-4xl bg-transparent border-b border-border focus:border-accent outline-none pb-3 mb-8 placeholder:text-text-faint/40"
          />
          <Button variant="primary" className="w-full" onClick={applyCustom}>
            Set
          </Button>
        </div>
      </Sheet>
    </div>
  )
}

function ModeChip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
        active
          ? 'border-accent/50 text-accent bg-accent-soft'
          : 'border-border text-text-faint hover:text-text-dim'
      }`}
    >
      {children}
    </button>
  )
}

function RoundButton({ children, tone, ...props }) {
  const toneClasses = tone === 'accent'
    ? 'bg-accent text-bg shadow-[0_0_0_8px_var(--color-accent-soft)]'
    : 'bg-danger-soft text-danger border border-danger/40'
  return (
    <button
      className={`w-32 h-32 rounded-full font-medium text-sm tracking-[0.15em] uppercase transition-transform active:scale-95 disabled:opacity-40 ${toneClasses}`}
      {...props}
    >
      {children}
    </button>
  )
}
