// Tracks whether the current "what's new" announcement has been shown.
// WHATS_NEW_ID identifies *this* announcement's content — bump it (to any
// new distinct string) whenever there's a new one to show. Comparing the
// stored id against the current one is what makes each new announcement
// show exactly once, without needing a fresh flag or component per
// feature: an old id on the device just won't match, so the new one
// shows again even if a previous announcement already did.
const SEEN_KEY = 'pace:whatsNew:seenId'
const WHATS_NEW_ID = 'schedule-and-semi-focus'

export function hasSeenLatestWhatsNew() {
  try {
    return localStorage.getItem(SEEN_KEY) === WHATS_NEW_ID
  } catch {
    return true // storage unavailable — don't nag on every load
  }
}

export function markWhatsNewSeen() {
  try {
    localStorage.setItem(SEEN_KEY, WHATS_NEW_ID)
  } catch {
    // Best-effort — worst case it shows again next visit.
  }
}
