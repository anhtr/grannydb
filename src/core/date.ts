/** Today's date as `YYYY-MM-DD`, in the local timezone (not UTC, so it matches what the person sees). */
export function today(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * A `YYYY-MM-DD` date as a whole day number (days since 1970-01-01), or NaN if it isn't one.
 *
 * Calendar arithmetic is done on these integers rather than on `Date` objects: a date in the CSV is a
 * calendar day with no time or zone, and `Date` maths in local time loses or gains an hour at every
 * daylight-saving change, which is enough to push a square into the neighbouring day. Read through
 * `Date.UTC`, every day is exactly one apart.
 */
export function dayNumber(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return NaN
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const ms = Date.UTC(y, mo - 1, d)
  // Date.UTC rolls 2026-02-31 over into March; a date that doesn't round-trip isn't a real day.
  const check = new Date(ms)
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return NaN
  return ms / MS_PER_DAY
}

/** The inverse of `dayNumber`. */
export function dayString(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10)
}

/** Short day-and-month label for a chart axis, e.g. "18 Oct". */
export function dayLabel(day: number): string {
  return new Date(day * MS_PER_DAY).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/** Weekday names in week order — Monday first, see `weekdayIndex`. */
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/**
 * Position of a day within its week, **Monday = 0 … Sunday = 6**.
 *
 * Weeks start on Monday everywhere in this project, and this function and `weekStart` are the one
 * place that is decided — anything grouping by week goes through them rather than `Date#getDay`,
 * whose Sunday-is-0 convention is the US calendar's. (Day 0, 1970-01-01, was a Thursday.)
 */
export function weekdayIndex(day: number): number {
  return (((day + 3) % 7) + 7) % 7
}

/** The day number of the Monday that starts `day`'s week. */
export function weekStart(day: number): number {
  return day - weekdayIndex(day)
}
