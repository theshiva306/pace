import { formatClock } from '../lib/format'

// The main clock, framed by a circular ring. When `totalSeconds` is known
// (countdown session, or a break with a fixed duration) the ring's arc
// fills to show real progress. When it's null (stopwatch, or no session
// yet) the ring stays a static outline — a frame, not a fake progress bar.
// Sized against the smaller of the viewport's width and height (via CSS
// min()), capped in px, so it's always prominent but can never force the
// page to scroll — on a short desktop window it shrinks with the height,
// not just the width. `children`, if given, renders as a small tappable
// link inside the ring, under the digits (e.g. "Take a break").
export function RingTimer({ label, displaySeconds, totalSeconds, isPaused, accent, children }) {
  const hasTotal = totalSeconds != null && totalSeconds > 0
  const pct = hasTotal ? Math.min(1, Math.max(0, displaySeconds / totalSeconds)) : 0
  const r = 46
  const c = 2 * Math.PI * r
  const dash = hasTotal ? c * pct : 0

  const ringColor = !hasTotal
    ? 'var(--color-border-soft)'
    : isPaused
      ? 'var(--color-text-faint)'
      : 'var(--color-accent)'

  const timeColor = isPaused ? 'text-text-faint' : accent || hasTotal ? 'text-accent' : 'text-text'

  // A round line-cap on a dasharray that spans the full circumference (no
  // progress target, or progress at exactly 100%) leaves a visible seam
  // right where the path's start and end meet — the cap "pokes out"
  // slightly past the seam. Flat caps have no such artifact and are
  // indistinguishable from round ones once the circle is fully closed
  // anyway, so only use round caps for a genuinely partial arc.
  const isFullOrEmpty = !hasTotal || pct <= 0 || pct >= 1
  const showProgress = hasTotal && pct > 0

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
        {showProgress && (
          <circle
            cx="50" cy="50" r={r} fill="none"
            stroke={ringColor}
            strokeWidth="3"
            strokeLinecap={isFullOrEmpty ? 'butt' : 'round'}
            strokeDasharray={`${dash} ${c}`}
            className="transition-[stroke-dasharray] duration-500 ease-linear"
          />
        )}
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
export function RingLink({ onClick, disabled, children }) {
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
