import { formatDuration } from './format'

// Leagues are pure rank on the weekly leaderboard, not fixed thresholds:
// #1 is Gold, #2 is Silver, #3 is Bronze, everyone else is unranked.
// "Ranked" here means memberList already sorted by seconds, descending.
// Tailwind needs full literal class names to detect and generate them, so
// these are spelled out in full here rather than built with string
// interpolation at the call site.
export const LEAGUES = [
  { name: 'Gold', textClass: 'text-league-gold', bgClass: 'bg-league-gold-soft', borderClass: 'border-league-gold/30', ringClass: 'ring-league-gold', chipClass: 'bg-league-gold' },
  { name: 'Silver', textClass: 'text-league-silver', bgClass: 'bg-league-silver-soft', borderClass: 'border-league-silver/30', ringClass: 'ring-league-silver', chipClass: 'bg-league-silver' },
  { name: 'Bronze', textClass: 'text-league-bronze', bgClass: 'bg-league-bronze-soft', borderClass: 'border-league-bronze/30', ringClass: 'ring-league-bronze', chipClass: 'bg-league-bronze' },
]
const UNRANKED = { name: 'Unranked', textClass: 'text-league-none', bgClass: 'bg-league-none-soft', borderClass: 'border-league-none/30' }

// Given the sorted-descending list and a uid, returns that member's league
// standing for the week: which league they're in (or 'Unranked'), and how
// far they are from the next league up. `final` (past, already-ended week)
// suppresses the "need more" framing since there's nothing left to chase.
export function leagueStatus(ranked, uid, { final = false } = {}) {
  const idx = ranked.findIndex((m) => m.uid === uid)
  if (idx === -1 || ranked.length === 0) return null

  if (idx < 3) {
    const league = LEAGUES[idx]
    if (idx === 0) {
      return { ...league, detail: final ? 'Finished on top' : 'Crushing it' }
    }
    const target = LEAGUES[idx - 1]
    const need = Math.max(0, (ranked[idx - 1]?.seconds || 0) - ranked[idx].seconds)
    return {
      ...league,
      detail: final
        ? `Just short of ${target.name}`
        : need > 0
          ? `${formatDuration(need)} for ${target.name}`
          : `Tied for ${target.name}`,
    }
  }

  const bronzeIdx = Math.min(2, ranked.length - 1)
  const bronzeSeconds = ranked[bronzeIdx]?.seconds || 0
  const need = Math.max(0, bronzeSeconds - ranked[idx].seconds)
  return {
    ...UNRANKED,
    detail: final
      ? 'Outside the leagues this week'
      : need > 0
        ? `${formatDuration(need)} for Bronze`
        : 'Tied for Bronze',
  }
}
