const VARIANTS = {
  primary: 'bg-accent text-bg hover:brightness-110 active:brightness-95',
  ghost: 'bg-elevated text-text border border-border hover:border-text-faint',
  danger: 'bg-danger-soft text-danger border border-danger/30 hover:bg-danger/15',
  text: 'text-text-dim hover:text-text',
}

export default function Button({ children, variant = 'primary', className = '', ...props }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 font-medium text-sm tracking-wide rounded-xl px-5 py-3.5 transition-all duration-150 active:scale-[0.98] active:brightness-95 disabled:opacity-40 disabled:pointer-events-none ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
