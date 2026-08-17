import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useActiveSession } from '../hooks/useActiveSession'
import { useSessionClock } from '../hooks/useSessionClock'
import { formatClock, formatDuration, formatMessageTime } from '../lib/format'
import {
  startSession, pauseSession, resumeSession, startBreak, endBreak, saveSession, deleteSession,
} from '../lib/sessions'
import { loadTimerSettings, saveTimerSettings } from '../lib/timerSettings'
import Sheet from '../components/Sheet'
import Button from '../components/Button'
import SegmentedControl from '../components/SegmentedControl'
import Stepper from '../components/Stepper'
import WheelColumn from '../components/WheelColumn'
import { ChevronRight } from '../components/icons'

const HOURS = Array.from({ length: 13 }, (_, i) => i) // 0-12
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5) // 0,5,...,55

export default function Timer() {
  const { user, groupIds } = useAuth()
  const session = useActiveSession()
  const clock = useSessionClock(session)

  const [settings, setSettings] = useState(() => loadTimerSettings())
  const [setupOpen, setSetupOpen] = useState(false)
  const [durationPickerOpen, setDurationPickerOpen] = useState(false)
  const [breaksPickerOpen, setBreaksPickerOpen] = useState(false)
  const [breakInfoOpen, setBreakInfoOpen] = useState(false)
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [stopped, setStopped] = useState(null) // { session, durationSeconds, startedAtMs, endedAtMs }
  const [busy, setBusy] = useState(false)

  const loading = session === undefined
  const autoResumeFired = useRef(false)

  // Auto-resume once a break's own countdown reaches zero. Guarded so a
  // brief lag before Firebase's write comes back can't fire it twice.
  useEffect(() => {
    if (clock.isOnBreak && clock.breakRemaining <= 0 && !autoResumeFired.current) {
      autoResumeFired.current = true
      endBreak(user.uid, groupIds)
    }
    if (!clock.isOnBreak) autoResumeFired.current = false
  }, [clock.isOnBreak, clock.breakRemaining, user.uid, groupIds])

  async function handleStart(s) {
    if (busy || session) return
    setBusy(true)
    try {
      await startSession(
        user.uid,
        groupIds,
        s.mode,
        s.mode === 'countdown' ? s.targetSeconds : null,
        s.breaksAllowed,
        s.breakDurationSeconds,
      )
    } finally {
      setBusy(false)
    }
  }

  function handleMainCta() {
    if (settings.isFirstRun) {
      setSetupOpen(true)
    } else {
      handleStart(settings)
    }
  }

  function handleConfirmSetup() {
    const next = { ...settings, isFirstRun: false }
    saveTimerSettings(next)
    setSettings(next)
    setSetupOpen(false)
    handleStart(next)
  }

  async function handleTogglePause() {
    if (busy || !session) return
    setBusy(true)
    try {
      if (clock.isPaused) await resumeSession(user.uid, groupIds)
      else await pauseSession(user.uid, groupIds)
    } finally {
      setBusy(false)
    }
  }

  async function handleTakeBreak() {
    if (busy || !session) return
    setBusy(true)
    try {
      await startBreak(user.uid, groupIds)
      setBreakInfoOpen(false)
    } finally {
      setBusy(false)
    }
  }

  async function handleEndBreak() {
    if (busy || !session) return
    setBusy(true)
    try {
      await endBreak(user.uid, groupIds)
    } finally {
      setBusy(false)
    }
  }

  async function handleConfirmStop() {
    if (!session || busy) return
    setStopConfirmOpen(false)
    setBuffering(true)
    const durationSeconds = Math.round(clock.focusElapsed)
    const startedAtMs = session.startedAt
    const endedAtMs = Date.now()
    // A short moment of stillness before the summary appears.
    await new Promise((resolve) => setTimeout(resolve, 700))
    setStopped({ session, durationSeconds, startedAtMs, endedAtMs })
    setBuffering(false)
  }

  async function handleSave() {
    if (!stopped || busy) return
    setBusy(true)
    try {
      await saveSession({
        uid: user.uid,
        groupId: groupIds[0] ?? null,
        groupIds,
        session: stopped.session,
        durationSeconds: stopped.durationSeconds,
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
    } finally {
      setBusy(false)
    }
  }

  function setHours(h) {
    setSettings((s) => {
      const mins = Math.round(s.targetSeconds / 60) % 60
      return { ...s, targetSeconds: h * 3600 + mins * 60 }
    })
  }

  function setMinutes(m) {
    setSettings((s) => {
      const hrs = Math.floor(Math.round(s.targetSeconds / 60) / 60)
      return { ...s, targetSeconds: hrs * 3600 + m * 60 }
    })
  }

  if (loading) {
    return (
      <div className="min-h-svh flex items-center justify-center">
        <div className="w-2 h-2 rounded-full bg-accent animate-breathe" />
      </div>
    )
  }

  if (buffering) {
    return (
      <div className="min-h-svh flex items-center justify-center">
        <div className="w-2 h-2 rounded-full bg-accent animate-breathe" />
      </div>
    )
  }

  if (stopped) {
    return <SaveSessionScreen stopped={stopped} busy={busy} onSave={handleSave} onDelete={handleDelete} />
  }

  const selHours = Math.floor(Math.round(settings.targetSeconds / 60) / 60)
  const selMinutes = Math.round(settings.targetSeconds / 60) % 60

  const breaksLeft = session ? Math.max(0, (session.breaksAllowed || 0) - (session.breaksTaken || 0)) : 0

  const summaryText = settings.mode === 'stopwatch'
    ? 'Stopwatch · Edit'
    : `${formatDuration(settings.targetSeconds)}${settings.breaksAllowed > 0 ? ` · ${settings.breaksAllowed} breaks` : ''} · Edit`

  const displaySeconds = !session
    ? 0
    : session.mode === 'countdown'
      ? Math.max(0, session.targetSeconds - clock.focusElapsed)
      : clock.focusElapsed

  return (
    <div className="min-h-svh flex flex-col items-center justify-center px-6">
      {!session && (
        <div className="flex flex-col items-center">
          <div className="font-display font-semibold tabular-nums leading-none select-none text-text text-[15vw] sm:text-7xl md:text-8xl mb-4">
            00:00:00
          </div>
          <button
            onClick={() => setSetupOpen(true)}
            className="text-xs text-text-faint mb-10 underline decoration-dotted underline-offset-4"
          >
            {summaryText}
          </button>
          <button
            onClick={handleMainCta}
            disabled={busy}
            className="w-full max-w-xs bg-accent text-bg font-medium text-sm tracking-[0.1em] uppercase rounded-2xl py-4 shadow-[0_0_0_8px_var(--color-accent-soft)] active:scale-[0.98] transition-transform disabled:opacity-40"
          >
            Start Focus Now
          </button>
        </div>
      )}

      {session && clock.isOnBreak && (
        <div className="flex flex-col items-center">
          <div className="text-[13px] tracking-[0.3em] text-text-faint mb-6">BREAK</div>
          <div className="font-display font-semibold tabular-nums leading-none select-none text-accent text-[15vw] sm:text-7xl md:text-8xl">
            {formatClock(clock.breakRemaining)}
          </div>
          <div className="mt-12 w-full max-w-xs">
            <Button variant="ghost" className="w-full" onClick={handleEndBreak} disabled={busy}>
              End break
            </Button>
          </div>
        </div>
      )}

      {session && !clock.isOnBreak && (
        <div className="flex flex-col items-center">
          <div className="text-[13px] tracking-[0.3em] text-text-faint mb-6">
            {clock.isPaused ? 'PAUSED' : 'FOCUSING'}
          </div>
          <div
            className={`font-display font-semibold tabular-nums leading-none select-none text-[15vw] sm:text-7xl md:text-8xl ${
              clock.isPaused ? 'text-text-faint' : 'text-accent'
            }`}
          >
            {formatClock(displaySeconds)}
          </div>

          <div className="mt-12 flex flex-col items-center gap-3 w-full max-w-xs">
            {session.breaksAllowed > 0 && (
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => setBreakInfoOpen(true)}
                disabled={busy || breaksLeft <= 0}
              >
                Take a break
              </Button>
            )}
            <div className="flex gap-3 w-full">
              <Button variant="ghost" className="flex-1" onClick={() => setStopConfirmOpen(true)}>
                Stop focusing
              </Button>
              <Button variant="ghost" className="flex-1" onClick={handleTogglePause} disabled={busy}>
                {clock.isPaused ? 'Resume' : 'Pause'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Setup sheet: choose Stopwatch/Timer, duration, breaks */}
      <Sheet open={setupOpen} onClose={() => setSetupOpen(false)}>
        <div className="flex flex-col gap-4">
          <div className="text-[13px] tracking-[0.25em] text-text-faint text-center mb-1">FOCUS SESSION</div>
          <SegmentedControl
            options={[
              { value: 'stopwatch', label: 'Stopwatch' },
              { value: 'countdown', label: 'Timer' },
            ]}
            value={settings.mode}
            onChange={(mode) => setSettings((s) => ({ ...s, mode }))}
          />
          {settings.mode === 'countdown' && (
            <SettingsRow
              label="Duration"
              value={formatDuration(settings.targetSeconds)}
              onClick={() => setDurationPickerOpen(true)}
            />
          )}
          <SettingsRow
            label="Breaks"
            value={settings.breaksAllowed > 0 ? `${settings.breaksAllowed} · ${Math.round(settings.breakDurationSeconds / 60)}m` : 'None'}
            onClick={() => setBreaksPickerOpen(true)}
          />
          <Button variant="primary" className="w-full mt-2" onClick={handleConfirmSetup} disabled={busy}>
            Start Focus Now
          </Button>
        </div>
      </Sheet>

      {/* Duration picker sub-sheet */}
      <Sheet open={durationPickerOpen} onClose={() => setDurationPickerOpen(false)}>
        <div className="flex flex-col items-center text-center">
          <div className="text-[13px] tracking-[0.25em] text-text-faint mb-5">SET DURATION</div>
          <div className="flex gap-3 mb-6">
            <WheelColumn values={HOURS} selected={selHours} onSelect={setHours} suffix="h" />
            <WheelColumn values={MINUTES} selected={selMinutes} onSelect={setMinutes} suffix="m" />
          </div>
          <Button variant="primary" className="w-full" onClick={() => setDurationPickerOpen(false)}>
            Confirm
          </Button>
        </div>
      </Sheet>

      {/* Breaks picker sub-sheet */}
      <Sheet open={breaksPickerOpen} onClose={() => setBreaksPickerOpen(false)}>
        <div className="flex flex-col text-center">
          <div className="text-[13px] tracking-[0.25em] text-text-faint mb-3">BREAKS</div>
          <div className="flex flex-col divide-y divide-border-soft mb-6">
            <Stepper
              label="No. of breaks"
              value={settings.breaksAllowed}
              min={0}
              max={8}
              onChange={(v) => setSettings((s) => ({ ...s, breaksAllowed: v }))}
            />
            <Stepper
              label="Break duration"
              value={Math.round(settings.breakDurationSeconds / 60)}
              min={1}
              max={20}
              suffix=" min"
              onChange={(v) => setSettings((s) => ({ ...s, breakDurationSeconds: v * 60 }))}
            />
          </div>
          <Button variant="primary" className="w-full" onClick={() => setBreaksPickerOpen(false)}>
            Confirm
          </Button>
        </div>
      </Sheet>

      {/* Break info sheet (opened by "Take a break" during an active session) */}
      <Sheet open={breakInfoOpen} onClose={() => setBreakInfoOpen(false)}>
        <div className="flex flex-col items-center text-center">
          <div className="text-2xl font-display font-semibold mb-2">
            {breaksLeft} break{breaksLeft === 1 ? '' : 's'} left
          </div>
          <p className="text-xs text-text-faint mb-8">Use it when you need to relax!</p>
          <Button variant="primary" className="w-full" onClick={handleTakeBreak} disabled={busy || breaksLeft <= 0}>
            Take a break
          </Button>
        </div>
      </Sheet>

      {/* Stop confirmation sheet */}
      <Sheet open={stopConfirmOpen} onClose={() => setStopConfirmOpen(false)}>
        <div className="flex flex-col items-center text-center">
          <div className="text-base font-medium mb-2">Are you sure you want to stop focusing?</div>
          <p className="text-xs text-text-faint mb-8">Take a deep breath before you decide!</p>
          <div className="w-full flex flex-col gap-2.5">
            <Button variant="ghost" className="w-full" onClick={handleConfirmStop} disabled={busy}>
              Stop focusing
            </Button>
            <Button variant="text" className="w-full" onClick={() => setStopConfirmOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  )
}

function SettingsRow({ label, value, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-between bg-elevated border border-border rounded-xl px-4 py-3.5 text-left"
    >
      <span className="text-sm font-medium">{label}</span>
      <span className="text-sm text-text-dim flex items-center gap-1">
        {value}
        <ChevronRight />
      </span>
    </button>
  )
}

function SaveSessionScreen({ stopped, busy, onSave, onDelete }) {
  const timeRange = `${formatMessageTime(stopped.startedAtMs)} – ${formatMessageTime(stopped.endedAtMs)}`
  return (
    <div className="min-h-svh flex flex-col items-center justify-center px-8 text-center animate-fade-in">
      <div className="text-[13px] tracking-[0.25em] text-text-faint mb-2">SAVE SESSION</div>
      <div className="text-xs text-text-faint mb-10">{timeRange}</div>
      <div className="w-48 h-48 rounded-full border-4 border-live flex flex-col items-center justify-center mb-12">
        <span className="font-display text-3xl font-semibold tabular-nums">{formatDuration(stopped.durationSeconds)}</span>
        <span className="text-xs text-text-faint mt-1">Total focus</span>
      </div>
      <div className="w-full max-w-xs flex flex-col gap-3">
        <Button variant="primary" className="w-full" onClick={onSave} disabled={busy}>
          Save
        </Button>
        <button onClick={onDelete} disabled={busy} className="text-sm text-danger font-medium py-2 disabled:opacity-40">
          Delete
        </button>
      </div>
    </div>
  )
}
