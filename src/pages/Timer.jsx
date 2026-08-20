import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useActiveSession } from '../hooks/useActiveSession'
import { useSessionClock } from '../hooks/useSessionClock'
import { useMyGroups } from '../hooks/useMyGroups'
import { usePolledValue } from '../hooks/usePolledValue'
import { formatClock, formatDuration, formatMessageTime } from '../lib/format'
import { dayId } from '../lib/day'
import {
  startSession, pauseSession, resumeSession, startBreak, endBreak, saveSession, clearActiveSession,
} from '../lib/sessions'
import { loadTimerSettings, saveTimerSettings } from '../lib/timerSettings'
import { fireAction } from '../lib/fireAction'
import { isStaleSession } from '../lib/staleSession'
import { Live } from './GroupDetail'
import { TimerSkeleton } from '../components/Skeleton'
import Sheet from '../components/Sheet'
import Button from '../components/Button'
import SegmentedControl from '../components/SegmentedControl'
import Stepper from '../components/Stepper'
import WheelColumn from '../components/WheelColumn'
import { ChevronRight, PinIcon, ExpandIcon, CollapseIcon } from '../components/icons'
import useFullscreen from '../hooks/useFullscreen'

const LIVE_POLL_MS = 60000

const HOURS = Array.from({ length: 13 }, (_, i) => i) // 0-12
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5) // 0,5,...,55

