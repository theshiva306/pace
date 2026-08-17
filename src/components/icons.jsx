// Small original line-icon set (24x24, stroke-based) — no third-party icon packs.
export function TimerIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="13" r="8" stroke="currentColor" strokeWidth={active ? 2.2 : 1.6} />
      <path d="M12 9v4l2.5 2" stroke="currentColor" strokeWidth={active ? 2.2 : 1.6} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.5 2.5h5" stroke="currentColor" strokeWidth={active ? 2.2 : 1.6} strokeLinecap="round" />
    </svg>
  )
}

export function GroupsIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="9" cy="8.5" r="3" stroke="currentColor" strokeWidth={active ? 2.2 : 1.6} />
      <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="currentColor" strokeWidth={active ? 2.2 : 1.6} strokeLinecap="round" />
      <circle cx="17" cy="7.5" r="2.4" stroke="currentColor" strokeWidth={active ? 2 : 1.4} opacity="0.75" />
      <path d="M15.2 12.2c2.6 0 4.6 1.8 5 4.4" stroke="currentColor" strokeWidth={active ? 2 : 1.4} strokeLinecap="round" opacity="0.75" />
    </svg>
  )
}

export function ProfileIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="3.6" stroke="currentColor" strokeWidth={active ? 2.2 : 1.6} />
      <path d="M4.8 19.5c0-3.7 3.2-6.3 7.2-6.3s7.2 2.6 7.2 6.3" stroke="currentColor" strokeWidth={active ? 2.2 : 1.6} strokeLinecap="round" />
    </svg>
  )
}

export function ChevronLeft(props) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M14.5 5.5L8 12l6.5 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ChevronRight(props) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M9.5 5.5L16 12l-6.5 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function PlusIcon(props) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export function SendIcon(props) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M4 12l16-7-6 16-2.5-6.5L4 12z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export function CopyIcon(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...props}>
      <rect x="8.5" y="8.5" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5.5 15V7a1.5 1.5 0 011.5-1.5h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function PinIcon(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M14 4v5c0 1.12.37 2.16 1 3H9c.65-.84 1-1.88 1-3V4h4m3-2H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3V4h1c.55 0 1-.45 1-1s-.45-1-1-1z" />
    </svg>
  )
}

export function SettingsIcon(props) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 3.5v2M12 18.5v2M4.9 6.4l1.4 1.4M17.7 16.2l1.4 1.4M3.5 12h2M18.5 12h2M4.9 17.6l1.4-1.4M17.7 7.8l1.4-1.4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function RefreshIcon(props) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="M19 12a7 7 0 10-2.3 5.2M19 12v-4.5M19 12h-4.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function ExitIcon(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M9 4H5.5A1.5 1.5 0 004 5.5v13A1.5 1.5 0 005.5 20H9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 8l4 4-4 4M18 12H9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function TrashIcon(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M5 7h14M9.5 7V5a1 1 0 011-1h3a1 1 0 011 1v2M7.5 7l.7 12a1.5 1.5 0 001.5 1.4h4.6a1.5 1.5 0 001.5-1.4l.7-12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ChevronDown(props) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M5.5 9.5L12 16l6.5-6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function InviteIcon(props) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="9.5" cy="8.5" r="3.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.2 19c0-3.3 2.8-5.6 6.3-5.6s6.3 2.3 6.3 5.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M18.5 6.3v5M16 8.8h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

// Solid shield-with-star badge used for league rank — colored via
// `currentColor` (pair with a text-league-* class), consistent whether it
// shows up small on a leaderboard row or large in the league summary card.
export function LeagueIcon(props) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="M12 2.4l6.8 2.5v5.3c0 4.9-2.9 8.4-6.8 10.6-3.9-2.2-6.8-5.7-6.8-10.6V4.9L12 2.4z"
        fill="currentColor"
      />
      <path
        d="M12 7.4l1.35 2.75 3.05.4-2.2 2.1.55 3.05L12 14.15l-2.75 1.55.55-3.05-2.2-2.1 3.05-.4L12 7.4z"
        fill="var(--color-bg)"
      />
    </svg>
  )
}

export function ShareIcon(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="18" cy="6" r="2.3" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="6" cy="12" r="2.3" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="18" cy="18" r="2.3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8.1 10.8L15.9 7M8.1 13.2l7.8 3.8" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}
