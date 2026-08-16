// Bottom sheet on mobile, centered modal on desktop. Backdrop click closes.
export default function Sheet({ open, onClose, children }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 animate-fade-in"
        onClick={onClose}
      />
      <div className="relative w-full md:w-[400px] bg-surface border border-border md:rounded-3xl rounded-t-3xl p-6 pb-[calc(env(safe-area-inset-bottom)+24px)] md:pb-6 animate-sheet-up md:animate-rise">
        <div className="md:hidden w-9 h-1 rounded-full bg-border mx-auto mb-5" />
        {children}
      </div>
    </div>
  )
}
