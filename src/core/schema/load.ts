import type { DerivedFilterDef, FieldDef, FieldType, SchemaSet, TableSchema } from './types'

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
  if (o.filterMode !== undefined && o.filterMode !== 'exact' && o.filterMode !== 'min') {
    throw new SchemaError(`${where}.${key}: "filterMode" must be "exact" or "min"`)
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
    quickCreate: o.quickCreate === true,
    searchFields: Array.isArray(o.searchFields) ? (o.searchFields as string[]) : undefined,
    sortable: o.sortable === true,
    filterMode: o.filterMode === 'min' ? 'min' : undefined,
  }
}

function parseDefaultSort(raw: unknown, where: string): { key: string; direction?: 'asc' | 'desc' } {
  if (typeof raw !== 'object' || raw === null) throw new SchemaError(`${where}: "defaultSort" must be an object`)
  const o = raw as Record<string, unknown>
  const direction = o.direction
  if (direction !== undefined && direction !== 'asc' && direction !== 'desc') {
    throw new SchemaError(`${where}: "defaultSort.direction" must be "asc" or "desc"`)
  }
  return { key: str(o, 'key', where), direction }
}

function parseDerivedFilter(raw: unknown, where: string): DerivedFilterDef {
  if (typeof raw !== 'object' || raw === null) {
    throw new SchemaError(`${where}: derived filter must be an object`)
  }
  const o = raw as Record<string, unknown>
  return {
    key: str(o, 'key', where),
    label: str(o, 'label', where),
    via: str(o, 'via', where),
    throughField: str(o, 'throughField', where),
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

  const defaultSort =
    o.defaultSort !== undefined ? parseDefaultSort(o.defaultSort, `${where}.defaultSort`) : undefined
  if (defaultSort && defaultSort.key !== 'id' && defaultSort.key !== 'title') {
    const sortField = fields.find((f) => f.key === defaultSort.key)
    if (!sortField?.sortable) {
      throw new SchemaError(`${where}.defaultSort: "${defaultSort.key}" is not "id", "title", or a sortable field`)
    }
  }

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
    titleFallback: typeof o.titleFallback === 'string' ? o.titleFallback : undefined,
    subtitleField: typeof o.subtitleField === 'string' ? o.subtitleField : undefined,
    swatchField: typeof o.swatchField === 'string' ? o.swatchField : undefined,
    goal: typeof o.goal === 'number' ? o.goal : undefined,
    hideFromNav: o.hideFromNav === true,
    searchFields: Array.isArray(o.searchFields) ? (o.searchFields as string[]) : undefined,
    derivedFilters: Array.isArray(o.derivedFilters)
      ? o.derivedFilters.map((f) => parseDerivedFilter(f, `${where}.derivedFilters`))
      : undefined,
    defaultSort,
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

  // Derived filters hop through a ref field to a field on the table it points at, so both ends have
  // to exist — checkable only once every schema is loaded, same as the refTable check above.
  for (const schema of Object.values(tables)) {
    for (const filter of schema.derivedFilters ?? []) {
      const where = `schema[${schema.table}].derivedFilters.${filter.key}`
      const viaField = schema.fields.find((f) => f.key === filter.via)
      if (!viaField || !viaField.refTable) {
        throw new SchemaError(`${where}: "via" must name a ref field on "${schema.table}"`)
      }
      const viaSchema = tables[viaField.refTable]
      if (!viaSchema.fields.some((f) => f.key === filter.throughField)) {
        throw new SchemaError(
          `${where}: "throughField" "${filter.throughField}" is not a field on "${viaField.refTable}"`,
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
