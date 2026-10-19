import { dayNumber, weekStart, weekdayIndex } from './date'

/** Trailing windows the moving averages are taken over. */
export const WEEKLY_AVERAGE_WEEKS = 4
export const DAILY_AVERAGE_DAYS = 7

export interface DayPoint {
  day: number
  count: number
  /** Squares up to and including this day. */
  cumulative: number
  /** Trailing `DAILY_AVERAGE_DAYS` mean; null on today, which isn't over yet. */
  average: number | null
  /** Today: still being added to. */
  partial: boolean
}

export interface WeekPoint {
  /** Day number of the week's Monday. */
  start: number
  count: number
  /** Trailing `WEEKLY_AVERAGE_WEEKS` mean; null on the current week, which isn't over yet. */
  average: number | null
  partial: boolean
}

export interface WeekdayPoint {
  /** Mean squares on this weekday, over every *finished* occurrence of it in the range. */
  average: number
  /** Squares on this weekday in the current week; null if the day hasn't come yet. */
  thisWeek: number | null
  /** Squares on this weekday last week; null if that day falls before the range starts. */
  lastWeek: number | null
}

export interface SquaresOverTime {
  days: DayPoint[]
  weeks: WeekPoint[]
  /** Monday first. */
  weekdays: WeekdayPoint[]
}

/**
 * Trailing mean of `counts` at each index, over up to `window` entries. The window shrinks at the
 * start of the series rather than counting days before the project as zeros — the same reasoning as
 * the Pace tile's shrinking window: a project in its second week shouldn't read as half its real rate.
 */
function trailingMean(counts: number[], window: number): number[] {
  return counts.map((_, i) => {
    const from = Math.max(0, i - window + 1)
    let sum = 0
    for (let j = from; j <= i; j++) sum += counts[j]
    return sum / (i - from + 1)
  })
}

/**
 * Completed squares bucketed by day, by week and by weekday, from the dates on finished squares.
 *
 * The range runs from the project start date (or the first square, if that is earlier or there is no
 * start date) to `todayDate`. Squares dated after today are left out — a square isn't completed on a
 * day that hasn't happened. Malformed dates are left out too; `validate-data` is what flags them.
 *
 * Today and the current week are *partial*: still being added to. They are drawn, but every average
 * is taken over complete periods only, so a Monday morning doesn't drag the week's moving average
 * toward zero. That is also why the moving average for the partial period is null rather than a
 * number that would visibly dip and then recover as the day goes on.
 */
export function squaresOverTime(dates: string[], todayDate: string, startDate = ''): SquaresOverTime | null {
  const todayDay = dayNumber(todayDate)
  if (!Number.isFinite(todayDay)) return null
  const counted = dates.map(dayNumber).filter((d) => Number.isFinite(d) && d <= todayDay)
  if (counted.length === 0) return null

  const firstSquare = counted.reduce((m, d) => Math.min(m, d), Infinity)
  const projectStart = dayNumber(startDate)
  const first = Number.isFinite(projectStart) ? Math.min(projectStart, firstSquare) : firstSquare

  const dailyCounts = new Array<number>(todayDay - first + 1).fill(0)
  for (const d of counted) dailyCounts[d - first]++

  // Averages run over complete days only — today is excluded from the series they are taken over.
  const dailyAverages = trailingMean(dailyCounts.slice(0, -1), DAILY_AVERAGE_DAYS)
  let running = 0
  const days: DayPoint[] = dailyCounts.map((count, i) => {
    running += count
    const partial = i === dailyCounts.length - 1
    return { day: first + i, count, cumulative: running, average: partial ? null : dailyAverages[i], partial }
  })

  const firstWeek = weekStart(first)
  const thisWeek = weekStart(todayDay)
  const weeklyCounts = new Array<number>((thisWeek - firstWeek) / 7 + 1).fill(0)
  for (const d of counted) weeklyCounts[(weekStart(d) - firstWeek) / 7]++
  const weeklyAverages = trailingMean(weeklyCounts.slice(0, -1), WEEKLY_AVERAGE_WEEKS)
  const weeks: WeekPoint[] = weeklyCounts.map((count, i) => {
    const partial = i === weeklyCounts.length - 1
    return { start: firstWeek + i * 7, count, average: partial ? null : weeklyAverages[i], partial }
  })

  const totals = new Array<number>(7).fill(0)
  const occurrences = new Array<number>(7).fill(0)
  for (const point of days) {
    if (point.partial) continue
    totals[weekdayIndex(point.day)] += point.count
    occurrences[weekdayIndex(point.day)]++
  }
  const countOn = (day: number) => (day < first || day > todayDay ? null : dailyCounts[day - first])
  const weekdays: WeekdayPoint[] = totals.map((total, w) => ({
    average: occurrences[w] === 0 ? 0 : total / occurrences[w],
    thisWeek: countOn(thisWeek + w),
    lastWeek: countOn(thisWeek - 7 + w),
  }))

  return { days, weeks, weekdays }
}

export interface Pace {
  /** Mean squares per week over the last `windowWeeks` full weeks; null before the first full week. */
  perWeek: number | null
  /** How many full weeks `perWeek` averages — `WEEKLY_AVERAGE_WEEKS`, or fewer early in the project. */
  windowWeeks: number
  /** Squares per week across every full day of the range. */
  overallPerWeek: number | null
}

/**
 * The Progress screen's Pace tile, read off the same series the Over time card draws, so the tile and
 * the chart's latest moving-average point are one number rather than two that disagree.
 *
 * Recent pace is over full Monday–Sunday weeks, and overall pace over full days — today and the
 * current week are left out of both, for the reasons in ADR 0029. Overall pace is counted in days, not
 * weeks, because a project that started mid-week would otherwise carry its short first week in the
 * average forever; in the 4-week window that week drops out within a month.
 */
export function paceOf(overTime: SquaresOverTime | null): Pace {
  if (!overTime) return { perWeek: null, windowWeeks: 0, overallPerWeek: null }
  const complete = overTime.weeks.filter((w) => !w.partial)
  const windowWeeks = Math.min(WEEKLY_AVERAGE_WEEKS, complete.length)
  const fullDays = overTime.days.length - 1
  return {
    perWeek: complete.length > 0 ? complete[complete.length - 1].average : null,
    windowWeeks,
    overallPerWeek: fullDays > 0 ? (overTime.days[fullDays - 1].cumulative / fullDays) * 7 : null,
  }
}
