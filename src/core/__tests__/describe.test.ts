import { describe, expect, it } from 'vitest'
import { parseCsv } from '../csv'
import type { CsvRow, CsvTable } from '../csv'
import { buildSchemaSet } from '../schema/load'
import type { ResolveRef, SchemaSet } from '../schema'
import { applyChanges } from '../store/merge'
import { describeChange } from '../store/describe'
import { projectChange } from '../store/queue'
import type { Change, RowChange } from '../store/queue'

const schemas: SchemaSet = buildSchemaSet(
  { version: 1, tables: ['squares', 'yarns'] },
  {
    squares: {
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
        { key: 'notes', label: 'Notes', type: 'textarea' },
        { key: 'main_yarn', label: 'Main colour', type: 'ref', refTable: 'yarns' },
        { key: 'extra_yarns', label: 'Extra colours', type: 'reflist', refTable: 'yarns' },
      ],
    },
    yarns: {
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
    },
  },
)

const tables: Record<string, CsvTable> = {
  squares: parseCsv('id,notes,main_yarn,extra_yarns\nS001,first,Y01,Y02\n'),
  yarns: parseCsv('id,name\nY01,Cream\nY02,Sage\n'),
}
const base = { schemas, tables, project: { start_date: '2026-07-03', target_squares: 400 } }

function change(partial: Partial<RowChange> & Pick<RowChange, 'table' | 'rowId' | 'op'>): RowChange {
  return { id: 'c1', ts: 1, values: {}, ...partial }
}

/** A resolver over the merged data, as the app builds it. */
function resolverFor(changes: Change[]): ResolveRef {
  const merged = applyChanges(tables, schemas, changes)
  return (name) => {
    const schema = schemas.tables[name]
    const table = merged[name]
    if (!schema || !table) return undefined
    const rows = new Map<string, CsvRow>(table.rows.map((row) => [row[schema.idField], row]))
    return { schema, rows }
  }
}

describe('describeChange', () => {
  it('shows an edit as labelled before and after values, without the id', () => {
    const edit = change({ table: 'squares', rowId: 'S001', op: 'upsert', values: { id: 'S001', notes: 'second' } })
    const summary = describeChange(edit, base, resolverFor([edit]))
    expect(summary).toMatchObject({ kind: 'edit', title: 'S001', name: '', link: '/squares/S001' })
    expect(summary.lines).toEqual([{ label: 'Notes', from: 'first', to: 'second' }])
  })

  it('names what a reference points at, on both sides', () => {
    const edit = change({
      table: 'squares',
      rowId: 'S001',
      op: 'upsert',
      values: { main_yarn: 'Y02', extra_yarns: 'Y01;Y02' },
    })
    expect(describeChange(edit, base, resolverFor([edit])).lines).toEqual([
      { label: 'Main colour', from: 'Cream', to: 'Sage' },
      { label: 'Extra colours', from: 'Sage', to: 'Cream, Sage' },
    ])
  })

  it('reads a reference to a record that is itself still queued by its name', () => {
    const yarn = change({ id: 'c0', table: 'yarns', rowId: 'Y03', op: 'upsert', create: true, values: { id: 'Y03', name: 'Plum' } })
    const edit = change({ table: 'squares', rowId: 'S001', op: 'upsert', values: { main_yarn: 'Y03' } })
    expect(describeChange(edit, base, resolverFor([yarn, edit])).lines[0]).toEqual({
      label: 'Main colour',
      from: 'Cream',
      to: 'Plum',
    })
  })

  it('lists what a new record has, and leaves out what it leaves blank', () => {
    const created = change({
      table: 'yarns',
      rowId: 'Y03',
      op: 'upsert',
      create: true,
      values: { id: 'Y03', name: 'Plum' },
    })
    const summary = describeChange(created, base, resolverFor([created]))
    expect(summary).toMatchObject({ kind: 'new', title: 'Y03', name: 'Plum' })
    expect(summary.lines).toEqual([{ label: 'Name', from: '', to: 'Plum' }])

    const blank = change({ table: 'squares', rowId: 'S002', op: 'upsert', create: true, values: { id: 'S002', notes: '' } })
    expect(describeChange(blank, base, resolverFor([blank])).lines).toEqual([])
  })

  it('names the record a delete removes', () => {
    const removal = change({ table: 'yarns', rowId: 'Y02', op: 'delete' })
    expect(describeChange(removal, base, resolverFor([removal]))).toMatchObject({
      kind: 'delete',
      title: 'Y02',
      name: 'Sage',
      lines: [],
    })
  })

  it('labels project keys, and shows a removed one as blank', () => {
    const set = projectChange({ target_squares: 420, start_date: null, made_up: 'x' })
    const summary = describeChange(set, base, resolverFor([]))
    expect(summary).toMatchObject({ kind: 'project', title: 'Project settings', link: '/settings' })
    expect(summary.lines).toEqual([
      { label: 'Target squares', from: '400', to: '420' },
      { label: 'Start date', from: '2026-07-03', to: '' },
      { label: 'made_up', from: '', to: 'x' },
    ])
  })

  it('falls back to the column key for a field the schema does not know', () => {
    const edit = change({ table: 'squares', rowId: 'S001', op: 'upsert', values: { ravelry: 'yes' } })
    expect(describeChange(edit, base, resolverFor([edit])).lines).toEqual([{ label: 'ravelry', from: '', to: 'yes' }])
  })
})
