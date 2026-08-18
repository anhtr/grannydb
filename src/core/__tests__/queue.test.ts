import { describe, expect, it } from 'vitest'
import { parseCsv, serializeCsv } from '../csv'
import { buildSchemaSet } from '../schema/load'
import type { SchemaSet } from '../schema'
import { applyChanges } from '../store/merge'
import { appendChange, pendingRowIds } from '../store/queue'
import type { Change } from '../store/queue'
import { commitMessage } from '../store/message'

const manifest = { version: 1, tables: ['squares', 'yarns'] }

const rawSchemas = {
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
      { key: 'position', label: 'Position', type: 'text' },
      { key: 'main_yarn', label: 'Main', type: 'ref', refTable: 'yarns' },
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
}

const schemas: SchemaSet = buildSchemaSet(manifest, rawSchemas)

function change(partial: Partial<Change> & Pick<Change, 'table' | 'rowId' | 'op'>): Change {
  return { id: `c${Math.random()}`, ts: Date.now(), values: {}, ...partial }
}

function tables() {
  return {
    squares: parseCsv('id,notes,position,main_yarn\nS001,first,,Y01\nS002,second,,Y02\n'),
    yarns: parseCsv('id,name\nY01,Cream\nY02,Sage\n'),
  }
}

describe('appendChange', () => {
  it('collapses repeated edits to the same row into one operation', () => {
    let queue: Change[] = []
    queue = appendChange(queue, change({ table: 'squares', rowId: 'S001', op: 'upsert', values: { notes: 'a' }, ts: 1 }))
    queue = appendChange(queue, change({ table: 'squares', rowId: 'S001', op: 'upsert', values: { position: 'r1c1' }, ts: 2 }))

    expect(queue).toHaveLength(1)
    expect(queue[0].values).toEqual({ notes: 'a', position: 'r1c1' })
    expect(queue[0].ts).toBe(2)
  })

  it('keeps edits to different rows separate', () => {
    let queue: Change[] = []
    queue = appendChange(queue, change({ table: 'squares', rowId: 'S001', op: 'upsert', values: { notes: 'a' } }))
    queue = appendChange(queue, change({ table: 'squares', rowId: 'S002', op: 'upsert', values: { notes: 'b' } }))
    expect(queue).toHaveLength(2)
  })

  it('keeps same-id rows in different tables separate', () => {
    let queue: Change[] = []
    queue = appendChange(queue, change({ table: 'squares', rowId: 'X1', op: 'upsert', values: { notes: 'a' } }))
    queue = appendChange(queue, change({ table: 'yarns', rowId: 'X1', op: 'upsert', values: { name: 'b' } }))
    expect(queue).toHaveLength(2)
  })

  it('lets a delete supersede pending edits to that row', () => {
    let queue: Change[] = []
    queue = appendChange(queue, change({ table: 'squares', rowId: 'S001', op: 'upsert', values: { notes: 'a' } }))
    queue = appendChange(queue, change({ table: 'squares', rowId: 'S001', op: 'delete' }))
    expect(queue).toHaveLength(1)
    expect(queue[0].op).toBe('delete')
  })

  it('does not fold an edit into a preceding delete', () => {
    // Delete then re-create is a real sequence and must stay two operations.
    let queue: Change[] = []
    queue = appendChange(queue, change({ table: 'squares', rowId: 'S001', op: 'delete', ts: 1 }))
    queue = appendChange(queue, change({ table: 'squares', rowId: 'S001', op: 'upsert', values: { notes: 'new' }, ts: 2 }))
    expect(queue.map((c) => c.op)).toEqual(['delete', 'upsert'])
  })
})

describe('applyChanges', () => {
  it('replays operations onto base data in timestamp order', () => {
    const out = applyChanges(tables(), schemas, [
      change({ table: 'squares', rowId: 'S001', op: 'upsert', values: { notes: 'later' }, ts: 20 }),
      change({ table: 'squares', rowId: 'S001', op: 'upsert', values: { notes: 'earlier' }, ts: 10 }),
    ])
    expect(out.squares.rows[0].notes).toBe('later')
  })

  it('leaves untouched tables alone', () => {
    const base = tables()
    const out = applyChanges(base, schemas, [
      change({ table: 'squares', rowId: 'S001', op: 'upsert', values: { notes: 'x' } }),
    ])
    expect(out.yarns).toBe(base.yarns)
  })

  it('ignores changes for a table the schema no longer knows about', () => {
    const out = applyChanges(tables(), schemas, [
      change({ table: 'ghosts', rowId: 'G1', op: 'upsert', values: { a: 'b' } }),
    ])
    expect(Object.keys(out).sort()).toEqual(['squares', 'yarns'])
  })

  /**
   * The scenario the whole operation-log design exists for: the repo moved on while edits were
   * queued locally. Replaying onto the *new* data must keep both.
   */
  it('merges local edits onto data that changed remotely', () => {
    const remote = {
      squares: parseCsv(
        'id,notes,position,main_yarn\nS001,first,,Y01\nS002,edited on laptop,,Y02\nS003,brand new,,Y01\n',
      ),
      yarns: parseCsv('id,name\nY01,Cream\nY02,Sage\n'),
    }

    const out = applyChanges(remote, schemas, [
      change({ table: 'squares', rowId: 'S001', op: 'upsert', values: { notes: 'edited on phone' } }),
    ])

    const text = serializeCsv(out.squares, { sortBy: 'id' })
    expect(text).toContain('S001,edited on phone')
    expect(text).toContain('S002,edited on laptop')
    expect(text).toContain('S003,brand new')
  })

  it('merges field-level edits to the same row from two devices', () => {
    // The laptop set `position` and synced. The phone had queued a `notes` edit before that.
    const remote = {
      squares: parseCsv('id,notes,position,main_yarn\nS001,first,r1c1,Y01\nS002,second,,Y02\n'),
      yarns: parseCsv('id,name\nY01,Cream\nY02,Sage\n'),
    }

    const out = applyChanges(remote, schemas, [
      change({ table: 'squares', rowId: 'S001', op: 'upsert', values: { notes: 'from phone' } }),
    ])

    expect(out.squares.rows[0]).toMatchObject({
      id: 'S001',
      notes: 'from phone',
      position: 'r1c1', // survived, because the queue only recorded the field that changed
    })
  })

  it('applies a delete', () => {
    const out = applyChanges(tables(), schemas, [
      change({ table: 'squares', rowId: 'S002', op: 'delete' }),
    ])
    expect(out.squares.rows.map((r) => r.id)).toEqual(['S001'])
  })
})

describe('pendingRowIds', () => {
  it('reports only the ids for the requested table', () => {
    const changes = [
      change({ table: 'squares', rowId: 'S001', op: 'upsert' }),
      change({ table: 'yarns', rowId: 'Y01', op: 'upsert' }),
    ]
    expect([...pendingRowIds(changes, 'squares')]).toEqual(['S001'])
  })
})

describe('commitMessage', () => {
  it('summarises the batch on the subject line', () => {
    const message = commitMessage(
      [
        change({ table: 'squares', rowId: 'S001', op: 'upsert', ts: 1 }),
        change({ table: 'squares', rowId: 'S002', op: 'upsert', ts: 2 }),
        change({ table: 'yarns', rowId: 'Y03', op: 'delete', ts: 3 }),
      ],
      schemas,
    )
    const [subject] = message.split('\n')
    expect(subject).toBe('Update 2 squares, remove 1 yarn')
    expect(message).toContain('- delete yarns/Y03')
  })
})
