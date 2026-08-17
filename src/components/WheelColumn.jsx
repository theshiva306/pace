import { useEffect, useRef } from 'react'

// A tap-to-select scrollable column styled like a picker wheel. Deliberately
// simpler than true scroll-snap physics (no momentum, no drag tracking) so
// it behaves the same across every browser — tap a value, it's selected.
export default function WheelColumn({ values, selected, onSelect, suffix = '' }) {
  const selectedRef = useRef(null)

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'center' })
    // Only run on mount — once open, scrolling shouldn't jump around as
    // the person taps different values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="h-44 w-24 overflow-y-auto no-scrollbar rounded-xl bg-elevated border border-border py-16">
      {values.map((v) => {
        const active = v === selected
        return (
          <button
            key={v}
            ref={active ? selectedRef : null}
            onClick={() => onSelect(v)}
            className="w-full py-1 flex items-center justify-center"
          >
            <span
              className={`text-sm font-medium tabular-nums px-3 py-1.5 rounded-full transition-colors ${
                active ? 'bg-accent text-bg' : 'text-text-faint'
              }`}
            >
              {v}{suffix}
            </span>
          </button>
        )
      })}
    </div>
  )
}
