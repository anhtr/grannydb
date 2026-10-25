import { describe, expect, it } from 'vitest'
import { rangeMatches, rangeMax, rangeSelection, readRange } from '../RecordList'

describe('range filters', () => {
  it('saves nothing when the thumbs span the whole range', () => {
    expect(rangeSelection(0, 5, 5)).toEqual([])
  })

  it('leaves the top end unbounded when its thumb is at the maximum', () => {
    expect(rangeSelection(2, 5, 5)).toEqual(['2', ''])
    expect(rangeMatches(9, ['2', ''])).toBe(true)
    expect(rangeMatches(1, ['2', ''])).toBe(false)
  })

  it('leaves the bottom end unbounded when its thumb is at 0', () => {
    expect(rangeSelection(0, 3, 5)).toEqual(['', '3'])
    expect(rangeMatches(0, ['', '3'])).toBe(true)
    expect(rangeMatches(4, ['', '3'])).toBe(false)
  })

  it('includes both ends', () => {
    expect(rangeMatches(2, ['2', '4'])).toBe(true)
    expect(rangeMatches(4, ['2', '4'])).toBe(true)
    expect(rangeMatches(5, ['2', '4'])).toBe(false)
  })

  it('reads an old one-item "3+" threshold as 3 or more', () => {
    expect(rangeMatches(7, ['3'])).toBe(true)
    expect(rangeMatches(2, ['3'])).toBe(false)
    expect(readRange(['3'], 5)).toEqual({ lo: 3, hi: 5 })
  })

  it('clamps a saved selection into the data as it stands now', () => {
    expect(readRange(['8', ''], 5)).toEqual({ lo: 5, hi: 5 })
    expect(readRange(['1', '9'], 5)).toEqual({ lo: 1, hi: 5 })
    expect(readRange([], 5)).toEqual({ lo: 0, hi: 5 })
  })

  it('takes the maximum rounded up, and 0 for no rows', () => {
    const rows = [{ n: '2' }, { n: '3.5' }, { n: '' }]
    expect(rangeMax(rows, (r) => Number(r.n) || 0)).toBe(4)
    expect(rangeMax([], () => 1)).toBe(0)
  })
})
