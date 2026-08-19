import { describe, expect, it } from 'vitest'
import { parseCsv } from '../csv'
import { buildSchemaSet, SchemaError } from '../schema/load'
import { validateDataset, validateValue } from '../schema/validate'
import type { FieldDef } from '../schema'

function field(partial: Partial<FieldDef> & Pick<FieldDef, 'key' | 'type'>): FieldDef {
  return { label: partial.key, ...partial } as FieldDef
}

describe('validateValue', () => {
  it('accepts an empty optional value', () => {
    expect(validateValue(field({ key: 'notes', type: 'text' }), '')).toBeNull()
  })

  it('rejects an empty required value', () => {
    expect(validateValue(field({ key: 'name', type: 'text', required: true }), '')).toMatch(/required/)
  })

  it('checks date shape and reality', () => {
    const f = field({ key: 'date', type: 'date' })
    expect(validateValue(f, '2026-08-17')).toBeNull()
    expect(validateValue(f, '17/08/2026')).toMatch(/YYYY-MM-DD/)
    expect(validateValue(f, '2026-13-01')).toMatch(/not a real date/)
  })

  it('checks enum membership', () => {
    const f = field({ key: 'status', type: 'enum', options: ['done', 'planned'] })
    expect(validateValue(f, 'done')).toBeNull()
    expect(validateValue(f, 'dune')).toMatch(/must be one of/)
  })

  it('checks hex colours', () => {
    const f = field({ key: 'hex', type: 'color' })
    expect(validateValue(f, '#C98B94')).toBeNull()
    expect(validateValue(f, '#abc')).toBeNull()
    expect(validateValue(f, 'rose')).toMatch(/hex colour/)
  })

  it('checks referential integrity for ref and reflist', () => {
    const ids = new Set(['Y01', 'Y02'])
    expect(validateValue(field({ key: 'main', type: 'ref', refTable: 'yarns' }), 'Y01', ids)).toBeNull()
    expect(validateValue(field({ key: 'main', type: 'ref', refTable: 'yarns' }), 'Y09', ids)).toMatch(/does not exist/)

    const list = field({ key: 'extra', type: 'reflist', refTable: 'yarns' })
    expect(validateValue(list, 'Y01;Y02', ids)).toBeNull()
    expect(validateValue(list, 'Y01;Y09', ids)).toMatch(/Y09/)
  })

  it('skips reference checks when the lookup table is not loaded', () => {
    expect(validateValue(field({ key: 'main', type: 'ref', refTable: 'yarns' }), 'Y09')).toBeNull()
  })
})

describe('buildSchemaSet', () => {
  const yarns = {
    table: 'yarns',
    file: 'data/yarns.csv',
    label: 'Yarns',
    labelSingular: 'Yarn',
    idField: 'id',
    titleField: 'name',
    fields: [
      { key: 'id', label: 'ID', type: 'id' },
      { key: 'name', label: 'Name', type: 'text' },
    ],
  }

  it('builds a valid set', () => {
    const set = buildSchemaSet({ version: 1, tables: ['yarns'] }, { yarns })
    expect(set.order).toEqual(['yarns'])
    expect(set.tables.yarns.idPadding).toBe(3) // defaulted
  })

  it('rejects an unknown field type', () => {
    const bad = { ...yarns, fields: [{ key: 'id', label: 'ID', type: 'quantum' }] }
    expect(() => buildSchemaSet({ tables: ['yarns'] }, { yarns: bad })).toThrow(SchemaError)
  })

  it('rejects a ref pointing at a table that does not exist', () => {
    const bad = {
      ...yarns,
      fields: [...yarns.fields, { key: 'x', label: 'X', type: 'ref', refTable: 'nope' }],
    }
    expect(() => buildSchemaSet({ tables: ['yarns'] }, { yarns: bad })).toThrow(/not a known table/)
  })

  it('rejects an idField that is not a field', () => {
    const bad = { ...yarns, idField: 'missing' }
    expect(() => buildSchemaSet({ tables: ['yarns'] }, { yarns: bad })).toThrow(/idField/)
  })

  it('rejects duplicate field keys', () => {
    const bad = { ...yarns, fields: [...yarns.fields, { key: 'name', label: 'Again', type: 'text' }] }
    expect(() => buildSchemaSet({ tables: ['yarns'] }, { yarns: bad })).toThrow(/duplicate field/)
  })

  it('parses searchFields and sortable on a field', () => {
    const withExtras = {
      ...yarns,
      fields: [...yarns.fields, { key: 'x', label: 'X', type: 'ref', refTable: 'yarns', searchFields: ['name'], sortable: true }],
    }
    const set = buildSchemaSet({ tables: ['yarns'] }, { yarns: withExtras })
    const field = set.tables.yarns.fields.find((f) => f.key === 'x')
    expect(field?.searchFields).toEqual(['name'])
    expect(field?.sortable).toBe(true)
  })

  it('parses filterMode on a field', () => {
    const withExtras = {
      ...yarns,
      fields: [...yarns.fields, { key: 'x', label: 'X', type: 'number', filter: true, filterMode: 'min' }],
    }
    const set = buildSchemaSet({ tables: ['yarns'] }, { yarns: withExtras })
    expect(set.tables.yarns.fields.find((f) => f.key === 'x')?.filterMode).toBe('min')
  })

  it('rejects an invalid filterMode', () => {
    const bad = {
      ...yarns,
      fields: [...yarns.fields, { key: 'x', label: 'X', type: 'number', filterMode: 'nope' }],
    }
    expect(() => buildSchemaSet({ tables: ['yarns'] }, { yarns: bad })).toThrow(/filterMode/)
  })

  it('accepts a defaultSort naming a sortable field', () => {
    const withSort = {
      ...yarns,
      defaultSort: { key: 'name' },
      fields: [{ key: 'id', label: 'ID', type: 'id' }, { key: 'name', label: 'Name', type: 'text', sortable: true }],
    }
    const set = buildSchemaSet({ tables: ['yarns'] }, { yarns: withSort })
    expect(set.tables.yarns.defaultSort).toEqual({ key: 'name' })
  })

  it('accepts the built-in "id"/"title" defaultSort keys without a matching sortable field', () => {
    const withSort = { ...yarns, defaultSort: { key: 'title', direction: 'desc' } }
    const set = buildSchemaSet({ tables: ['yarns'] }, { yarns: withSort })
    expect(set.tables.yarns.defaultSort).toEqual({ key: 'title', direction: 'desc' })
  })

  it('rejects a defaultSort naming a field that is not sortable', () => {
    const bad = { ...yarns, defaultSort: { key: 'name' } }
    expect(() => buildSchemaSet({ tables: ['yarns'] }, { yarns: bad })).toThrow(/defaultSort/)
  })

  it('accepts a table-level derivedFilters entry that hops through a valid ref', () => {
    const squares = {
      table: 'squares',
      file: 'data/squares.csv',
      label: 'Squares',
      labelSingular: 'Square',
      idField: 'id',
      titleField: 'id',
      derivedFilters: [{ key: 'src', label: 'Source', via: 'ref_field', throughField: 'name' }],
      fields: [
        { key: 'id', label: 'ID', type: 'id' },
        { key: 'ref_field', label: 'Ref', type: 'ref', refTable: 'yarns' },
      ],
    }
    const set = buildSchemaSet({ tables: ['yarns', 'squares'] }, { yarns, squares })
    expect(set.tables.squares.derivedFilters).toEqual([
      { key: 'src', label: 'Source', via: 'ref_field', throughField: 'name' },
    ])
  })

  it('rejects a derivedFilters "via" that is not a ref field', () => {
    const squares = {
      table: 'squares',
      file: 'data/squares.csv',
      label: 'Squares',
      labelSingular: 'Square',
      idField: 'id',
      titleField: 'id',
      derivedFilters: [{ key: 'src', label: 'Source', via: 'id', throughField: 'name' }],
      fields: [{ key: 'id', label: 'ID', type: 'id' }],
    }
    expect(() => buildSchemaSet({ tables: ['squares'] }, { squares })).toThrow(/must name a ref field/)
  })

  it('rejects a derivedFilters "throughField" that does not exist on the target table', () => {
    const squares = {
      table: 'squares',
      file: 'data/squares.csv',
      label: 'Squares',
      labelSingular: 'Square',
      idField: 'id',
      titleField: 'id',
      derivedFilters: [{ key: 'src', label: 'Source', via: 'ref_field', throughField: 'nope' }],
      fields: [
        { key: 'id', label: 'ID', type: 'id' },
        { key: 'ref_field', label: 'Ref', type: 'ref', refTable: 'yarns' },
      ],
    }
    expect(() => buildSchemaSet({ tables: ['yarns', 'squares'] }, { yarns, squares })).toThrow(
      /is not a field on "yarns"/,
    )
  })
})

