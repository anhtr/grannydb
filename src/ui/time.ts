const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['second', 1000],
  ['minute', 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
]

const format = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' })

/**
 * "3 hours ago", for saying how old the data on screen is.
 *
 * Deliberately coarse: the useful question offline is "is this this morning's data or last week's",
 * and a live-updating "47 seconds ago" is noise. Anything over a week gets an absolute date, since
 * "22 days ago" is harder to place than the day itself.
 */
export function relativeTime(ts: number, now: number = Date.now()): string {
  const elapsed = ts - now
  const magnitude = Math.abs(elapsed)

  if (magnitude < 45 * 1000) return 'just now'
  if (magnitude > 7 * 24 * 60 * 60 * 1000) return new Date(ts).toLocaleDateString('en-GB')

  let chosen: [Intl.RelativeTimeFormatUnit, number] = UNITS[0]
  for (const unit of UNITS) if (magnitude >= unit[1]) chosen = unit
  return format.format(Math.round(elapsed / chosen[1]), chosen[0])
}
