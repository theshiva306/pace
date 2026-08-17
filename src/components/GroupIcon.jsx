// Deterministic default icon for a group — no upload flow, but every group
// still gets a distinct, consistent glyph + gradient instead of a blank
// square, derived from its id so it never changes between renders.
const PALETTES = [
  ['#e0b567', '#8a5a24'],
  ['#5fd8a3', '#1f6b4c'],
  ['#7ba3f0', '#2b4a8f'],
  ['#b092e8', '#5b3f96'],
  ['#ec8ba0', '#96324a'],
  ['#9aa4b8', '#454c5c'],
]

const GLYPHS = [
  // flame
  (id) => (
    <path
      d="M12 3c1 2.4-.4 3.6-1.4 4.7C9.4 8.9 8.5 10 8.5 11.8a3.5 3.5 0 007 0c0-1-.5-1.7-1.1-2.4.9.4 2.1 1.6 2.1 3.6a4.5 4.5 0 01-9 0C7.5 9.4 10.6 7.6 12 3z"
      fill={`url(#${id})`}
    />
  ),
  // open book
  (id) => (
    <path
      d="M12 7.2c-1.3-1-3-1.5-4.8-1.5v9.8c1.8 0 3.5.5 4.8 1.5 1.3-1 3-1.5 4.8-1.5V5.7c-1.8 0-3.5.5-4.8 1.5z"
      fill="none"
      stroke={`url(#${id})`}
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
  ),
  // bolt
  (id) => (
    <path d="M13 3L6.5 13.5H11L10 21l7-11.5h-4.5L13 3z" fill={`url(#${id})`} />
  ),
  // target
  (id) => (
    <>
      <circle cx="12" cy="12" r="7" fill="none" stroke={`url(#${id})`} strokeWidth="1.6" />
      <circle cx="12" cy="12" r="3.6" fill="none" stroke={`url(#${id})`} strokeWidth="1.6" />
      <circle cx="12" cy="12" r="0.9" fill={`url(#${id})`} />
    </>
  ),
  // mountain
  (id) => (
    <path
      d="M3.5 17l5-8.5 3 4.5 1.8-2.5L20.5 17H3.5z"
      fill="none"
      stroke={`url(#${id})`}
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
  ),
  // hourglass
  (id) => (
    <path
      d="M7.5 4h9M7.5 20h9M8 4c0 3.2 2 4.8 4 6-2 1.2-4 2.8-4 6M16 4c0 3.2-2 4.8-4 6 2 1.2 4 2.8 4 6"
      fill="none"
      stroke={`url(#${id})`}
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
]

function hash(str = '') {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0
  }
  return h
}

const SIZES = {
  sm: 'w-9 h-9',
  md: 'w-12 h-12',
  lg: 'w-16 h-16',
}

export default function GroupIcon({ groupId = '', size = 'md', className = '' }) {
  const h = hash(groupId)
  const [from, to] = PALETTES[h % PALETTES.length]
  const Glyph = GLYPHS[Math.floor(h / PALETTES.length) % GLYPHS.length]
  const gradientId = `grp-icon-${groupId || 'default'}`
  const dim = SIZES[size] || SIZES.md

  return (
    <div
      className={`shrink-0 ${dim} rounded-xl overflow-hidden flex items-center justify-center ${className}`}
      style={{ background: `linear-gradient(135deg, ${from}22, ${to}33)`, border: `1px solid ${from}40` }}
    >
      <svg width="62%" height="62%" viewBox="0 0 24 24">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={from} />
            <stop offset="100%" stopColor={to} />
          </linearGradient>
        </defs>
        {Glyph(gradientId)}
      </svg>
    </div>
  )
}
