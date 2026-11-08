import { describe, expect, it } from 'vitest'
import { squareConstructionInsights } from '../schema/relations'
import type { CsvRow, CsvTable } from '../csv'
import type { ResolveRef, TableSchema } from '../schema'

const designs: TableSchema = {
  table: 'designs',
  file: 'data/designs.csv',
  label: 'Designs',
  labelSingular: 'Design',
  idField: 'id',
  idPrefix: 'D',
  idPadding: 2,
  titleField: 'id',
  fields: [
    { key: 'id', label: 'ID', type: 'id' },
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
      inheritFrom: { via: 'design_id', throughField: 'construction_type' },
    },
  ],
}

const designRows = new Map<string, CsvRow>([
  ['D1', { id: 'D1', construction_type: 'solid' }],
  ['D2', { id: 'D2', construction_type: 'holey' }],
  ['D3', { id: 'D3', construction_type: '' }],
])
const resolve: ResolveRef = (table) => (table === 'designs' ? { schema: designs, rows: designRows } : undefined)

const table = (rows: CsvRow[]): CsvTable => ({
  columns: ['id', 'status', 'design_id', 'construction_type', 'main_yarn', 'extra_yarns'],
  rows,
})

describe('colourCountByConstruction', () => {
  it('counts distinct colours per square against effective construction, every status', () => {
    const result = squareConstructionInsights(
      squaresSchema,
      table([
        { id: 'S1', status: 'done', design_id: 'D1', main_yarn: 'Y1', extra_yarns: '' },
        { id: 'S2', status: 'planned', design_id: 'D2', main_yarn: 'Y1', extra_yarns: '' },
        // Its own cell overrides the design's holey.
        { id: 'S3', status: 'done', design_id: 'D2', construction_type: 'solid', main_yarn: 'Y1', extra_yarns: 'Y2;Y3' },
        // Y2 listed twice still counts as one colour.
        { id: 'S4', status: 'done', design_id: 'D2', main_yarn: 'Y1', extra_yarns: 'Y2;Y2;Y3' },
      ]),
      resolve,
    ).colourCountByConstruction
    expect(result).toEqual({
      constructions: ['solid', 'holey'],
      rows: [
        { colours: 1, counts: [1, 1] },
        { colours: 2, counts: [0, 0] },
        { colours: 3, counts: [1, 1] },
      ],
    })
  })

  it('adds columns for unlisted and missing constructions, and skips squares with no colours', () => {
    const result = squareConstructionInsights(
      squaresSchema,
      table([
        { id: 'S1', design_id: 'D3', main_yarn: 'Y1', extra_yarns: '' },
        { id: 'S2', design_id: 'D1', construction_type: 'lace', main_yarn: '', extra_yarns: 'Y2' },
        { id: 'S3', design_id: 'D1', main_yarn: '', extra_yarns: '' },
      ]),
      resolve,
    ).colourCountByConstruction
    expect(result).toEqual({
      constructions: ['solid', 'holey', 'lace', ''],
      rows: [{ colours: 1, counts: [0, 0, 1, 1] }],
    })
  })

  it('has no rows when no square has a colour', () => {
    expect(squareConstructionInsights(squaresSchema, table([]), resolve).colourCountByConstruction.rows).toEqual([])
  })
})