export default function Timer() {
  const { user, profile, groupIds } = useAuth()
  const { isFullscreen, toggle: toggleFullscreen, supported: fullscreenSupported } = useFullscreen()
  const navigate = useNavigate()
  const session = useActiveSession()
  const clock = useSessionClock(session)

  const pinnedGroupId = profile?.pinnedGroupId || null
  const pinnedSummary = useMyGroups(pinnedGroupId ? [pinnedGroupId] : [])[0]

  const [settings, setSettings] = useState(() => loadTimerSettings())
  const [setupOpen, setSetupOpen] = useState(false)
  const [durationPickerOpen, setDurationPickerOpen] = useState(false)
  const [breaksPickerOpen, setBreaksPickerOpen] = useState(false)
  const [breakInfoOpen, setBreakInfoOpen] = useState(false)
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [stopped, setStopped] = useState(null) // { session, durationSeconds, startedAtMs, endedAtMs }
  const [saveError, setSaveError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [pinnedPanelOpen, setPinnedPanelOpen] = useState(false)

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
      endBreak(user.uid, groupIds)
    }
    if (!clock.isOnBreak) autoResumeFired.current = false
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
    if (staleHandledRef.current || !isStaleSession(session, Date.now())) return
    staleHandledRef.current = true

    const durationSeconds = Math.round(clock.focusElapsed)
    const startedAtMs = session.startedAt
    const endedAtMs = session.pausedAt || Date.now()

    if (durationSeconds < MIN_SAVEABLE_SECONDS) {
      fireAction(() => clearActiveSession(user.uid, groupIds))
      return
    }
    setStopped({ session, durationSeconds, startedAtMs, endedAtMs, wasStale: true })
  }, [session, clock.focusElapsed, user.uid, groupIds])

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
      if (clock.isPaused) await fireAction(() => resumeSession(user.uid, groupIds))
      else await fireAction(() => pauseSession(user.uid, groupIds))
    } finally {
      setBusy(false)
    }
  }

  async function handleTakeBreak() {
    if (busy || !session) return
    setBusy(true)
    try {
      await fireAction(() => startBreak(user.uid, groupIds))
      setBreakInfoOpen(false)
    } finally {
      setBusy(false)
    }
  }

  async function handleEndBreak() {
    if (busy || !session) return
    setBusy(true)
    try {
      await fireAction(() => endBreak(user.uid, groupIds))
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

    setStopped({ session, durationSeconds, startedAtMs, endedAtMs })
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
      setStopped(null)
    } catch {
      // Leave `stopped` in place and let them try again — dismissing the
      // screen here would make it look saved when it might not be, with
      // no way back to that data afterward.
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
      setStopped(null)
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
      {/* Fixed top row — always the first thing on the page, regardless of
          which state (idle/break/focusing) fills the space below it. */}
      <div className="w-full relative flex justify-center shrink-0">
        <PinnedGroupPill
          summary={pinnedSummary}
          onOpen={() => setPinnedPanelOpen(true)}
          onPinSomething={() => navigate('/groups')}
        />
        {fullscreenSupported && (
          <button
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            className="absolute right-0 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg bg-elevated border border-border flex items-center justify-center text-text-dim hover:text-text active:scale-95 transition-all"
          >
            {isFullscreen ? <CollapseIcon /> : <ExpandIcon />}
          </button>
        )}
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
function PinnedGroupPill({ summary, onOpen, onPinSomething }) {
  if (!summary) {
    return (
      <button
        onClick={onPinSomething}
        className="flex items-center gap-1.5 text-xs text-text-faint mb-8 py-1"
      >
        <PinIcon />
        <span className="underline decoration-dotted underline-offset-4">Pin a group to see who's live</span>
      </button>
    )
  }

  const liveCount = summary.liveCount ?? 0

  return (
    <button
      onClick={onOpen}
      className="flex items-center gap-2.5 bg-elevated border border-border rounded-full pl-2.5 pr-3.5 py-2 mb-8 max-w-[86vw] active:scale-[0.97] transition-transform"
    >
      <span className="relative flex items-center justify-center w-4 h-4 shrink-0">
        {liveCount > 0 && <span className="absolute inset-0 rounded-full bg-live/25 animate-breathe" />}
        <span className={`relative w-1.5 h-1.5 rounded-full ${liveCount > 0 ? 'bg-live' : 'bg-text-faint'}`} />
      </span>
      <span className="text-xs font-semibold truncate max-w-[38vw]">{summary.name || '—'}</span>
      <span className="w-px h-3 bg-border shrink-0" />
      <span className="text-xs text-text-dim whitespace-nowrap">{liveCount} focusing</span>
      <ChevronRight className="w-3.5 h-3.5 text-text-faint shrink-0" />
    </button>
  )
}

// Content of the pinned-group popup/sheet: the pinned group's Live view
// (who's focusing + today's totals), reusing GroupDetail's Live component
// so the two stay visually identical. Polled, not real-time, same as the
// group page's own Live tab.
function PinnedGroupLivePanel({ groupId, currentUid, onOpenGroup }) {
  const todayId = dayId()
  const name = usePolledValue(`groups/${groupId}/name`, { intervalMs: LIVE_POLL_MS })
  const members = usePolledValue(`groups/${groupId}/members`, { intervalMs: LIVE_POLL_MS })
  const live = usePolledValue(`groups/${groupId}/live`, { intervalMs: LIVE_POLL_MS })
  const daily = usePolledValue(`groups/${groupId}/dailyTotals/${todayId}`, { intervalMs: LIVE_POLL_MS })

  const memberList = Object.entries(members.value || {}).map(([uid, m]) => ({ uid, ...m }))

  function refresh() {
    name.refresh()
    members.refresh()
    live.refresh()
    daily.refresh()
  }

  return (
    <div>
      <div className="text-center font-display font-semibold uppercase text-sm tracking-tight mb-4 truncate">
        {name.value || '—'}
      </div>
      <Live
        memberList={memberList}
        live={live.value || {}}
        totals={daily.value || {}}
        currentUid={currentUid}
        onRefresh={refresh}
        refreshing={name.refreshing || members.refreshing || live.refreshing || daily.refreshing}
        updatedAt={live.updatedAt}
      />
      <button
        onClick={onOpenGroup}
        className="w-full text-center text-xs text-text-faint underline decoration-dotted underline-offset-4 mt-6"
      >
        Open full group page
      </button>
    </div>
  )
}

// The main clock, framed by a circular ring. When `totalSeconds` is known
// (countdown session, or a break with a fixed duration) the ring's arc
// fills to show real progress. When it's null (stopwatch, or no session
// yet) the ring stays a static outline — a frame, not a fake progress bar.
// Sized against the smaller of the viewport's width and height (via CSS
// min()), capped in px, so it's always prominent but can never force the
// page to scroll — on a short desktop window it shrinks with the height,
// not just the width. `children`, if given, renders as a small tappable
// link inside the ring, under the digits (e.g. "Take a break").
function RingTimer({ label, displaySeconds, totalSeconds, isPaused, accent, children }) {
  const hasTotal = totalSeconds != null && totalSeconds > 0
  const pct = hasTotal ? Math.min(1, Math.max(0, displaySeconds / totalSeconds)) : 0
  const r = 46
  const c = 2 * Math.PI * r
  const dash = hasTotal ? c * pct : c

  const ringColor = !hasTotal
    ? 'var(--color-border-soft)'
    : isPaused
      ? 'var(--color-text-faint)'
      : 'var(--color-accent)'

  const timeColor = isPaused ? 'text-text-faint' : accent || hasTotal ? 'text-accent' : 'text-text'

  return (
    <div
      className="relative flex items-center justify-center shrink-0"
      style={{ width: 'min(62vw, 52svh, 300px)', aspectRatio: '1' }}
    >
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 w-full h-full -rotate-90 overflow-visible pointer-events-none"
      >
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-border-soft)" strokeWidth="3" />
        <circle
          cx="50" cy="50" r={r} fill="none"
          stroke={ringColor}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          className="transition-[stroke-dasharray] duration-500 ease-linear"
        />
      </svg>
      <div className="relative z-10 flex flex-col items-center justify-center w-[74%] px-1">
        <div className="text-[11px] tracking-[0.28em] text-text-faint mb-2 whitespace-nowrap">
          {label}
        </div>
        <div
          className={`font-display font-semibold tabular-nums leading-none select-none whitespace-nowrap ${timeColor}`}
          style={{ fontSize: 'clamp(1.9rem, 7.5vw, 2.9rem)' }}
        >
          {formatClock(displaySeconds)}
        </div>
        {children && <div className="mt-4">{children}</div>}
      </div>
    </div>
  )
}

// A quiet, text-only action that lives inside the ring (e.g. "Take a
// break" / "End break"). Underlined so it always reads as tappable;
// brightens on hover so a mouse user gets a clear affordance too.
function RingLink({ onClick, disabled, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-[13px] font-medium text-text-dim underline decoration-dotted underline-offset-4 hover:text-accent transition-colors disabled:opacity-30 disabled:pointer-events-none"
    >
      {children}
    </button>
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

function SaveSessionScreen({ stopped, busy, error, onSave, onDelete }) {
  const timeRange = `${formatMessageTime(stopped.startedAtMs)} – ${formatMessageTime(stopped.endedAtMs)}`
  return (
    <div className="min-h-svh flex flex-col items-center justify-center px-8 text-center animate-fade-in">
      <div className="text-[13px] tracking-[0.25em] text-text-faint mb-2">
        {stopped.wasStale ? 'PAUSED SESSION FOUND' : 'SAVE SESSION'}
      </div>
      {stopped.wasStale && (
        <p className="text-xs text-text-faint max-w-[240px] mb-4 leading-relaxed">
          You paused this a while ago and it looks like it got left behind — save the time or discard it.
        </p>
      )}
      <div className="text-xs text-text-faint mb-10">{timeRange}</div>
      <div className="w-48 h-48 rounded-full border-4 border-live flex flex-col items-center justify-center mb-12">
        <span className="font-display text-3xl font-semibold tabular-nums">{formatDuration(stopped.durationSeconds)}</span>
        <span className="text-xs text-text-faint mt-1">Total focus</span>
      </div>
      {error && (
        <p className="text-xs text-danger mb-4 max-w-[240px]">
          Couldn't reach the server — check your connection and try again. Nothing's been lost yet.
        </p>
      )}
      <div className="w-full max-w-xs flex flex-col gap-3">
        <Button variant="primary" className="w-full" onClick={onSave} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <button onClick={onDelete} disabled={busy} className="text-sm text-danger font-medium py-2 disabled:opacity-40">
          Delete
        </button>
      </div>
    </div>
  )
}
