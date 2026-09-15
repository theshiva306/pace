import { useEffect, useState } from 'react'
import Sheet from './Sheet'
import Button from './Button'
import {
  bumpVisitAndShouldPrompt, recordPromptShownNow, dismissPromptForever, setEnabledByUser,
} from '../lib/notificationPrefs'
import { hasSeenLatestWhatsNew } from '../lib/whatsNew'
import { requestNotificationPermissionIfNeeded } from '../hooks/useSessionNotification'

export default function NotificationPromptSheet() {
  const [open, setOpen] = useState(false)
  const [dismissedMessage, setDismissedMessage] = useState(false)

  useEffect(() => {
    // Let the what's-new sheet have the screen to itself on a visit where
    // both would otherwise fire — this one just waits for the next visit
    // instead of stacking on top of it.
    if (!hasSeenLatestWhatsNew()) return
    if (bumpVisitAndShouldPrompt()) setOpen(true)
  }, [])

  async function handleTurnOn() {
    recordPromptShownNow()
    await requestNotificationPermissionIfNeeded()
    if (Notification.permission === 'granted') setEnabledByUser(true)
    setOpen(false)
  }

  function handleLater() {
    recordPromptShownNow()
    setOpen(false)
  }

  function handleDontAskAgain() {
    recordPromptShownNow()
    dismissPromptForever()
    setDismissedMessage(true)
  }

  return (
    <Sheet open={open} onClose={handleLater}>
      {dismissedMessage ? (
        <div className="flex flex-col items-center text-center">
          <div className="text-base font-medium mb-2">Got it</div>
          <p className="text-xs text-text-faint mb-6">
            You can turn notifications on anytime from Profile.
          </p>
          <Button variant="primary" className="w-full" onClick={() => setOpen(false)}>
            Okay
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center text-center">
          <div className="text-base font-medium mb-2">Stay on track</div>
          <p className="text-xs text-text-faint mb-8">
            Get a notification while a session is running, with a quick Pause/Resume button — even if Pace isn't open.
          </p>
          <div className="w-full flex flex-col gap-2.5">
            <Button variant="primary" className="w-full" onClick={handleTurnOn}>
              Turn on
            </Button>
            <Button variant="ghost" className="w-full" onClick={handleLater}>
              Later
            </Button>
            <Button variant="text" className="w-full" onClick={handleDontAskAgain}>
              Don't ask again
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  )
}
