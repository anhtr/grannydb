import { describe, expect, it } from 'vitest'
import { changeStatus, fillStatusDates, parseTableSchema, statusDate, statusDateIssues } from '../schema'

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
    { key: 'status', label: 'Status', type: 'enum', options: ['planned', 'in progress', 'done', 'blocked'] },
    { key: 'planned_date', label: 'Planned', type: 'date' },
    { key: 'started_date', label: 'Started', type: 'date' },
    { key: 'done_date', label: 'Done', type: 'date' },
    { key: 'blocked_date', label: 'Blocked', type: 'date' },
  ],
})

const fields = (row: Record<string, string>) => statusDateIssues(schema, row).map((i) => i.field)

describe('status dates', () => {
  it("requires the current status's date, and only that one", () => {
    expect(fields({ status: 'blocked', done_date: '2026-10-01', blocked_date: '2026-10-02' })).toEqual([])
    expect(fields({ status: 'done', done_date: '2026-10-01' })).toEqual([])
    expect(fields({ status: 'blocked', done_date: '2026-10-01' })).toEqual(['blocked_date'])
    expect(fields({ status: 'blocked', planned_date: '2026-10-01' })).toEqual(['blocked_date'])
  })

  it('needs at least one date when there is no status', () => {
    expect(fields({ status: '' })).toEqual(['status'])
    expect(fields({ status: '', done_date: '2026-10-01' })).toEqual([])
  })

  it('rejects a date for a status the row has not reached', () => {
    expect(fields({ status: 'done', done_date: '2026-10-01', blocked_date: '2026-10-02' })).toEqual(['blocked_date'])
  })

  it('keeps dates in workflow order, allowing the same day', () => {
    expect(fields({ status: 'blocked', done_date: '2026-10-01', blocked_date: '2026-10-01' })).toEqual([])
    expect(fields({ status: 'blocked', done_date: '2026-10-02', blocked_date: '2026-10-01' })).toEqual(['blocked_date'])
    // A skipped status doesn't break the chain: done is compared with planned.
    expect(fields({ status: 'done', planned_date: '2026-10-05', done_date: '2026-10-01' })).toEqual(['done_date'])
  })

  it('reads the date of the current status', () => {
    expect(statusDate(schema, { status: 'blocked', done_date: '2026-10-01', blocked_date: '2026-10-03' })).toBe('2026-10-03')
    expect(statusDate(schema, { status: '' })).toBe('')
  })

  it('dates a new row, filling implied statuses too', () => {
    expect(fillStatusDates(schema, { status: 'done' }, '2026-10-18')).toMatchObject({ done_date: '2026-10-18' })
    expect(fillStatusDates(schema, { status: 'blocked' }, '2026-10-18')).toMatchObject({
      done_date: '2026-10-18',
      blocked_date: '2026-10-18',
    })
  })

  it('fills a new status without overwriting, and clears later ones when moving back', () => {
    const done = { status: 'done', done_date: '2026-10-01' }
    expect(changeStatus(schema, done, 'blocked', '2026-10-18')).toMatchObject({
      status: 'blocked',
      done_date: '2026-10-01',
      blocked_date: '2026-10-18',
    })
    const blocked = { status: 'blocked', done_date: '2026-10-01', blocked_date: '2026-10-05' }
    expect(changeStatus(schema, blocked, 'done', '2026-10-18')).toMatchObject({ status: 'done', done_date: '2026-10-01', blocked_date: '' })
  })

  it('rejects a statusDates block that names things that do not exist', () => {
    const base = {
      table: 't',
      file: 'f',
      label: 'T',
      idField: 'id',
      fields: [
        { key: 'id', label: 'ID', type: 'id' },
        { key: 'status', label: 'Status', type: 'enum', options: ['done'] },
        { key: 'done_date', label: 'Done', type: 'date' },
        { key: 'notes', label: 'Notes', type: 'text' },
      ],
    }
    expect(() => parseTableSchema({ ...base, statusDates: { field: 'status', dates: { done: 'done_date' } } })).not.toThrow()
    expect(() => parseTableSchema({ ...base, statusDates: { field: 'status', dates: { finished: 'done_date' } } })).toThrow()
    expect(() => parseTableSchema({ ...base, statusDates: { field: 'status', dates: { done: 'notes' } } })).toThrow()
    expect(() => parseTableSchema({ ...base, statusDates: { field: 'notes', dates: {} } })).toThrow()
  })
})
