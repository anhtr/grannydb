import type { CsvRow, CsvTable } from '../csv/types'
import type { FieldDef, SchemaSet, TableSchema } from './types'

export interface Issue {
  table: string
  rowId: string
  field?: string
  message: string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const BOOL_VALUES = new Set(['yes', 'no', 'true', 'false', '1', '0', ''])

export function splitList(value: string, separator = ';'): string[] {
  return value
    .split(separator)
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
}

export function joinList(values: readonly string[], separator = ';'): string {
  return values.filter((v) => v.trim().length > 0).join(separator)
}

export function parseBool(value: string): boolean {
  const v = value.trim().toLowerCase()
  return v === 'yes' || v === 'true' || v === '1'
}

export function formatBool(value: boolean): string {
  return value ? 'yes' : 'no'
}

/**
 * Validate one field value. Returns a message, or null when fine.
 *
 * `refIds` is the set of ids that exist in the referenced table; pass undefined to skip referential
 * checks (the form does this while a lookup table is still loading).
 */
export function validateValue(
  field: FieldDef,
  value: string,
  refIds?: ReadonlySet<string>,
): string | null {
  const v = value.trim()

  if (field.required && v === '') return `${field.label} is required`
  if (v === '') return null

  switch (field.type) {
    case 'number':
      if (!Number.isFinite(Number(v))) return `${field.label} must be a number`
      return null
    case 'date':
      if (!DATE_RE.test(v)) return `${field.label} must look like YYYY-MM-DD`
      if (Number.isNaN(Date.parse(v))) return `${field.label} is not a real date`
      return null
    case 'bool':
      if (!BOOL_VALUES.has(v.toLowerCase())) return `${field.label} must be yes or no`
      return null
    case 'enum':
      if (field.options && !field.options.includes(v)) {
        return `${field.label} must be one of: ${field.options.join(', ')}`
      }
      return null
    case 'color':
      if (!HEX_RE.test(v)) return `${field.label} must be a hex colour like #C98B94`
      return null
    case 'colorlist': {
      const bad = splitList(v, field.separator).filter((h) => !HEX_RE.test(h))
      if (bad.length > 0) {
        return `${field.label} must be hex colours like #C98B94 (not ${bad.join(', ')})`
      }
      return null
    }
    case 'url':
      try {
        new URL(v)
        return null
      } catch {
        return `${field.label} must be a full URL`
      }
    case 'ref':
      if (refIds && !refIds.has(v)) return `${field.label} points at "${v}", which does not exist`
      return null
    case 'reflist': {
      if (!refIds) return null
      const missing = splitList(v, field.separator).filter((id) => !refIds.has(id))
      if (missing.length > 0) {
        return `${field.label} points at ${missing.join(', ')}, which do not exist`
      }
      return null
    }
    default:
      return null
  }
}

export function validateRow(
  schema: TableSchema,
  row: CsvRow,
  refIdsByTable: Record<string, ReadonlySet<string>>,
): Issue[] {
  const issues: Issue[] = []
  const rowId = row[schema.idField] ?? '(no id)'
  for (const field of schema.fields) {
    const message = validateValue(
      field,
      row[field.key] ?? '',
      field.refTable ? refIdsByTable[field.refTable] : undefined,
    )
    if (message) issues.push({ table: schema.table, rowId, field: field.key, message })
  }
  return issues
}

export function idSet(table: CsvTable, idField: string): Set<string> {
  return new Set(table.rows.map((r) => r[idField] ?? '').filter((id) => id !== ''))
}

/**
 * Whole-dataset validation, shared by the browser and the build pipeline.
 *
 * Running the *same* function in CI and in the app is the point: the build fails on a malformed
 * hand-edit before it can reach anyone's phone.
 */
export function validateDataset(
  schemas: SchemaSet,
  tables: Record<string, CsvTable>,
): Issue[] {
  const issues: Issue[] = []

  const refIdsByTable: Record<string, ReadonlySet<string>> = {}
  for (const name of schemas.order) {
    const table = tables[name]
    const schema = schemas.tables[name]
    if (table && schema) refIdsByTable[name] = idSet(table, schema.idField)
  }

  for (const name of schemas.order) {
    const schema = schemas.tables[name]
    const table = tables[name]
    if (!schema) continue
    if (!table) {
      issues.push({ table: name, rowId: '', message: `no data loaded for table "${name}"` })
      continue
    }

    const seen = new Set<string>()
    for (const row of table.rows) {
      const id = row[schema.idField] ?? ''
      if (id === '') {
        issues.push({ table: name, rowId: '', field: schema.idField, message: 'row has no id' })
      } else if (seen.has(id)) {
        issues.push({ table: name, rowId: id, field: schema.idField, message: `duplicate id "${id}"` })
      } else {
        seen.add(id)
      }
      issues.push(...validateRow(schema, row, refIdsByTable))
    }
  }

  return issues
}
