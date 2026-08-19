import { describe, expect, it } from 'vitest'
import { sortRows } from '../RecordList'
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
    { key: 'design_id', label: 'Design', type: 'ref', refTable: 'designs' },
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

const yarnRows = new Map([
  ['Y1', { id: 'Y1', name: 'Blue' }],
  ['Y2', { id: 'Y2', name: 'Amber' }],
])
const designRows = new Map([
  ['D1', { id: 'D1', name: 'Granny', construction_type: 'solid' }],
  ['D2', { id: 'D2', name: 'Lacy', construction_type: 'holey' }],
])

const resolve: ResolveRef = (table) => {
  if (table === 'yarns') return { schema: yarnsSchema, rows: yarnRows }
  if (table === 'designs') return { schema: designsSchema, rows: designRows }
  return undefined
}

const mainYarnField = squaresSchema.fields.find((f) => f.key === 'main_yarn')!
const constructionField = squaresSchema.fields.find((f) => f.key === 'construction_type')!

// Every row leaves its own construction_type blank, inheriting from its design — the case that
// silently broke before compareValues started resolving effectiveValue for inheriting fields.
const rows = [
  { id: 'S001', design_id: 'D1', construction_type: '', main_yarn: 'Y1' }, // Blue, solid
  { id: 'S002', design_id: 'D2', construction_type: '', main_yarn: 'Y1' }, // Blue, holey
  { id: 'S003', design_id: 'D1', construction_type: '', main_yarn: 'Y2' }, // Amber, solid
]

describe('sortRows', () => {
  it('sorts a ref field by the referenced row title, not the stored id', () => {
    const primary: SortSpec = { key: 'main_yarn', field: mainYarnField, dir: 'asc' }
    const sorted = sortRows(rows, squaresSchema, primary, resolve)
    expect(sorted.map((r) => r.id)).toEqual(['S003', 'S001', 'S002']) // Amber before Blue
  })

  it('resolves an inheriting field to its effective value, not the blank stored cell', () => {
    const primary: SortSpec = { key: 'construction_type', field: constructionField, dir: 'asc' }
    const sorted = sortRows(rows, squaresSchema, primary, resolve)
    // holey < solid alphabetically; every row's own cell is blank, so this only works if the
    // inherited design value is what actually gets compared.
    expect(sorted.map((r) => r.id)).toEqual(['S002', 'S001', 'S003'])
  })

  it('breaks ties on the primary sort using a secondary SortSpec (defaultSort.thenBy)', () => {
    const primary: SortSpec = { key: 'main_yarn', field: mainYarnField, dir: 'asc' }
    const secondary: SortSpec = { key: 'construction_type', field: constructionField, dir: 'asc' }
    const sorted = sortRows(rows, squaresSchema, primary, resolve, secondary)
    // Amber first; within the Blue tie, holey (S002) sorts before solid (S001).
    expect(sorted.map((r) => r.id)).toEqual(['S003', 'S002', 'S001'])
  })
})
