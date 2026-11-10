import { describe, expect, it } from 'vitest'
import { filterChips } from '../RecordList'
import type { FilterDescriptor } from '../RecordList'

const descriptors: FilterDescriptor[] = [
  {
    key: 'status',
    label: 'Status',
    options: [
      { value: 'done', label: 'done' },
      { value: 'blocked', label: 'blocked' },
    ],
    matches: (row, value) => row.status === value,
  },
  {
    key: 'main_yarn',
    label: 'Main colour',
    options: [{ value: 'Y1', label: '77 (Sunflower)' }],
    matches: (row, value) => row.main_yarn === value,
  },
  { kind: 'range', key: 'skeins', label: 'Skeins', max: 6, value: (row) => Number(row.skeins) || 0 },
  { kind: 'date', key: 'done_date', label: 'Done', value: (row) => row.done_date ?? '' },
]

describe('filterChips', () => {
  it('is empty when nothing is filtered', () => {
    expect(filterChips(descriptors, {})).toEqual([])
    expect(filterChips(descriptors, { status: [] })).toEqual([])
  })

  it('names each selected option by its label, not its stored value', () => {
    expect(filterChips(descriptors, { status: ['done', 'blocked'], main_yarn: ['Y1'] })).toEqual([
      { key: 'status', label: 'Status', text: 'done, blocked' },
      { key: 'main_yarn', label: 'Main colour', text: '77 (Sunflower)' },
    ])
  })

  it('falls back to the stored value when the option is gone', () => {
    expect(filterChips(descriptors, { main_yarn: ['Y9'] })[0].text).toBe('Y9')
  })

  it('reads ranges and dates the way their own controls do', () => {
    expect(filterChips(descriptors, { skeins: ['2', ''], done_date: ['2026-11-01', '2026-11-30'] })).toEqual([
      { key: 'skeins', label: 'Skeins', text: '2+' },
      { key: 'done_date', label: 'Done', text: '2026-11-01 to 2026-11-30' },
    ])
  })

  it('follows the order of the filter panel, not the order filters were set in', () => {
    const chips = filterChips(descriptors, { done_date: ['2026-11-01', ''], status: ['done'] })
    expect(chips.map((c) => c.key)).toEqual(['status', 'done_date'])
  })

  it('ignores a selection saved for a filter that no longer exists', () => {
    expect(filterChips(descriptors, { retired_field: ['x'] })).toEqual([])
  })
})
