// Glass-morphism skeleton primitives. Every loading state in the app
// (initial auth check, timer, groups list, group header) is built from
// these instead of a single lone dot, so slow connections show the actual
// shape of the content that's coming instead of an ambiguous pulse.
import { LogoMark } from './Logo'

export function SkelBlock({ className = '', rounded = 'rounded-xl' }) {
  return <div className={`skeleton-shell ${rounded} ${className}`} />
}

export function SkelCircle({ size = 40, className = '', rounded = 'rounded-full' }) {
  return (
    <div
      className={`skeleton-shell ${rounded} shrink-0 ${className}`}
      style={{ width: size, height: size }}
    />
  )
}

export function SkelLine({ width = '100%', className = '' }) {
  return <div className={`skeleton-shell rounded-md h-3 ${className}`} style={{ width }} />
}

// The brand mark, ticking — reused across the splash skeleton, the login
// screen, and the connection banner, so a slow load still feels like
// *the app*, not a generic spinner. Same glyph as the favicon and sidebar.
export function PaceMark({ size = 56, spinning = true }) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div className="absolute inset-0 rounded-full skeleton-shell" />
      <div className="absolute inset-0 flex items-center justify-center">
        <LogoMark size={size * 0.55} spinning={spinning} />
      </div>
    </div>
  )
}

// Full-screen splash used while auth state is still resolving (App.jsx)
// and as the base for the stuck-offline fallback.
export function AppSplashSkeleton({ children }) {
  return (
    <div className="min-h-svh flex flex-col items-center justify-center px-8 gap-6">
      <PaceMark size={52} />
      {children}
    </div>
  )
}

// Mirrors the Timer page's ring + pill layout so the transition from
// skeleton -> real content doesn't jump around.
export function TimerSkeleton() {
  return (
    <div className="min-h-svh flex flex-col items-center justify-center px-8 animate-fade-in">
      <SkelBlock className="h-8 w-40 mb-8" rounded="rounded-full" />
      <div
        className="skeleton-shell rounded-full flex items-center justify-center mb-10"
        style={{ width: 'min(62vw, 52svh, 300px)', aspectRatio: '1' }}
      >
        <PaceMark size={44} />
      </div>
      <SkelBlock className="h-12 w-full max-w-xs" rounded="rounded-xl" />
    </div>
  )
}

// Row placeholders for the Groups list while the initial `userGroups`
// fetch hasn't resolved yet — replaces the old instant "No groups yet"
// flash with something that honestly says "still checking".
export function GroupsListSkeleton({ rows = 3 }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3.5 bg-surface border border-border rounded-2xl pl-5 pr-14 py-4"
        >
          <SkelCircle size={36} rounded="rounded-xl" />
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            <SkelLine width="55%" />
            <SkelLine width="35%" className="h-2.5" />
          </div>
        </div>
      ))}
    </div>
  )
}

// Header placeholder for GroupDetail while group name/members are still
// streaming in, instead of flashing a bare "—" / "0 members".
export function GroupHeaderSkeleton() {
  return (
    <div className="flex items-center gap-3.5 mb-6">
      <SkelCircle size={48} rounded="rounded-xl" />
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <SkelLine width="45%" className="h-3.5" />
        <SkelLine width="28%" className="h-2.5" />
      </div>
    </div>
  )
}
