import { useEffect } from 'react'
import { CloseIcon } from './icons'

// Bottom sheet on mobile, centered modal on desktop. Backdrop click closes,
// and so does the close button — the button matters most on mobile, where
// a tall sheet can fill nearly the whole screen and leave no visible
// backdrop left to tap. It sits outside the scrolling content area so it
// stays put at the top-right corner no matter how far the content scrolls
// or how much of the screen the sheet takes up.
export default function Sheet({ open, onClose, children }) {
  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    const previousOverscroll = document.body.style.overscrollBehavior
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'
    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.overscrollBehavior = previousOverscroll
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center overscroll-none">
      <div className="absolute inset-0 bg-black/60 animate-fade-in" onClick={onClose} />
      <div className="relative w-full md:w-[400px] max-h-[calc(100dvh-8px)] flex flex-col bg-surface border border-border md:rounded-3xl rounded-t-3xl animate-sheet-up md:animate-rise">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3.5 top-3.5 z-10 text-text-faint hover:text-text bg-elevated border border-border rounded-full p-1.5"
        >
          <CloseIcon width="14" height="14" />
        </button>
        <div className="min-h-0 overflow-y-auto overscroll-contain no-scrollbar p-6 pb-[calc(env(safe-area-inset-bottom)+24px)] md:pb-6">
          <div className="md:hidden w-9 h-1 rounded-full bg-border mx-auto mb-5" />
          {children}
        </div>
      </div>
    </div>
  )
}
