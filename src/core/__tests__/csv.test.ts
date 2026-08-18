import { describe, expect, it } from 'vitest'
import { parseCsv } from '../csv/parse'
import { serializeCsv } from '../csv/serialize'
import { applyDelete, applyUpsert, ensureColumns, nextId } from '../csv/table'

describe('parseCsv', () => {
  it('handles quoted commas, embedded quotes and newlines', () => {
    const text = [
      'id,notes',
      'S001,"Tension is tight, but fine"',
      'S002,"She said ""snug"" not tight"',
      'S003,"line one\nline two"',
      '',
    ].join('\n')

    const table = parseCsv(text)
    expect(table.rows).toHaveLength(3)
    expect(table.rows[0].notes).toBe('Tension is tight, but fine')
    expect(table.rows[1].notes).toBe('She said "snug" not tight')
    expect(table.rows[2].notes).toBe('line one\nline two')
  })

  it('keeps the header order from the file', () => {
    const table = parseCsv('notes,id,date\nhi,S001,2026-01-01\n')
    expect(table.columns).toEqual(['notes', 'id', 'date'])
  })

  it('fills missing trailing cells rather than producing undefined', () => {
    const table = parseCsv('id,a,b\nS001,x\n')
    expect(table.rows[0]).toEqual({ id: 'S001', a: 'x', b: '' })
  })

  it('reads a single-column file, which has no delimiter to detect', () => {
    const table = parseCsv('id\nS001\nS002\n')
    expect(table.columns).toEqual(['id'])
    expect(table.rows).toEqual([{ id: 'S001' }, { id: 'S002' }])
  })

  it('never guesses the delimiter from content', () => {
    // `extra_yarns` is a semicolon-delimited list, so a file full of multi-colour squares contains
    // more semicolons than commas. Delimiter auto-detection would parse this completely wrong.
    const table = parseCsv('id,extra_yarns\nS001,Y01;Y02;Y03;Y04\nS002,Y05;Y06;Y07;Y08\n')
    expect(table.columns).toEqual(['id', 'extra_yarns'])
    expect(table.rows[0]).toEqual({ id: 'S001', extra_yarns: 'Y01;Y02;Y03;Y04' })
  })
})

describe('serializeCsv', () => {
  it('round-trips without changing anything', () => {
    const text = 'id,notes\nS001,plain\nS002,"has, comma"\n'
    expect(serializeCsv(parseCsv(text), { sortBy: 'id' })).toBe(text)
  })

  it('quotes only what needs quoting, so diffs stay small', () => {
    const table = parseCsv('id,notes\nS001,plain\n')
    table.rows[0].notes = 'now, with comma'
    expect(serializeCsv(table)).toBe('id,notes\nS001,"now, with comma"\n')
  })

  it('sorts rows naturally so unpadded hand-edited ids still land in order', () => {
    const table = parseCsv('id\nS10\nS9\nS1\n')
    expect(serializeCsv(table, { sortBy: 'id' })).toBe('id\nS1\nS9\nS10\n')
  })

  it('always ends with exactly one newline', () => {
    expect(serializeCsv(parseCsv('id\nS001'))).toBe('id\nS001\n')
  })
})

describe('round-trip safety', () => {
  it('preserves a column the app knows nothing about', () => {
    // The scenario: a column added by hand in a spreadsheet, then a square edited in the app.
    const text = 'id,notes,hook_size\nS001,first,4.0mm\nS002,second,3.5mm\n'
    const table = parseCsv(text)
    const edited = applyUpsert(table, 'id', 'S001', { notes: 'changed' })
    const out = serializeCsv(edited, { sortBy: 'id' })

    expect(out).toBe('id,notes,hook_size\nS001,changed,4.0mm\nS002,second,3.5mm\n')
    expect(out).toContain('hook_size')
    expect(out).toContain('4.0mm')
  })

  it('preserves rows it never touched', () => {
    const table = parseCsv('id,notes\nS001,a\nS002,b\nS003,c\n')
    const edited = applyUpsert(table, 'id', 'S002', { notes: 'B' })
    expect(serializeCsv(edited, { sortBy: 'id' })).toBe('id,notes\nS001,a\nS002,B\nS003,c\n')
  })

  it('appends new schema columns at the end without reordering existing ones', () => {
    const table = parseCsv('id,notes\nS001,a\n')
    const widened = ensureColumns(table, ['id', 'notes', 'position'])
    expect(widened.columns).toEqual(['id', 'notes', 'position'])
    expect(serializeCsv(widened, { sortBy: 'id' })).toBe('id,notes,position\nS001,a,\n')
  })
})

describe('applyUpsert', () => {
  it('merges only the supplied fields', () => {
    const table = parseCsv('id,a,b\nS001,1,2\n')
    const out = applyUpsert(table, 'id', 'S001', { a: '9' })
    expect(out.rows[0]).toEqual({ id: 'S001', a: '9', b: '2' })
  })

  it('creates the row when the id is new, filling other columns blank', () => {
    const table = parseCsv('id,a,b\nS001,1,2\n')
    const out = applyUpsert(table, 'id', 'S002', { a: '5' })
    expect(out.rows).toHaveLength(2)
    expect(out.rows[1]).toEqual({ id: 'S002', a: '5', b: '' })
  })

  it('adds a column for a field the file does not have yet', () => {
    const table = parseCsv('id,a\nS001,1\n')
    const out = applyUpsert(table, 'id', 'S001', { newthing: 'x' })
    expect(out.columns).toEqual(['id', 'a', 'newthing'])
    expect(out.rows[0].newthing).toBe('x')
  })
})

describe('applyDelete', () => {
  it('removes just that row', () => {
    const table = parseCsv('id\nS001\nS002\n')
    expect(applyDelete(table, 'id', 'S001').rows).toEqual([{ id: 'S002' }])
  })
})

describe('nextId', () => {
  it('continues the sequence', () => {
    expect(nextId(parseCsv('id\nS001\nS002\n'), 'id', 'S', 3)).toBe('S003')
  })

  it('starts at 1 on an empty table', () => {
    expect(nextId(parseCsv('id\n'), 'id', 'S', 3)).toBe('S001')
  })

  it('does not reuse a deleted id', () => {
    // S002 is gone, but reusing it would make older notes point at the wrong square.
    expect(nextId(parseCsv('id\nS001\nS003\n'), 'id', 'S', 3)).toBe('S004')
  })

  it('keeps going past the padding width', () => {
    expect(nextId(parseCsv('id\nS999\n'), 'id', 'S', 3)).toBe('S1000')
  })

  it('ignores ids with a different prefix', () => {
    expect(nextId(parseCsv('id\nY01\nS002\n'), 'id', 'S', 3)).toBe('S003')
  })
})
