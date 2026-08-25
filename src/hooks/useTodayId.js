import { useEffect, useState } from 'react'
import { dayId, msUntilDayEnd } from '../lib/day'

// A live, single source of truth for "what day is it right now." Anything
// that needs today's date — daily totals, week-boundary checks — should
// read from this, not call dayId() once and memoize/store the result.
//
// That exact mistake (`useMemo(() => dayId(), [])`, computed once at
// mount and never again) was the root cause of a real bug: leaving the
// app open across midnight — completely normal for a PWA someone doesn't
// force-close — froze "today" at whatever day it was when the page
// loaded. The permanent, saved total kept being read from that frozen
// old day's bucket, while the *live* portion of the same total (added on
// top for an in-progress session) correctly recalculated its own current
// day independently — so the two halves of one number silently drifted
// onto different days and got added together. Someone who studied
// Monday and was now on Tuesday would see Monday's saved total plus
// Tuesday's live total, summed, with no indication anything was wrong.
//
// Scheduled to flip over at the exact moment local midnight passes
// (via msUntilDayEnd), not polled — precise and near-zero overhead.
export function useTodayId() {
  const [todayId, setTodayId] = useState(() => dayId())

  useEffect(() => {
    let timeoutId
    function scheduleNextRollover() {
      // +1s safety margin past the exact boundary — avoids a race where
      // the timeout fires a moment early (clock drift, timer coalescing)
      // and dayId() still evaluates to the old day.
      timeoutId = setTimeout(() => {
        setTodayId(dayId())
        scheduleNextRollover()
      }, msUntilDayEnd() + 1000)
    }
    scheduleNextRollover()
    return () => clearTimeout(timeoutId)
  }, [])

  return todayId
}
