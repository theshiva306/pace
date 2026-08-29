import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useActiveSession } from '../hooks/useActiveSession'
import { useSessionClock } from '../hooks/useSessionClock'
import { useMyGroups } from '../hooks/useMyGroups'
import { formatDuration } from '../lib/format'
import {
  startSession, pauseSession, resumeSession, startBreak, endBreak, stopSession, saveSession, clearActiveSession,
} from '../lib/sessions'
import { loadTimerSettings, saveTimerSettings } from '../lib/timerSettings'
import { fireAction } from '../lib/fireAction'
import { isStaleSession } from '../lib/staleSession'
import { playCompletionAlert } from '../lib/completionAlert'
import { TimerSkeleton } from '../components/Skeleton'
import { PinnedGroupPill, PinnedGroupLivePanel } from '../components/PinnedGroupPanel'
import { RingTimer, RingLink } from '../components/RingTimer'
import { SaveSessionScreen } from '../components/SaveSessionScreen'
import Sheet from '../components/Sheet'
import Button from '../components/Button'
import SegmentedControl from '../components/SegmentedControl'
import Stepper from '../components/Stepper'
import WheelColumn from '../components/WheelColumn'
import { ChevronRight, ExpandIcon, CollapseIcon } from '../components/icons'
import useFullscreen from '../hooks/useFullscreen'


const HOURS = Array.from({ length: 13 }, (_, i) => i) // 0-12
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5) // 0,5,...,55

