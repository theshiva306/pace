// Firebase's Realtime Database applies a write to its local, in-memory
// copy the instant you call set()/update() — onValue listeners fire with
// that result immediately, even with zero network connectivity. The
// promise those calls return, though, only resolves once the server has
// acknowledged the write, which on a slow or absent connection can hang
// for a long time (or until reconnect).
//
// UI actions like the Timer's pause/resume/start buttons only care about
// "did we tell Firebase to do this," not "did the server confirm it" —
// the local state, and therefore the UI, is already correct the moment
// the call is made. This wraps an action so its busy/disabled state
// clears on a short fixed delay instead of the network round-trip,
// keeping the timer responsive on flaky or offline connections while
// still guarding against accidental double-taps.
//
// Errors are swallowed here deliberately: Firebase queues the write and
// retries on its own once reconnected, so a rejected promise here almost
// always just means "still offline," not a real failure to surface.
export function fireAction(promiseFactory, { minBusyMs = 250 } = {}) {
  promiseFactory().catch(() => {})
  return new Promise((resolve) => setTimeout(resolve, minBusyMs))
}
