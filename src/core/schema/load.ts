import type { FieldDef, FieldType, SchemaSet, TableSchema } from './types'

export class SchemaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SchemaError'
  }
}

const FIELD_TYPES: readonly FieldType[] = [
  'id', 'text', 'textarea', 'number', 'date', 'bool', 'enum', 'ref', 'reflist', 'color', 'url',
]

function str(obj: Record<string, unknown>, key: string, where: string): string {
  const v = obj[key]
  if (typeof v !== 'string' || v.length === 0) {
    throw new SchemaError(`${where}: "${key}" must be a non-empty string`)
  }
  return v
}

function parseField(raw: unknown, where: string): FieldDef {
  if (typeof raw !== 'object' || raw === null) throw new SchemaError(`${where}: field must be an object`)
  const o = raw as Record<string, unknown>
  const key = str(o, 'key', where)
  const type = str(o, 'type', `${where}.${key}`) as FieldType
  if (!FIELD_TYPES.includes(type)) {
    throw new SchemaError(`${where}.${key}: unknown field type "${type}"`)
  }
  if (type === 'enum' && !Array.isArray(o.options)) {
    throw new SchemaError(`${where}.${key}: enum fields need an "options" array`)
  }
  if ((type === 'ref' || type === 'reflist') && typeof o.refTable !== 'string') {
    throw new SchemaError(`${where}.${key}: ${type} fields need a "refTable"`)
  }
  return {
    key,
    label: str(o, 'label', `${where}.${key}`),
    type,
    list: o.list === true,
    filter: o.filter === true,
    required: o.required === true,
    help: typeof o.help === 'string' ? o.help : undefined,
    default: typeof o.default === 'string' ? o.default : undefined,
    options: Array.isArray(o.options) ? (o.options as string[]) : undefined,
    refTable: typeof o.refTable === 'string' ? o.refTable : undefined,
    separator: typeof o.separator === 'string' ? o.separator : undefined,
    defaultToday: o.defaultToday === true,
  }
}

export function parseTableSchema(raw: unknown): TableSchema {
  if (typeof raw !== 'object' || raw === null) throw new SchemaError('schema must be an object')
  const o = raw as Record<string, unknown>
  const table = str(o, 'table', 'schema')
  const where = `schema[${table}]`

  if (!Array.isArray(o.fields) || o.fields.length === 0) {
    throw new SchemaError(`${where}: "fields" must be a non-empty array`)
  }
  const fields = o.fields.map((f) => parseField(f, where))

  const seen = new Set<string>()
  for (const f of fields) {
    if (seen.has(f.key)) throw new SchemaError(`${where}: duplicate field "${f.key}"`)
    seen.add(f.key)
  }

  const idField = str(o, 'idField', where)
  if (!seen.has(idField)) throw new SchemaError(`${where}: idField "${idField}" is not a field`)

  const titleField = typeof o.titleField === 'string' ? o.titleField : idField
  if (!seen.has(titleField)) throw new SchemaError(`${where}: titleField "${titleField}" is not a field`)

  return {
    table,
    file: str(o, 'file', where),
    label: str(o, 'label', where),
    labelSingular: typeof o.labelSingular === 'string' ? o.labelSingular : str(o, 'label', where),
    icon: typeof o.icon === 'string' ? o.icon : undefined,
    idField,
    idPrefix: typeof o.idPrefix === 'string' ? o.idPrefix : '',
    idPadding: typeof o.idPadding === 'number' ? o.idPadding : 3,
    titleField,
    subtitleField: typeof o.subtitleField === 'string' ? o.subtitleField : undefined,
    swatchField: typeof o.swatchField === 'string' ? o.swatchField : undefined,
    goal: typeof o.goal === 'number' ? o.goal : undefined,
    fields,
  }
}

/**
 * Build the schema set from the manifest plus one JSON per table.
 *
 * Cross-table checks happen here rather than per-file, because a `ref` pointing at a table that
 * does not exist is only detectable once every schema is in hand.
 */
export function buildSchemaSet(manifest: unknown, rawTables: Record<string, unknown>): SchemaSet {
  if (typeof manifest !== 'object' || manifest === null) throw new SchemaError('tables.json must be an object')
  const m = manifest as Record<string, unknown>
  if (!Array.isArray(m.tables)) throw new SchemaError('tables.json: "tables" must be an array')
  const order = m.tables as string[]

  const tables: Record<string, TableSchema> = {}
  for (const name of order) {
    const raw = rawTables[name]
    if (raw === undefined) throw new SchemaError(`tables.json lists "${name}" but no schema was loaded for it`)
    const schema = parseTableSchema(raw)
    if (schema.table !== name) {
      throw new SchemaError(`schema[${name}]: "table" says "${schema.table}"`)
    }
    tables[name] = schema
  }

  for (const schema of Object.values(tables)) {
    for (const field of schema.fields) {
      if (field.refTable && !tables[field.refTable]) {
        throw new SchemaError(
          `schema[${schema.table}].${field.key}: refTable "${field.refTable}" is not a known table`,
        )
      }
    }
  }

  return { version: typeof m.version === 'number' ? m.version : 1, tables, order }
}

/** Path of a table's schema file, given the manifest path convention. */
export function schemaPath(dataDir: string, table: string): string {
  return `${dataDir}/schema/${table}.json`
}

export function manifestPath(dataDir: string): string {
  return `${dataDir}/schema/tables.json`
}
