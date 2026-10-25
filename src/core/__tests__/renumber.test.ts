import { describe, expect, it } from 'vitest'
import { parseCsv } from '../csv'
import { buildSchemaSet } from '../schema/load'
import { appendChange, upsertChange } from '../store/queue'
import type { RowChange } from '../store/queue'
import { renumberChanges, resolveIdClashes } from '../store/renumber'

const schemas = buildSchemaSet(
  { tables: ['designs', 'squares'] },
  {
    designs: {
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
      ],
    },
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
        { key: 'design_id', label: 'Design', type: 'ref', refTable: 'designs' },
        { key: 'extras', label: 'Extras', type: 'reflist', refTable: 'designs' },
      ],
    },
  },
)

function create(table: string, rowId: string, values: Record<string, string>, ts: number): RowChange {
  return { ...upsertChange(table, rowId, { id: rowId, ...values }, true), ts }
}

describe('resolveIdClashes', () => {
  const tables = {
    designs: parseCsv('id,name\nD01,Granny\nD02,Sunburst from laptop\n'),
    squares: parseCsv('id,design_id,extras\nS001,D01,\n'),
  }

  it('moves a clashing new record, and every queued reference to it, to the next free id', () => {
    const { changes, renumbered } = resolveIdClashes(tables, schemas, [
      create('designs', 'D02', { name: 'Sunburst from phone' }, 1),
      create('squares', 'S002', { design_id: 'D02', extras: 'D01;D02' }, 2),
    ])

    expect(renumbered).toEqual([{ table: 'designs', from: 'D02', to: 'D03' }])
    expect(changes[0]).toMatchObject({ rowId: 'D03', values: { id: 'D03', name: 'Sunburst from phone' } })
    expect(changes[1]).toMatchObject({ rowId: 'S002', values: { design_id: 'D03', extras: 'D01;D03' } })
  })

  it('skips ids other queued records already hold', () => {
    const { renumbered } = resolveIdClashes(tables, schemas, [
      create('designs', 'D02', { name: 'Sunburst from phone' }, 1),
      create('designs', 'D03', { name: 'Daisy' }, 2),
    ])

    expect(renumbered).toEqual([{ table: 'designs', from: 'D02', to: 'D04' }])
  })

  it('leaves a list that does not mention a moved id exactly as typed', () => {
    const { changes } = resolveIdClashes(tables, schemas, [
      create('designs', 'D02', { name: 'Sunburst from phone' }, 1),
      create('squares', 'S002', { extras: ' D01 ; ' }, 2),
    ])

    expect((changes[1] as RowChange).values?.extras).toBe(' D01 ; ')
  })
})

describe('renumberChanges', () => {
  it('moves an edit made while the push was in flight onto the renumbered record', () => {
    const edit = upsertChange('designs', 'D02', { name: 'Sunburst, renamed' })
    const [moved] = renumberChanges([edit], schemas, [{ table: 'designs', from: 'D02', to: 'D03' }])

    expect(moved).toMatchObject({ rowId: 'D03', values: { name: 'Sunburst, renamed' } })
  })
})

describe('the create flag in the queue', () => {
  it('survives a later edit collapsing into it', () => {
    const queue = appendChange([create('squares', 'S002', { design_id: 'D01' }, 1)], upsertChange('squares', 'S002', { extras: 'D02' }))

    expect(queue).toHaveLength(1)
    expect(queue[0]).toMatchObject({ create: true, values: { design_id: 'D01', extras: 'D02' } })
  })

  it('is absent from an ordinary edit', () => {
    expect(upsertChange('squares', 'S001', { design_id: 'D02' })).not.toHaveProperty('create')
  })
})
