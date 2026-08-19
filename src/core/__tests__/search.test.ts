import { describe, expect, it } from 'vitest'
import {
  derivedFilterField,
  derivedFilterValue,
  effectiveValue,
  matchesSearch,
  refDisplayLabel,
  searchText,
} from '../schema/search'
import type { DerivedFilterDef, ResolveRef, TableSchema } from '../schema'

describe('matchesSearch', () => {
  it('matches any part of the text, case-insensitively', () => {
    expect(matchesSearch('Granny Stripe', 'stripe')).toBe(true)
    expect(matchesSearch('Granny Stripe', 'GRANNY')).toBe(true)
    expect(matchesSearch('Granny Stripe', 'nope')).toBe(false)
  })

  it('treats an empty query as matching everything', () => {
    expect(matchesSearch('anything', '')).toBe(true)
    expect(matchesSearch('anything', '   ')).toBe(true)
  })

  it('supports * and ? wildcards', () => {
    expect(matchesSearch('Granny Stripe', 'gran*stripe')).toBe(true)
    expect(matchesSearch('Granny Stripe', 'gr?nny')).toBe(true)
    expect(matchesSearch('Granny Stripe', 'stripe*plaid')).toBe(false)
  })

  it('does not throw on regex-special characters', () => {
    expect(matchesSearch('50% off (sale)', '(sale)')).toBe(true)
  })
})

const sources: TableSchema = {
  table: 'sources',
  file: 'data/sources.csv',
  label: 'Sources',
  labelSingular: 'Source',
  idField: 'id',
  idPrefix: 'SRC',
  idPadding: 2,
  titleField: 'name',
  fields: [
    { key: 'id', label: 'ID', type: 'id' },
    { key: 'name', label: 'Name', type: 'text' },
  ],
}

const designs: TableSchema = {
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
    { key: 'source', label: 'Source', type: 'ref', refTable: 'sources' },
    { key: 'construction_type', label: 'Construction', type: 'enum', options: ['solid', 'holey'] },
  ],
}

const squares: TableSchema = {
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
    { key: 'status', label: 'Status', type: 'enum', options: ['done', 'planned'] },
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

const sourceRows = new Map([['SRC01', { id: 'SRC01', name: 'Attic24' }]])
const designRows = new Map([
  ['D01', { id: 'D01', name: 'Granny Stripe', source: 'SRC01', construction_type: 'holey' }],
  ['D02', { id: 'D02', name: 'Solid Square', source: 'SRC01', construction_type: '' }],
])

const resolve: ResolveRef = (table) => {
  if (table === 'sources') return { schema: sources, rows: sourceRows }
  if (table === 'designs') return { schema: designs, rows: designRows }
  return undefined
}

describe('searchText', () => {
  it('resolves a ref field to the referenced row title, not the stored id', () => {
    const text = searchText(designs, designRows.get('D01')!, resolve)
    expect(text).toContain('Granny Stripe')
    expect(text).toContain('Attic24')
    expect(text).not.toContain('SRC01')
  })

  it('restricts to the given keys', () => {
    const text = searchText(squares, { id: 'S001', status: 'done', design_id: 'D01' }, resolve, [
      'status',
    ])
    expect(text).toBe('done')
  })

  it('chases a chain of refs when restricted to a nested key', () => {
    const text = searchText(squares, { id: 'S001', status: 'done', design_id: 'D01' }, resolve, [
      'design_id',
    ])
    expect(text).toBe('Granny Stripe')
  })

  it('falls back to the raw id for a dangling reference', () => {
    const text = searchText(squares, { id: 'S002', status: '', design_id: 'D99' }, resolve, [
      'design_id',
    ])
    expect(text).toBe('D99')
  })
})

describe('refDisplayLabel', () => {
  it('resolves a ref value to its title', () => {
    const field = squares.fields.find((f) => f.key === 'design_id')!
    expect(refDisplayLabel(field, 'D01', resolve)).toBe('Granny Stripe')
  })

  it('passes non-ref values through unchanged', () => {
    const field = squares.fields.find((f) => f.key === 'status')!
    expect(refDisplayLabel(field, 'done', resolve)).toBe('done')
  })
})

describe('derived filters', () => {
  const filter: DerivedFilterDef = {
    key: 'source',
    label: 'Source',
    via: 'design_id',
    throughField: 'source',
  }

  it('resolves the field on the far side of the hop', () => {
    const field = derivedFilterField(squares, filter, resolve)
    expect(field?.key).toBe('source')
    expect(field?.refTable).toBe('sources')
  })

  it('reads the value by hopping through the via field', () => {
    const value = derivedFilterValue(squares, filter, { id: 'S001', design_id: 'D01' }, resolve)
    expect(value).toBe('SRC01')
  })

  it('is blank when the via field is empty', () => {
    const value = derivedFilterValue(squares, filter, { id: 'S001', design_id: '' }, resolve)
    expect(value).toBe('')
  })
})

describe('effectiveValue', () => {
  const field = squares.fields.find((f) => f.key === 'construction_type')!

  it('returns the row\'s own value untouched when it is set', () => {
    const row = { id: 'S001', design_id: 'D01', construction_type: 'solid' }
    expect(effectiveValue(squares, field, row, resolve)).toEqual({ value: 'solid', inherited: false })
  })

  it('falls back through inheritFrom when the row is blank', () => {
    const row = { id: 'S001', design_id: 'D01', construction_type: '' }
    expect(effectiveValue(squares, field, row, resolve)).toEqual({ value: 'holey', inherited: true })
  })

  it('is blank, not inherited, when the row it hops to is also blank', () => {
    const row = { id: 'S002', design_id: 'D02', construction_type: '' }
    expect(effectiveValue(squares, field, row, resolve)).toEqual({ value: '', inherited: false })
  })

  it('is blank when the via field itself is empty', () => {
    const row = { id: 'S003', design_id: '', construction_type: '' }
    expect(effectiveValue(squares, field, row, resolve)).toEqual({ value: '', inherited: false })
  })

  it('passes non-inheriting fields straight through', () => {
    const status = squares.fields.find((f) => f.key === 'status')!
    const row = { id: 'S001', status: 'done' }
    expect(effectiveValue(squares, status, row, resolve)).toEqual({ value: 'done', inherited: false })
  })

  it('trims a hand-edited own value so it still exact-matches its option', () => {
    const row = { id: 'S001', design_id: 'D01', construction_type: 'solid ' }
    expect(effectiveValue(squares, field, row, resolve)).toEqual({ value: 'solid', inherited: false })
  })

  it('trims a hand-edited value found via the inherited hop too', () => {
    const paddedDesignRows = new Map([['D03', { id: 'D03', construction_type: ' holey' }]])
    const paddedResolve: ResolveRef = (table) =>
      table === 'designs' ? { schema: designs, rows: paddedDesignRows } : undefined
    const row = { id: 'S001', design_id: 'D03', construction_type: '' }
    expect(effectiveValue(squares, field, row, paddedResolve)).toEqual({ value: 'holey', inherited: true })
  })
})
