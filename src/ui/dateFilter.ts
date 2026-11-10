import { dayNumber, dayString, weekStart } from '../core/date'

/**
 * The pure half of a list's date filter (the control is `DateFilter` in `RecordList.tsx`).
 *
 * A selection is `[from, to]` in the same `string[]` slot every filter saves to, both ends
 * inclusive, `''` at either end meaning unbounded - the shape a numeric range already uses. The ends
 * are absolute `YYYY-MM-DD` dates even when they came from a shortcut such as "This month"; see
 * ADR 0038 for why the shortcut itself is not what is saved.
 */

/** A saved selection as its two ends, as typed. A one-item list reads as "from that day on". */
export function readDateRange(values: string[]): { from: string; to: string } {
  const [from = '', to = ''] = values
  return { from, to }
}

/** The selection to save for these ends - empty, meaning "no filter", when neither is set. */
export function dateSelection(from: string, to: string): string[] {
  return from === '' && to === '' ? [] : [from, to]
}

/**
 * The ends in order. Typed the wrong way round is still an unambiguous question, so it is answered
 * instead of matching nothing - but here, on reading, not by swapping what is saved: a date box
 * reports half-typed years ("0002", "0020") on its way to "2026", and swapping on those would move
 * the text out from under the person typing it.
 */
function orderedRange(values: string[]): { from: string; to: string } {
  const { from, to } = readDateRange(values)
  return from !== '' && to !== '' && from > to ? { from: to, to: from } : { from, to }
}

/**
 * Whether a row's date falls inside the selection. A blank date is outside every range: "done this
 * month" must not list the squares that are not done. ISO dates order the same as strings, so no
 * parsing is needed.
 */
export function dateMatches(value: string, values: string[]): boolean {
  const { from, to } = orderedRange(values)
  if (from === '' && to === '') return true
  if (value === '') return false
  return (from === '' || value >= from) && (to === '' || value <= to)
}

/** What a selection reads as next to its label, and on its chip. */
export function dateSummary(values: string[]): string {
  const { from, to } = orderedRange(values)
  if (from === '' && to === '') return 'Any'
  if (from === to) return from
  if (to === '') return `from ${from}`
  if (from === '') return `until ${to}`
  return `${from} to ${to}`
}

export interface DatePreset {
  label: string
  from: string
  to: string
}

/**
 * One-tap ranges, worked out from `today` (the project's today, so every device agrees which month
 * it is). Weeks start on Monday, like everywhere else in the app.
 */
export function datePresets(today: string): DatePreset[] {
  const day = dayNumber(today)
  if (Number.isNaN(day)) return []
  const monday = weekStart(day)
  const [year, month] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))]
  const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`
  return [
    { label: 'This week', from: dayString(monday), to: dayString(monday + 6) },
    { label: 'This month', from: `${today.slice(0, 8)}01`, to: dayString(dayNumber(nextMonth) - 1) },
    { label: 'Last 30 days', from: dayString(day - 29), to: today },
  ]
}