export default function Timer() {
  const { user, profile, groupIds } = useAuth()
  const { isFullscreen, toggle: toggleFullscreen, supported: fullscreenSupported } = useFullscreen()
  const navigate = useNavigate()
  const session = useActiveSession()
  const clock = useSessionClock(session)
  // Server/device clock-skew-corrected "now" — see useServerOffset's
  // comment. Every write that does session-math (pause/resume/break/stop)
  // should use this instead of a raw Date.now(), or a skewed device clock
  // bakes a small permanent error into the banked/paused amounts at the
  // exact moment those actions happen.
  const serverNow = () => Date.now() + clock.offset

  const pinnedGroupId = profile?.pinnedGroupId || null
  const pinnedSummary = useMyGroups(pinnedGroupId ? [pinnedGroupId] : [])[0]

  const [settings, setSettings] = useState(() => loadTimerSettings())
  const [setupOpen, setSetupOpen] = useState(false)
  const [durationPickerOpen, setDurationPickerOpen] = useState(false)
  const [breaksPickerOpen, setBreaksPickerOpen] = useState(false)
  const [breakInfoOpen, setBreakInfoOpen] = useState(false)
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [pinnedPanelOpen, setPinnedPanelOpen] = useState(false)

  // Derived from Firebase, not tracked as separate local state — this
  // used to be its own useState, set independently in three different
  // places with nothing telling the database it had happened. See the
  // comment on stopSession() in lib/sessions.js for why that was the
  // root cause of a stopped session sometimes reappearing as still
  // running. Now there's exactly one source of truth: if the database
  // says stopped, this shows the save screen; if it doesn't, it doesn't
  // — survives reloads, reconnects, and remounts by construction.
  const stopped = session?.status === 'stopped'
    ? {
      session,
      durationSeconds: session.finalDurationSeconds ?? 0,
      startedAtMs: session.startedAt,
      endedAtMs: session.stoppedAt,
      wasStale: session.stopReason === 'stale',
    }
    : null

  // Sessions shorter than this are considered too short to be worth saving —
  // stopping one just ends it quietly instead of showing the save screen.
  const MIN_SAVEABLE_SECONDS = 60

  const loading = session === undefined
  const autoResumeFired = useRef(false)

  // Auto-resume once a break's own countdown reaches zero. Guarded so a
  // brief lag before Firebase's write comes back can't fire it twice.
  useEffect(() => {
    if (clock.isOnBreak && clock.breakRemaining <= 0 && !autoResumeFired.current) {
      autoResumeFired.current = true
      endBreak(user.uid, groupIds, serverNow())
    }
    if (!clock.isOnBreak) autoResumeFired.current = false
  // eslint-disable-next-line react-hooks/exhaustive-deps -- serverNow is a plain function recreated every render (reads clock.offset), not state; including it would just refire this on every unrelated render
  }, [clock.isOnBreak, clock.breakRemaining, user.uid, groupIds])

  // If a session was paused (or on a break) and simply abandoned — the
  // person closed the app, or forgot about it entirely — silently
  // resuming a possibly day-old pause would be confusing both for them
  // and for anyone in their groups seeing it as "live." Instead, route
  // it through the same save/discard screen a normal stop uses, so they
  // explicitly decide what happens to that leftover time before starting
  // anything new. Guarded so this only fires once per abandoned session,
  // not on every render while the resulting save screen is showing.
  const staleHandledRef = useRef(false)
  useEffect(() => {
    if (!session) { staleHandledRef.current = false; return }
    if (staleHandledRef.current || !isStaleSession(session, serverNow())) return
    staleHandledRef.current = true

    const durationSeconds = Math.round(clock.focusElapsed)

    if (durationSeconds < MIN_SAVEABLE_SECONDS) {
      fireAction(() => clearActiveSession(user.uid, groupIds))
      return
    }
    fireAction(() => stopSession(user.uid, groupIds, { durationSeconds, reason: 'stale', now: serverNow() }))
  // eslint-disable-next-line react-hooks/exhaustive-deps -- serverNow intentionally omitted, same reason as the effect above
  }, [session, clock.focusElapsed, user.uid, groupIds])

  // Countdown mode had no completion handling at all before this — once
  // the target was reached, the ring just clamped its display at 00:00
  // and sat there forever while the underlying session kept running
  // exactly like a stopwatch in the background, silently over-counting
  // with zero indication anything had happened. Reuses the same
  // save/discard flow a manual stop uses, so reaching the target behaves
  // like finishing, not like nothing happened. Guarded so it only fires
  // once per session, and skipped while paused/on a break — reaching the
  // target during a pause shouldn't yank someone out of it; it fires the
  // moment they're back to active with the effect re-running.
  const targetReachedRef = useRef(false)
  useEffect(() => {
    if (!session || session.mode !== 'countdown') { targetReachedRef.current = false; return }
    if (targetReachedRef.current) return
    if (session.status !== 'active') return
    if (clock.focusElapsed < session.targetSeconds) return
    targetReachedRef.current = true
    playCompletionAlert()
    // handleConfirmStop intentionally omitted from deps — it's a fresh
    // closure every render (reads busy/stopped/etc.), including it would
    // just refire this effect on every unrelated re-render; the ref guard
    // above is what actually prevents double-firing, not this array.
    handleConfirmStop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, clock.focusElapsed])

  async function handleStart(s) {
    if (busy || session) return
    setBusy(true)
    try {
      await fireAction(() => startSession(
        user.uid,
        groupIds,
        s.mode,
        s.mode === 'countdown' ? s.targetSeconds : null,
        s.breaksAllowed,
        s.breakDurationSeconds,
      ))
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
      if (clock.isPaused) await fireAction(() => resumeSession(user.uid, groupIds, serverNow()))
      else await fireAction(() => pauseSession(user.uid, groupIds, serverNow()))
    } finally {
      setBusy(false)
    }
  }

  async function handleTakeBreak() {
    if (busy || !session) return
    setBusy(true)
    try {
      await fireAction(() => startBreak(user.uid, groupIds, serverNow()))
      setBreakInfoOpen(false)
    } finally {
      setBusy(false)
    }
  }

  async function handleEndBreak() {
    if (busy || !session) return
    setBusy(true)
    try {
      await fireAction(() => endBreak(user.uid, groupIds, serverNow()))
    } finally {
      setBusy(false)
    }
  }

  async function handleConfirmStop() {
    if (!session || busy) return
    setStopConfirmOpen(false)
    setBuffering(true)
    const durationSeconds = Math.round(clock.focusElapsed)
    const stopNow = serverNow() // captured now, not 700ms later after the pause below
    // A short moment of stillness before the summary appears.
    await new Promise((resolve) => setTimeout(resolve, 700))

    // Too short to be worth saving — just end it, no save screen at all.
    if (durationSeconds < MIN_SAVEABLE_SECONDS) {
      try {
        await clearActiveSession(user.uid, groupIds)
      } catch {
        // If this fails (offline, etc.) the session just stays put and
        // will be picked up again next time the app opens — better than
        // silently pretending it's gone while it's actually still there.
      }
      setBuffering(false)
      return
    }

    try {
      await stopSession(user.uid, groupIds, { durationSeconds, reason: 'manual', now: stopNow })
    } catch {
      // Write failed (offline, etc.) — session just stays 'active' and
      // this can be tried again; nothing local to roll back since the
      // save screen is derived from Firebase, not set optimistically here.
    }
    setBuffering(false)
  }

  async function handleSave() {
    if (!stopped || busy) return
    setBusy(true)
    setSaveError(false)
    try {
      await saveSession({
        uid: user.uid,
        groupId: groupIds[0] ?? null,
        groupIds,
        session: stopped.session,
        durationSeconds: stopped.durationSeconds,
      })
      // No manual state to clear — saveSession removes the Firebase
      // session, useActiveSession's subscription picks that up, and
      // `stopped` (derived above) naturally becomes null on its own.
    } catch {
      // Leave the save screen showing and let them try again — hiding it
      // here would make it look saved when it might not be, with no way
      // back to that data afterward.
      setSaveError(true)
    } finally {
      setBusy(false)
    }
  }

  function handleDeleteRequest() {
    if (!stopped || busy) return
    setDeleteConfirmOpen(true)
  }

  async function handleConfirmDelete() {
    if (!stopped || busy) return
    setDeleteConfirmOpen(false)
    setBusy(true)
    setSaveError(false)
    try {
      await clearActiveSession(user.uid, groupIds)
    } catch {
      setSaveError(true)
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
    return <TimerSkeleton />
  }

  if (buffering) {
    return (
      <div className="min-h-svh flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <div className="w-2 h-2 rounded-full bg-accent animate-breathe" />
          <p className="text-xs text-text-faint">Saving session…</p>
        </div>
      </div>
    )
  }

  if (stopped) {
    return (
      <>
        <SaveSessionScreen stopped={stopped} busy={busy} error={saveError} onSave={handleSave} onDelete={handleDeleteRequest} />
        <Sheet open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)}>
          <div className="flex flex-col items-center text-center">
            <div className="text-base font-medium mb-2">Are you sure you want to delete this session?</div>
            <p className="text-xs text-text-faint mb-8">This can't be undone.</p>
            <div className="w-full flex flex-col gap-2.5">
              <Button variant="ghost" className="w-full" onClick={handleConfirmDelete} disabled={busy}>
                Delete
              </Button>
              <Button variant="text" className="w-full" onClick={() => setDeleteConfirmOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </Sheet>
      </>
    )
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
    <div className="h-svh flex flex-col items-center px-6 pt-[calc(env(safe-area-inset-top)+18px)] pb-[calc(env(safe-area-inset-bottom)+28px)] md:pb-10">
      {fullscreenSupported && (
        <button
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          className="fixed z-20 w-8 h-8 flex items-center justify-center text-text-faint hover:text-text active:scale-95 transition-all"
          style={{ top: 'calc(env(safe-area-inset-top) + 19px)', right: 'calc(env(safe-area-inset-right) + 14px)' }}
        >
          {isFullscreen ? <CollapseIcon width={16} height={16} /> : <ExpandIcon width={16} height={16} />}
        </button>
      )}

      {/* Fixed top row — always the first thing on the page, regardless of
          which state (idle/break/focusing) fills the space below it. */}
      <div className="w-full flex justify-center shrink-0">
        <PinnedGroupPill
          summary={pinnedSummary}
          onOpen={() => setPinnedPanelOpen(true)}
          onPinSomething={() => navigate('/groups')}
        />
      </div>

      {/* Opens as a popup (desktop) / bottom sheet (mobile) rather than
          navigating away — nothing should pull focus off this page while
          a session might be running. */}
      <Sheet open={pinnedPanelOpen} onClose={() => setPinnedPanelOpen(false)}>
        {pinnedGroupId && (
          <PinnedGroupLivePanel
            groupId={pinnedGroupId}
            currentUid={user.uid}
            onOpenGroup={() => {
              setPinnedPanelOpen(false)
              navigate(`/groups/${pinnedGroupId}`, { state: { tab: 'Live' } })
            }}
          />
        )}
      </Sheet>

      {/* Ring always centers in whatever vertical space is left between
          the top row and the bottom action row below. */}
      <div className="flex-1 min-h-0 w-full flex items-center justify-center">
        {!session && (
          <RingTimer label="READY" displaySeconds={0} totalSeconds={null} isPaused={false} />
        )}

        {session && clock.isOnBreak && (
          <RingTimer
            label="BREAK"
            displaySeconds={clock.breakRemaining}
            totalSeconds={session.breakDurationSeconds || null}
            isPaused={false}
            accent
          >
            <RingLink onClick={handleEndBreak} disabled={busy}>End break</RingLink>
          </RingTimer>
        )}

        {session && !clock.isOnBreak && (
          <RingTimer
            label={clock.isPaused ? 'PAUSED' : 'FOCUSING'}
            displaySeconds={displaySeconds}
            totalSeconds={session.mode === 'countdown' ? session.targetSeconds : null}
            isPaused={clock.isPaused}
          >
            {session.breaksAllowed > 0 && (
              <RingLink onClick={() => setBreakInfoOpen(true)} disabled={busy || breaksLeft <= 0}>
                Take a break
              </RingLink>
            )}
          </RingTimer>
        )}
      </div>

      {/* Action row — pinned just above the bottom nav (mobile) / bottom
          of the window (desktop), never drifting up next to the ring. */}
      <div className="w-full max-w-xs shrink-0 flex flex-col items-center gap-3 mb-[calc(env(safe-area-inset-bottom)+76px)] md:mb-0">
        {!session && (
          <>
            <button
              onClick={() => setSetupOpen(true)}
              className="text-xs text-text-faint underline decoration-dotted underline-offset-4"
            >
              {summaryText}
            </button>
            <button
              onClick={handleMainCta}
              disabled={busy}
              className="w-full bg-accent text-bg font-medium text-sm tracking-[0.1em] uppercase rounded-2xl py-4 shadow-[0_0_0_8px_var(--color-accent-soft)] active:scale-[0.98] transition-transform disabled:opacity-40"
            >
              Start Focus Now
            </button>
          </>
        )}

        {session && !clock.isOnBreak && (
          <div className="flex gap-3 w-full">
            <Button variant="ghost" className="flex-1" onClick={() => setStopConfirmOpen(true)}>
              Stop focusing
            </Button>
            <Button variant="ghost" className="flex-1" onClick={handleTogglePause} disabled={busy}>
              {clock.isPaused ? 'Resume' : 'Pause'}
            </Button>
          </div>
        )}
      </div>

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

// Live-group indicator above the ring. Shows the pinned group's name +
// live count and jumps straight to that group's Live tab on tap. If
// nothing is pinned, collapses to a quiet text link pointing at Groups
// instead of a pill, so there's nothing implying data that isn't there.
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
