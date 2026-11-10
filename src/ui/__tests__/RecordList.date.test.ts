import { describe, expect, it } from 'vitest'
import { dateMatches, datePresets, dateSelection, dateSummary, readDateRange } from '../dateFilter'

describe('date filters', () => {
  it('saves nothing when neither end is set', () => {
    expect(dateSelection('', '')).toEqual([])
    expect(dateMatches('2026-11-10', [])).toBe(true)
    expect(dateMatches('', [])).toBe(true)
  })

  it('includes both ends', () => {
    const range = dateSelection('2026-11-01', '2026-11-30')
    expect(dateMatches('2026-11-01', range)).toBe(true)
    expect(dateMatches('2026-11-30', range)).toBe(true)
    expect(dateMatches('2026-10-31', range)).toBe(false)
    expect(dateMatches('2026-12-01', range)).toBe(false)
  })

  it('leaves an unset end unbounded', () => {
    expect(dateMatches('2030-01-01', dateSelection('2026-11-01', ''))).toBe(true)
    expect(dateMatches('2026-10-31', dateSelection('2026-11-01', ''))).toBe(false)
    expect(dateMatches('2020-01-01', dateSelection('', '2026-11-01'))).toBe(true)
    expect(dateMatches('2026-11-02', dateSelection('', '2026-11-01'))).toBe(false)
  })

  it('never matches a blank date once a range is set', () => {
    expect(dateMatches('', dateSelection('2026-11-01', ''))).toBe(false)
    expect(dateMatches('', dateSelection('', '2026-11-01'))).toBe(false)
  })

  it('reads ends typed the wrong way round as the range they span, without rewriting them', () => {
    const backwards = dateSelection('2026-11-30', '2026-11-01')
    expect(backwards).toEqual(['2026-11-30', '2026-11-01'])
    expect(dateMatches('2026-11-15', backwards)).toBe(true)
    expect(dateMatches('2026-12-01', backwards)).toBe(false)
    expect(dateSummary(backwards)).toBe('2026-11-01 to 2026-11-30')
  })

  it('reads a one-item selection as from that day on', () => {
    expect(readDateRange(['2026-11-01'])).toEqual({ from: '2026-11-01', to: '' })
  })

  it('summarises a selection in words', () => {
    expect(dateSummary([])).toBe('Any')
    expect(dateSummary(['2026-11-01', ''])).toBe('from 2026-11-01')
    expect(dateSummary(['', '2026-11-30'])).toBe('until 2026-11-30')
    expect(dateSummary(['2026-11-01', '2026-11-30'])).toBe('2026-11-01 to 2026-11-30')
    expect(dateSummary(['2026-11-10', '2026-11-10'])).toBe('2026-11-10')
  })
})

describe('date filter shortcuts', () => {
  it('runs this week Monday to Sunday', () => {
    // 2026-11-10 is a Tuesday.
    expect(datePresets('2026-11-10')[0]).toEqual({ label: 'This week', from: '2026-11-09', to: '2026-11-15' })
  })

  it('runs this month from the 1st to its last day, leap years included', () => {
    expect(datePresets('2026-11-10')[1]).toEqual({ label: 'This month', from: '2026-11-01', to: '2026-11-30' })
    expect(datePresets('2028-02-10')[1]).toMatchObject({ from: '2028-02-01', to: '2028-02-29' })
    expect(datePresets('2026-12-31')[1]).toMatchObject({ from: '2026-12-01', to: '2026-12-31' })
  })

  it('counts today as one of the last 30 days', () => {
    expect(datePresets('2026-11-10')[2]).toEqual({ label: 'Last 30 days', from: '2026-10-12', to: '2026-11-10' })
  })

  it('offers nothing when today is not a date', () => {
    expect(datePresets('')).toEqual([])
  })
})
