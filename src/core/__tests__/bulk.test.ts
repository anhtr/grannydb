import { describe, expect, it } from 'vitest'
import type { CsvRow } from '../csv'
import { bulkEditableFields, bulkEditNeedsDate, parseTableSchema, planBulkEdit } from '../schema'

const schema = parseTableSchema({
  table: 'squares',
  file: 'data/squares.csv',
  label: 'Squares',
  idField: 'id',
  statusDates: {
    field: 'status',
    dates: { planned: 'planned_date', 'in progress': 'started_date', done: 'done_date', blocked: 'blocked_date' },
    implies: { blocked: ['done'] },
  },
  fields: [
    { key: 'id', label: 'ID', type: 'id' },
    { key: 'status', label: 'Status', type: 'enum', options: ['planned', 'in progress', 'done', 'blocked', 'frogged'] },
    { key: 'planned_date', label: 'Planned', type: 'date' },
    { key: 'started_date', label: 'Started', type: 'date' },
    { key: 'done_date', label: 'Done', type: 'date' },
    { key: 'blocked_date', label: 'Blocked', type: 'date' },
    { key: 'main_yarn', label: 'Main colour', type: 'ref', refTable: 'yarns' },
    { key: 'position', label: 'Position', type: 'number' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
})

const done = (id: string, doneDate: string) => ({ id, status: 'done', done_date: doneDate })

describe('planBulkEdit', () => {
  it('offers every field but the id', () => {
    expect(bulkEditableFields(schema).map((f) => f.key)).not.toContain('id')
    expect(planBulkEdit(schema, [done('S1', '2026-10-01')], 'id', 'S9').error).toMatch(/cannot be changed/)
    expect(planBulkEdit(schema, [done('S1', '2026-10-01')], 'nope', 'x').error).toMatch(/cannot be changed/)
  })

  it('blocks a batch on one chosen day, keeping the day each was finished', () => {
    const plan = planBulkEdit(schema, [done('S1', '2026-10-01'), done('S2', '2026-10-20')], 'status', 'blocked', {
      date: '2026-11-08',
    })
    expect(plan.error).toBeNull()
    expect(plan.writes).toEqual([
      { id: 'S1', values: { status: 'blocked', blocked_date: '2026-11-08' } },
      { id: 'S2', values: { status: 'blocked', blocked_date: '2026-11-08' } },
    ])
    expect(plan.skipped).toEqual([])
  })

  it('fills the date of a status the new one implies, when that is blank', () => {
    const plan = planBulkEdit(schema, [{ id: 'S1', status: 'in progress', started_date: '2026-10-01' }], 'status', 'blocked', {
      date: '2026-11-08',
    })
    expect(plan.writes).toEqual([
      { id: 'S1', values: { status: 'blocked', done_date: '2026-11-08', blocked_date: '2026-11-08' } },
    ])
  })

  it('writes only the fields that differ, and nothing for a row already there', () => {
    const rows = [
      { id: 'S1', status: 'blocked', done_date: '2026-10-01', blocked_date: '2026-10-05' },
      done('S2', '2026-10-01'),
    ]
    const plan = planBulkEdit(schema, rows, 'status', 'blocked', { date: '2026-11-08' })
    expect(plan.unchanged).toEqual(['S1'])
    expect(plan.writes.map((w) => w.id)).toEqual(['S2'])
  })

  it('clears the dates of later statuses when a batch is moved back', () => {
    const rows = [{ id: 'S1', status: 'blocked', done_date: '2026-10-01', blocked_date: '2026-10-05' }]
    const plan = planBulkEdit(schema, rows, 'status', 'done', { date: '2026-11-08' })
    expect(plan.writes).toEqual([{ id: 'S1', values: { status: 'done', blocked_date: '' } }])
  })

  it('skips a row the edit would leave out of order, and says why', () => {
    const plan = planBulkEdit(schema, [done('S1', '2026-10-01'), done('S2', '2026-11-09')], 'status', 'blocked', {
      date: '2026-11-08',
    })
    expect(plan.writes.map((w) => w.id)).toEqual(['S1'])
    expect(plan.skipped).toEqual([{ id: 'S2', reason: 'Blocked is before Done (2026-11-09)' }])
  })

  it('refuses a value the field would refuse, before looking at any row', () => {
    expect(planBulkEdit(schema, [done('S1', '2026-10-01')], 'position', 'third')).toMatchObject({
      error: 'Position must be a number',
      writes: [],
    })
    const refIds = new Set(['Y1'])
    expect(planBulkEdit(schema, [done('S1', '2026-10-01')], 'main_yarn', 'Y9', { refIds }).error).not.toBeNull()
    expect(planBulkEdit(schema, [done('S1', '2026-10-01')], 'main_yarn', 'Y1', { refIds }).writes).toEqual([
      { id: 'S1', values: { main_yarn: 'Y1' } },
    ])
  })

  it('needs a real date exactly when the status writes one', () => {
    expect(bulkEditNeedsDate(schema, 'status', 'blocked')).toBe(true)
    expect(bulkEditNeedsDate(schema, 'status', 'frogged')).toBe(false)
    expect(bulkEditNeedsDate(schema, 'notes', 'blocked')).toBe(false)

    const rows = [done('S1', '2026-10-01')]
    expect(planBulkEdit(schema, rows, 'status', 'blocked').error).toBe('Date is required')
    expect(planBulkEdit(schema, rows, 'status', 'blocked', { date: '8 Nov' }).error).toMatch(/YYYY-MM-DD/)
    expect(planBulkEdit(schema, rows, 'status', 'frogged').error).toBeNull()
  })

  it('sets or clears a plain field without judging the rest of the row', () => {
    // S1 breaks a status-date rule already (done with no done date); a note neither causes nor hides that.
    const rows: CsvRow[] = [
      { id: 'S1', status: 'done', notes: 'old' },
      { id: 'S2', status: 'done', done_date: '2026-10-01' },
    ]
    expect(planBulkEdit(schema, rows, 'notes', 'for the border').writes.map((w) => w.id)).toEqual(['S1', 'S2'])
    const cleared = planBulkEdit(schema, rows, 'notes', '')
    expect(cleared.writes).toEqual([{ id: 'S1', values: { notes: '' } }])
    expect(cleared.unchanged).toEqual(['S2'])
  })

  it('checks the status rules when a status date itself is set in bulk', () => {
    const rows = [done('S1', '2026-10-01'), { id: 'S2', status: 'blocked', done_date: '2026-10-01', blocked_date: '2026-10-02' }]
    const plan = planBulkEdit(schema, rows, 'blocked_date', '2026-11-08')
    expect(plan.skipped).toEqual([{ id: 'S1', reason: 'Blocked is set but the status is only done' }])
    expect(plan.writes).toEqual([{ id: 'S2', values: { blocked_date: '2026-11-08' } }])
  })
})
