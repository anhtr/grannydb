import { describe, expect, it } from 'vitest'
import { designSquareCounts, isYarnActive, yarnCombinations, yarnUsageCounts } from '../schema/relations'
import type { CsvTable } from '../csv'

const squares: CsvTable = {
  columns: ['id', 'design_id', 'main_yarn', 'extra_yarns'],
  rows: [
    { id: 'S001', design_id: 'D1', main_yarn: 'Y1', extra_yarns: 'Y2;Y3' },
    { id: 'S002', design_id: 'D1', main_yarn: 'Y2', extra_yarns: '' },
    { id: 'S003', design_id: 'D2', main_yarn: 'Y1', extra_yarns: 'Y2' },
    { id: 'S004', design_id: '', main_yarn: '', extra_yarns: '' },
  ],
}

describe('yarnUsageCounts', () => {
  it('counts a yarn once per square it is the main colour of', () => {
    expect(yarnUsageCounts(squares).get('Y1')).toEqual({ main: 2, extra: 0 })
  })

  it('counts a yarn once per square it appears among the extra colours of', () => {
    expect(yarnUsageCounts(squares).get('Y2')).toEqual({ main: 1, extra: 2 })
  })

  it('counts a yarn that only ever appears as an extra colour', () => {
    expect(yarnUsageCounts(squares).get('Y3')).toEqual({ main: 0, extra: 1 })
  })

  it('omits a yarn no square references', () => {
    expect(yarnUsageCounts(squares).has('Y9')).toBe(false)
  })

  it('ignores blank main_yarn and extra_yarns cells', () => {
    const counts = yarnUsageCounts(squares)
    expect([...counts.keys()]).not.toContain('')
  })
})

describe('isYarnActive', () => {
  it('is active with a positive skein count, regardless of usage', () => {
    expect(isYarnActive({ id: 'Y1', skeins: '2', partial_skein: 'no' }, undefined)).toBe(true)
  })

  it('is active with a partial skein even at zero full skeins', () => {
    expect(isYarnActive({ id: 'Y1', skeins: '0', partial_skein: 'yes' }, undefined)).toBe(true)
  })

  it('is active when used by a square as main or extra, even with nothing left in stash', () => {
    expect(isYarnActive({ id: 'Y1', skeins: '0', partial_skein: 'no' }, { main: 1, extra: 0 })).toBe(true)
    expect(isYarnActive({ id: 'Y1', skeins: '0', partial_skein: 'no' }, { main: 0, extra: 1 })).toBe(true)
  })

  it('is inactive with nothing in stash and no using square', () => {
    expect(isYarnActive({ id: 'Y1', skeins: '0', partial_skein: 'no' }, undefined)).toBe(false)
    expect(isYarnActive({ id: 'Y1', skeins: '0', partial_skein: 'no' }, { main: 0, extra: 0 })).toBe(false)
  })
})

describe('designSquareCounts', () => {
  it('counts squares per design', () => {
    const counts = designSquareCounts(squares)
    expect(counts.get('D1')).toBe(2)
    expect(counts.get('D2')).toBe(1)
  })

  it('does not count squares with no design', () => {
    expect(designSquareCounts(squares).has('')).toBe(false)
  })
})

describe('yarnCombinations', () => {
  const mixed: CsvTable = {
    columns: ['id', 'main_yarn', 'extra_yarns'],
    rows: [
      { id: 'S001', main_yarn: 'Y1', extra_yarns: 'Y2;Y3' },
      { id: 'S002', main_yarn: 'Y1', extra_yarns: 'Y3;Y2' },
      { id: 'S003', main_yarn: 'Y1', extra_yarns: '' },
      { id: 'S004', main_yarn: 'Y4', extra_yarns: 'Y1' },
      { id: 'S005', main_yarn: 'Y4', extra_yarns: 'Y3;Y1' },
      { id: 'S006', main_yarn: 'Y2', extra_yarns: 'Y5' },
    ],
  }

  it('groups squares where the yarn is main by their extras, regardless of extra order', () => {
    expect(yarnCombinations(mixed, 'Y1').asMain).toEqual([
      { main: 'Y1', extras: ['Y2', 'Y3'], squareIds: ['S001', 'S002'] },
      { main: 'Y1', extras: [], squareIds: ['S003'] },
    ])
  })

  it('groups squares where the yarn is extra by main and the other extras, leaving the yarn out', () => {
    expect(yarnCombinations(mixed, 'Y1').asExtra).toEqual([
      { main: 'Y4', extras: [], squareIds: ['S004'] },
      { main: 'Y4', extras: ['Y3'], squareIds: ['S005'] },
    ])
  })

  it('counts a yarn listed as both main and extra on one square under main only', () => {
    const table: CsvTable = { columns: ['id', 'main_yarn', 'extra_yarns'], rows: [{ id: 'S1', main_yarn: 'Y1', extra_yarns: 'Y1;Y2' }] }
    expect(yarnCombinations(table, 'Y1')).toEqual({
      asMain: [{ main: 'Y1', extras: ['Y2'], squareIds: ['S1'] }],
      asExtra: [],
    })
  })

  it('returns nothing for a yarn no square uses', () => {
    expect(yarnCombinations(mixed, 'Y9')).toEqual({ asMain: [], asExtra: [] })
  })
})
