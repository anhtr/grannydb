import { describe, expect, it } from 'vitest'
import { parseCsv } from '../csv'
import { DEFAULT_CONFIG } from '../github/config'
import { parseTableSchema } from '../schema'
import type { SchemaSet } from '../schema'
import { applyChanges, buildBackup, tableCsv, upsertChange } from '../store'

const schemas: SchemaSet = {
  version: 1,
  order: ['squares', 'yarns'],
  tables: {
    squares: parseTableSchema({
      table: 'squares',
      file: 'data/squares.csv',
      label: 'Squares',
      idField: 'id',
      fields: [
        { key: 'id', label: 'ID', type: 'id' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ],
    }),
    yarns: parseTableSchema({
      table: 'yarns',
      file: 'data/yarns.csv',
      label: 'Yarns',
      idField: 'id',
      fields: [
        { key: 'id', label: 'ID', type: 'id' },
        { key: 'colour', label: 'Colour', type: 'text' },
      ],
    }),
  },
}

// `spare` is a column the schema does not mention: someone added it in a spreadsheet.
const base = {
  squares: parseCsv('id,notes,spare\nS002,second,keep\nS001,first,\n'),
  yarns: parseCsv('id,colour\nY001,red\n'),
}

const input = (changes = [upsertChange('squares', 'S001', { notes: 'edited offline' })]) => ({
  config: DEFAULT_CONFIG,
  commit: 'abc123',
  schemas,
  data: applyChanges(base, schemas, changes),
  project: { start_date: '2026-01-01', a_key_the_app_does_not_know: true },
  changes,
  exportedAt: new Date('2026-11-10T19:04:11Z'),
})

describe('buildBackup', () => {
  it('holds each table as the next sync would write it, pending edits applied', () => {
    const backup = buildBackup(input())
    expect(Object.keys(backup.files)).toEqual(['data/squares.csv', 'data/yarns.csv', 'data/project.json'])
    const squares = parseCsv(backup.files['data/squares.csv'])
    // Sorted by id, like a synced file, with the hand-added column still there.
    expect(squares.rows.map((r) => r.id)).toEqual(['S001', 'S002'])
    expect(squares.rows[0].notes).toBe('edited offline')
    expect(squares.columns).toContain('spare')
    expect(squares.rows[1].spare).toBe('keep')
  })

  it('keeps the queue itself too, and says where and when the data was read', () => {
    const backup = buildBackup(input())
    expect(backup.pendingChanges).toHaveLength(1)
    expect(backup.pendingChanges[0]).toMatchObject({ table: 'squares', rowId: 'S001', values: { notes: 'edited offline' } })
    expect(backup.format).toBe('grannydb-backup')
    expect(backup.formatVersion).toBe(1)
    expect(backup.exportedAt).toBe('2026-11-10T19:04:11.000Z')
    expect(backup.source).toEqual({
      owner: DEFAULT_CONFIG.owner,
      repo: DEFAULT_CONFIG.repo,
      branch: DEFAULT_CONFIG.branch,
      dataDir: DEFAULT_CONFIG.dataDir,
      commit: 'abc123',
    })
  })

  it('writes project.json with keys the app does not know, and leaves it out when there is none', () => {
    const doc = JSON.parse(buildBackup(input()).files['data/project.json']) as Record<string, unknown>
    expect(doc).toEqual({ start_date: '2026-01-01', a_key_the_app_does_not_know: true })
    const none = buildBackup({ ...input(), project: {} })
    expect(Object.keys(none.files)).toEqual(['data/squares.csv', 'data/yarns.csv'])
  })

  it('survives a round trip through JSON, which is how it is saved', () => {
    const backup = buildBackup(input())
    expect(JSON.parse(JSON.stringify(backup))).toEqual(backup)
  })
})

describe('tableCsv', () => {
  it('names the file by its repo path and returns nothing for a table it does not have', () => {
    expect(tableCsv(schemas, base, 'yarns')).toEqual({ path: 'data/yarns.csv', text: 'id,colour\nY001,red\n' })
    expect(tableCsv(schemas, base, 'designs')).toBeNull()
    expect(tableCsv(schemas, { designs: base.yarns }, 'designs')).toBeNull()
  })
})
