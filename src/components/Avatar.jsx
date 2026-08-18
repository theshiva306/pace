import { useState } from 'react'
import { initials } from '../lib/format'

const SIZES = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-16 h-16 text-lg',
  xl: 'w-24 h-24 text-2xl',
}

export default function Avatar({ name, photoURL, size = 'md', live = false, showDot = true, className = '' }) {
  const dim = SIZES[size] || SIZES.md
  const [imageFailed, setImageFailed] = useState(false)

  return (
    <div className={`relative shrink-0 ${className}`}>
      {live && (
        <span className="absolute -inset-1 rounded-full bg-live/25 animate-breathe" aria-hidden />
      )}
      <div
        className={`relative ${dim} rounded-full overflow-hidden bg-elevated border border-border flex items-center justify-center font-display font-semibold text-text-dim`}
      >
        {photoURL && !imageFailed ? (
          <img
            src={photoURL}
            alt=""
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <span>{initials(name)}</span>
        )}
      </div>
      {live && showDot && (
        <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-live border-2 border-bg" aria-hidden />
      )}
    </div>
  )
}
