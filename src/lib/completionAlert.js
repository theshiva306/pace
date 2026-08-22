// A countdown timer's whole point is often to let someone stop watching
// the screen — silently transitioning to the save screen when the target
// is reached defeats that if they're not looking. No permission prompt
// needed for either of these (unlike the Notifications API), so this can
// just fire immediately without asking first.
export function playCompletionAlert() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (AudioCtx) {
      const ctx = new AudioCtx()
      const playTone = (freq, startTime, duration) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.value = freq
        gain.gain.setValueAtTime(0, startTime)
        gain.gain.linearRampToValueAtTime(0.2, startTime + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(startTime)
        osc.stop(startTime + duration)
      }
      const now = ctx.currentTime
      playTone(880, now, 0.18)
      playTone(1108, now + 0.18, 0.22)
    }
  } catch {
    // Some browsers block audio without a prior user gesture, or don't
    // support the Web Audio API at all — the session still completes
    // and shows the save screen either way, this is purely a nice-to-have.
  }

  try {
    navigator.vibrate?.([120, 60, 120])
  } catch {
    // Unsupported on this device/browser — silently skip.
  }
}
