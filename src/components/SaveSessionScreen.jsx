import { formatDuration, formatMessageTime } from '../lib/format'
import Button from './Button'

export function SaveSessionScreen({ stopped, busy, error, onSave, onDelete }) {
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