describe('validateDataset', () => {
  const schemas = buildSchemaSet(
    { tables: ['squares', 'yarns'] },
    {
      squares: {
        table: 'squares',
        file: 'data/squares.csv',
        label: 'Squares',
        labelSingular: 'Square',
        idField: 'id',
        titleField: 'id',
        fields: [
          { key: 'id', label: 'ID', type: 'id' },
          { key: 'status', label: 'Status', type: 'enum', options: ['done', 'planned'] },
          { key: 'main_yarn', label: 'Main', type: 'ref', refTable: 'yarns' },
        ],
      },
      yarns: {
        table: 'yarns',
        file: 'data/yarns.csv',
        label: 'Yarns',
        labelSingular: 'Yarn',
        idField: 'id',
        titleField: 'name',
        fields: [
          { key: 'id', label: 'ID', type: 'id' },
          { key: 'name', label: 'Name', type: 'text', required: true },
        ],
      },
    },
  )

  it('passes clean data', () => {
    const issues = validateDataset(schemas, {
      squares: parseCsv('id,status,main_yarn\nS001,done,Y01\n'),
      yarns: parseCsv('id,name\nY01,Cream\n'),
    })
    expect(issues).toEqual([])
  })

  it('catches a dangling reference', () => {
    const issues = validateDataset(schemas, {
      squares: parseCsv('id,status,main_yarn\nS001,done,Y99\n'),
      yarns: parseCsv('id,name\nY01,Cream\n'),
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ table: 'squares', rowId: 'S001', field: 'main_yarn' })
  })

  it('catches a duplicate id', () => {
    const issues = validateDataset(schemas, {
      squares: parseCsv('id,status,main_yarn\nS001,done,Y01\nS001,planned,Y01\n'),
      yarns: parseCsv('id,name\nY01,Cream\n'),
    })
    expect(issues.some((i) => i.message.includes('duplicate id'))).toBe(true)
  })

  it('catches a status that is not in the schema', () => {
    const issues = validateDataset(schemas, {
      squares: parseCsv('id,status,main_yarn\nS001,dune,Y01\n'),
      yarns: parseCsv('id,name\nY01,Cream\n'),
    })
    expect(issues.some((i) => i.field === 'status')).toBe(true)
  })

  it('catches a row with no id', () => {
    const issues = validateDataset(schemas, {
      squares: parseCsv('id,status,main_yarn\n,done,Y01\n'),
      yarns: parseCsv('id,name\nY01,Cream\n'),
    })
    expect(issues.some((i) => i.message === 'row has no id')).toBe(true)
  })
})
