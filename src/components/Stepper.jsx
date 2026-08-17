export default function Stepper({ label, value, onChange, min = 0, max = 99, step = 1, suffix = '' }) {
  const dec = () => onChange(Math.max(min, value - step))
  const inc = () => onChange(Math.min(max, value + step))
  return (
    <div className="flex items-center justify-between py-3">
      <span className="text-sm text-text-dim">{label}</span>
      <div className="flex items-center gap-4">
        <button
          onClick={dec}
          disabled={value <= min}
          aria-label={`Decrease ${label}`}
          className="w-8 h-8 rounded-full bg-elevated border border-border text-text flex items-center justify-center disabled:opacity-30 active:scale-95 transition-transform"
        >
          −
        </button>
        <span className="w-16 text-center text-sm font-medium tabular-nums">
          {value}{suffix}
        </span>
        <button
          onClick={inc}
          disabled={value >= max}
          aria-label={`Increase ${label}`}
          className="w-8 h-8 rounded-full bg-elevated border border-border text-text flex items-center justify-center disabled:opacity-30 active:scale-95 transition-transform"
        >
          +
        </button>
      </div>
    </div>
  )
}
