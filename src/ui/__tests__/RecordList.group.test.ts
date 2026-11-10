import { describe, expect, it } from 'vitest'
import { groupRows, sortRows } from '../RecordList'
import type { SortSpec } from '../RecordList'
import type { ResolveRef, TableSchema } from '../../core/schema'

const yarnsSchema: TableSchema = {
  table: 'yarns',
  file: 'data/yarns.csv',
  label: 'Yarns',
  labelSingular: 'Yarn',
  idField: 'id',
  idPrefix: 'Y',
  idPadding: 2,
  titleField: 'name',
  fields: [
    { key: 'id', label: 'ID', type: 'id' },
    { key: 'name', label: 'Name', type: 'text' },
  ],
}

const designsSchema: TableSchema = {
  table: 'designs',
  file: 'data/designs.csv',
  label: 'Designs',
  labelSingular: 'Design',
  idField: 'id',
  idPrefix: 'D',
  idPadding: 2,
  titleField: 'name',
  fields: [
    { key: 'id', label: 'ID', type: 'id' },
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'construction_type', label: 'Construction', type: 'enum', options: ['solid', 'holey'] },
  ],
}

const squaresSchema: TableSchema = {
  table: 'squares',
  file: 'data/squares.csv',
  label: 'Squares',
  labelSingular: 'Square',
  idField: 'id',
  idPrefix: 'S',
  idPadding: 3,
  titleField: 'id',
  fields: [
    { key: 'id', label: 'ID', type: 'id' },
    { key: 'status', label: 'Status', type: 'enum', options: ['planned', 'done'], sortable: true },
    { key: 'done_date', label: 'Done', type: 'date', sortable: true },
    { key: 'rounds', label: 'Rounds', type: 'number', sortable: true },
    { key: 'notes', label: 'Notes', type: 'text', sortable: true },
    { key: 'design_id', label: 'Design', type: 'ref', refTable: 'designs', sortable: true },
    {
      key: 'construction_type',
      label: 'Construction',
      type: 'enum',
      options: ['solid', 'holey'],
      sortable: true,
      inheritFrom: { via: 'design_id', throughField: 'construction_type' },
    },
    { key: 'main_yarn', label: 'Main colour', type: 'ref', refTable: 'yarns', sortable: true },
  ],
}

const resolve: ResolveRef = (table) => {
  if (table === 'yarns') {
    return {
      schema: yarnsSchema,
      rows: new Map([
        ['Y1', { id: 'Y1', name: 'Blue' }],
        ['Y2', { id: 'Y2', name: 'Amber' }],
        // A second yarn that reads the same as Y1 - the sort cannot tell them apart, so neither may
        // the headings.
        ['Y3', { id: 'Y3', name: 'Blue' }],
      ]),
    }
  }
  if (table === 'designs') {
    return {
      schema: designsSchema,
      rows: new Map([
        ['D1', { id: 'D1', name: 'Granny', construction_type: 'solid' }],
        ['D2', { id: 'D2', name: 'Lacy', construction_type: 'holey' }],
      ]),
    }
  }
  return undefined
}

const rows = [
  { id: 'S001', status: 'done', done_date: '2026-10-28', rounds: '4', notes: 'a', design_id: 'D1', construction_type: '', main_yarn: 'Y1' },
  { id: 'S002', status: 'done', done_date: '2026-11-02', rounds: '4', notes: 'b', design_id: 'D2', construction_type: '', main_yarn: 'Y3' },
  { id: 'S003', status: 'planned', done_date: '', rounds: '', notes: 'c', design_id: 'D1', construction_type: '', main_yarn: 'Y2' },
  { id: 'S004', status: 'done', done_date: '2026-11-09', rounds: '6', notes: 'd', design_id: '', construction_type: '', main_yarn: 'Y1' },
]

function spec(key: string, dir: 'asc' | 'desc' = 'asc'): SortSpec {
  return { key, dir, field: squaresSchema.fields.find((f) => f.key === key) }
}

/** Sorted then grouped, as the list does it, reduced to `label -> ids` for reading. */
function grouped(by: SortSpec) {
  const groups = groupRows(sortRows(rows, squaresSchema, [by], resolve), squaresSchema, by, resolve)
  return groups?.map((g) => [g.label, g.rows.map((r) => r.id)])
}

describe('groupRows', () => {
  it('heads each run of the primary sort value with its label', () => {
    expect(grouped(spec('status'))).toEqual([
      ['Status: done', ['S001', 'S002', 'S004']],
      ['Status: planned', ['S003']],
    ])
  })

  it('follows the sort direction', () => {
    expect(grouped(spec('status', 'desc'))?.map(([label]) => label)).toEqual(['Status: planned', 'Status: done'])
  })

  it('names a reference by what it points at, and merges references that read the same', () => {
    expect(grouped(spec('main_yarn'))).toEqual([
      ['Main colour: Amber', ['S003']],
      ['Main colour: Blue', ['S001', 'S002', 'S004']],
    ])
  })

  it('groups dates by month and heads the rows without one as blank', () => {
    expect(grouped(spec('done_date'))).toEqual([
      ['Done: blank', ['S003']],
      ['Done: October 2026', ['S001']],
      ['Done: November 2026', ['S002', 'S004']],
    ])
  })

  it('groups on the value an inheriting field resolves to', () => {
    expect(grouped(spec('construction_type'))).toEqual([
      ['Construction: blank', ['S004']],
      ['Construction: holey', ['S002']],
      ['Construction: solid', ['S001', 'S003']],
    ])
  })

  it('counts a blank number as 0, the way the sort does', () => {
    expect(grouped(spec('rounds'))).toEqual([
      ['Rounds: 0', ['S003']],
      ['Rounds: 4', ['S001', 'S002']],
      ['Rounds: 6', ['S004']],
    ])
  })

  it('leaves the list flat when the sort has nothing to group by', () => {
    expect(grouped({ key: 'id', dir: 'asc', field: undefined })).toBeUndefined()
    expect(grouped({ key: 'title', dir: 'asc', field: undefined })).toBeUndefined()
    expect(grouped(spec('notes'))).toBeUndefined()
    expect(groupRows(rows, squaresSchema, undefined, resolve)).toBeNull()
  })

  it('leaves the list flat for a computed sort', () => {
    const computed: SortSpec = { key: 'n', dir: 'asc', field: undefined, computed: { key: 'n', label: 'N', value: () => 1 } }
    expect(groupRows(rows, squaresSchema, computed, resolve)).toBeNull()
  })

  it('leaves the list flat when every group would hold one row', () => {
    const one = rows.slice(0, 1)
    expect(groupRows(one, squaresSchema, spec('status'), resolve)).toBeNull()
    const distinct = [rows[0], rows[2]]
    expect(groupRows(sortRows(distinct, squaresSchema, [spec('status')], resolve), squaresSchema, spec('status'), resolve)).toBeNull()
  })
})
