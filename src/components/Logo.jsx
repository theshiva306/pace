// The one canonical Pace mark — a clock ring with a running hand. Used
// everywhere the brand needs to show up (favicon, sidebar, login, loading
// states) so it's always the same glyph instead of a different treatment
// per screen. `spinning` gives it a slow tick, used in loading contexts;
// static everywhere else (nav, login).
export function LogoMark({ size = 24, spinning = false, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
    >
      <circle cx="12" cy="12" r="9" stroke="var(--color-accent)" strokeWidth="2" />
      <path
        d="M12 7v5l3 2"
        stroke="var(--color-accent)"
        strokeWidth="2"
        strokeLinecap="round"
        className={spinning ? 'animate-orbit origin-center' : ''}
      />
    </svg>
  )
}

// Mark + wordmark, for places branding should read clearly (sidebar,
// login). `size` controls the mark; the wordmark scales relative to it.
export function Logo({ size = 22, spinning = false, className = '', textClassName = '' }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <LogoMark size={size} spinning={spinning} />
      <span className={`font-display font-semibold tracking-tight ${textClassName || 'text-lg'}`}>
        Pace
      </span>
    </div>
  )
}
