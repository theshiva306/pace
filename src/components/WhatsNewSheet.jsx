import { useEffect, useState } from 'react'
import Sheet from './Sheet'
import Button from './Button'
import { hasSeenLatestWhatsNew, markWhatsNewSeen } from '../lib/whatsNew'
import { ScheduleIcon } from './icons'

export default function WhatsNewSheet() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!hasSeenLatestWhatsNew()) setOpen(true)
  }, [])

  function handleClose() {
    markWhatsNewSeen()
    setOpen(false)
  }

  return (
    <Sheet open={open} onClose={handleClose}>
      <div className="flex flex-col gap-5">
        <div className="text-[13px] tracking-[0.25em] text-text-faint text-center">WHAT'S NEW</div>

        <div className="flex flex-col gap-4">
          <div className="flex gap-3 items-start">
            <div className="w-9 h-9 rounded-lg bg-accent-soft text-accent flex items-center justify-center shrink-0">
              <ScheduleIcon active />
            </div>
            <div>
              <div className="text-sm font-medium">Schedule tab</div>
              <p className="text-xs text-text-dim mt-0.5 leading-relaxed">
                Plan your day into blocks and see how closely you actually
                stuck to it. There's a ? on that tab that walks through the
                details.
              </p>
            </div>
          </div>

          <div className="flex gap-3 items-start">
            <div className="w-9 h-9 rounded-lg bg-semi-soft flex items-center justify-center shrink-0">
              <span className="w-2.5 h-2.5 rounded-full bg-semi" />
            </div>
            <div>
              <div className="text-sm font-medium">Semi-focus sessions</div>
              <p className="text-xs text-text-dim mt-0.5 leading-relaxed">
                For lectures, tests, or anything you don't want in your group
                rankings — pick it when starting a session and it stays
                completely private from your groups.
              </p>
            </div>
          </div>
        </div>

        <Button variant="primary" className="w-full" onClick={handleClose}>Got it</Button>
      </div>
    </Sheet>
  )
}
