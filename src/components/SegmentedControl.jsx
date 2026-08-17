export default function SegmentedControl({ options, value, onChange }) {
  return (
    <div className="flex items-center gap-1 bg-elevated border border-border rounded-xl p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`flex-1 text-sm font-medium py-2.5 rounded-lg transition-colors ${
            value === opt.value ? 'bg-surface text-text' : 'text-text-faint'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
