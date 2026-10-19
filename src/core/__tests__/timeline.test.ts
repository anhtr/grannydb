import { describe, expect, it } from 'vitest'
import { dayNumber, dayString, weekStart, weekdayIndex } from '../date'
import { squaresOverTime } from '../timeline'

describe('calendar days', () => {
  it('round-trips dates and rejects ones that are not real days', () => {
    expect(dayString(dayNumber('2026-10-18'))).toBe('2026-10-18')
    expect(dayNumber('2026-03-30') - dayNumber('2026-03-28')).toBe(2) // across a DST change
    expect(dayNumber('2026-02-31')).toBeNaN()
    expect(dayNumber('18/10/2026')).toBeNaN()
    expect(dayNumber('')).toBeNaN()
  })

  it('starts the week on Monday', () => {
    expect(weekdayIndex(dayNumber('2026-10-12'))).toBe(0) // Monday
    expect(weekdayIndex(dayNumber('2026-10-18'))).toBe(6) // Sunday
    expect(dayString(weekStart(dayNumber('2026-10-18')))).toBe('2026-10-12')
    expect(dayString(weekStart(dayNumber('2026-10-19')))).toBe('2026-10-19')
    expect(dayString(weekStart(dayNumber('1969-12-31')))).toBe('1969-12-29')
  })
})

describe('squaresOverTime', () => {
  it('returns null with nothing dated', () => {
    expect(squaresOverTime([], '2026-10-18')).toBeNull()
    expect(squaresOverTime(['', 'soon', '2026-11-01'], '2026-10-18')).toBeNull()
  })

  it('buckets by day and by Monday-start week, leaving out future dates', () => {
    // Sun 11th, Mon 12th ×2, Wed 14th, today Thu 15th, and one in the future.
    const result = squaresOverTime(
      ['2026-10-11', '2026-10-12', '2026-10-12', '2026-10-14', '2026-10-15', '2026-10-20'],
      '2026-10-15',
    )!
    expect(result.days.map((d) => d.count)).toEqual([1, 2, 0, 1, 1])
    expect(result.days.map((d) => d.cumulative)).toEqual([1, 3, 3, 4, 5])
    expect(result.weeks.map((w) => [dayString(w.start), w.count])).toEqual([
      ['2026-10-05', 1],
      ['2026-10-12', 4],
    ])
    expect(result.weeks[1].partial).toBe(true)
  })

  it('takes moving averages over complete periods only', () => {
    const result = squaresOverTime(['2026-10-12', '2026-10-12', '2026-10-13', '2026-10-14'], '2026-10-14')!
    // Window shrinks at the start: 2, then (2+1)/2. Today is partial and has none.
    expect(result.days.map((d) => d.average)).toEqual([2, 1.5, null])
    expect(result.weeks.map((w) => w.average)).toEqual([null])
  })

  it('extends the range back to the project start date', () => {
    const result = squaresOverTime(['2026-10-14'], '2026-10-14', '2026-09-28')!
    expect(dayString(result.days[0].day)).toBe('2026-09-28')
    expect(result.weeks.map((w) => w.count)).toEqual([0, 0, 1])
    expect(result.weeks.map((w) => w.average)).toEqual([0, 0, null])
  })

  it('averages each weekday over finished days, with this and last week alongside', () => {
    // Range Mon 5th – today Wed 14th.
    const result = squaresOverTime(
      ['2026-10-05', '2026-10-05', '2026-10-06', '2026-10-12', '2026-10-14'],
      '2026-10-14',
    )!
    const mon = result.weekdays[0]
    expect(mon).toEqual({ average: 1.5, thisWeek: 1, lastWeek: 2 })
    // Wednesday's only finished occurrence is last week's; today counts toward this week, not the average.
    expect(result.weekdays[2]).toEqual({ average: 0, thisWeek: 1, lastWeek: 0 })
    // Thursday hasn't come yet this week.
    expect(result.weekdays[3]).toEqual({ average: 0, thisWeek: null, lastWeek: 0 })
  })
})
