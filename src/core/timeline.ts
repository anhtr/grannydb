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

/** The trailing window the Pace tile averages over: the last 28 days, today included. */
export const PACE_WINDOW_DAYS = 28

export interface Pace {
  /** Squares per week over the last `windowDays` days, today included. */
  perWeek: number | null
  /** `PACE_WINDOW_DAYS`, or fewer when the project hasn't been running that long. */
  windowDays: number
  /** Squares per week across every day of the range, today included. */
  overallPerWeek: number | null
}

/**
 * The Progress screen's Pace tile: squares in the last 28 days, today included, as a weekly rate.
 *
 * Today counts as a full day on purpose. The tile then dips a little each morning, when a new and
 * still-empty day joins the window and a full one drops off the far end, and climbs back as the day's
 * squares are added — so it reads as "where today leaves me", which is the question it is glanced at
 * for. That is a different choice from the Over time card, whose averages leave today and the current
 * week out (ADR 0029): a chart shows a trend, where a dip that only reflects the time of day is noise.
 * The two numbers can therefore differ by a square or two, and are meant to.
 *
 * The window is a rolling 28 days, not four Monday–Sunday weeks, so it moves a day at a time rather
 * than jumping each Monday. It shrinks to the length of the range when the project is younger than
 * that, so a project in its second week isn't divided by four weeks and read as a quarter of its rate.
 */
export function paceOf(overTime: SquaresOverTime | null): Pace {
  if (!overTime) return { perWeek: null, windowDays: 0, overallPerWeek: null }
  const { days } = overTime
  const window = days.slice(-PACE_WINDOW_DAYS)
  const inWindow = window.reduce((sum, d) => sum + d.count, 0)
  return {
    perWeek: (inWindow / window.length) * 7,
    windowDays: window.length,
    overallPerWeek: (days[days.length - 1].cumulative / days.length) * 7,
  }
}
