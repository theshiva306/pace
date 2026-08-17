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
