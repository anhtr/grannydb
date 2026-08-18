/**
 * Field types the app knows how to render, validate and store.
 *
 * Adding a type is a one-entry change in `fieldTypes.tsx`. `image` is deliberately absent for now
 * but the registry shape is what makes adding it a feature rather than a refactor.
 */
export type FieldType =
  | 'id'
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'bool'
  | 'enum'
  | 'ref'
  | 'reflist'
  | 'color'
  | 'url'

export interface FieldDef {
  key: string
  label: string
  type: FieldType
  /** Show this field as a column/line in list views. */
  list?: boolean
  /** Offer this field as a filter control. */
  filter?: boolean
  required?: boolean
  help?: string
  default?: string
  /** `enum` only. */
  options?: string[]
  /** `ref` and `reflist` only: which table the value points at. */
  refTable?: string
  /** `reflist` only: separator used inside the single cell. Defaults to ';'. */
  separator?: string
  /** `date` only: prefill today's date on new records. */
  defaultToday?: boolean
  /**
   * `ref` only: offer a "+ New <thing>" affordance that creates a row in `refTable` (setting only
   * its title field) without leaving the current form. For a target table where most rows are
   * one-offs — a design used by exactly one square — a separate create screen is pure friction.
   */
  quickCreate?: boolean
}

export interface TableSchema {
  table: string
  /** Path of the CSV inside the data repo, e.g. `data/squares.csv`. */
  file: string
  label: string
  labelSingular: string
  icon?: string
  idField: string
  idPrefix: string
  idPadding: number
  /** Field used as the headline in list views. */
  titleField: string
  /**
   * Shown instead when `titleField` is blank, e.g. `"{product_id} ({name})"`. `{key}` interpolates
   * another field on the same row. Falls back to the row id if the referenced fields are also blank.
   */
  titleFallback?: string
  subtitleField?: string
  /** Field holding a hex colour, used to draw a swatch. */
  swatchField?: string
  /** Target count, if this table is something you are working toward. */
  goal?: number
  /**
   * Keep this table out of the bottom nav. For a table that exists mainly as a lookup for other
   * tables' `ref` fields (few rows, rarely browsed on its own), a tab is pure clutter — it is still
   * fully addressable at `/<table>` and reachable by tapping a `ref` chip that points at it.
   */
  hideFromNav?: boolean
  fields: FieldDef[]
}

export interface SchemaSet {
  version: number
  tables: Record<string, TableSchema>
  order: string[]
}

export function fieldByKey(schema: TableSchema, key: string): FieldDef | undefined {
  return schema.fields.find((f) => f.key === key)
}

export function listFields(schema: TableSchema): FieldDef[] {
  return schema.fields.filter((f) => f.list)
}

export function filterFields(schema: TableSchema): FieldDef[] {
  return schema.fields.filter((f) => f.filter)
}

/** Column order the writer should use for a table it has a schema for. */
export function schemaColumns(schema: TableSchema): string[] {
  return schema.fields.map((f) => f.key)
}

/**
 * The headline to show for a row: `titleField` if set, else `titleFallback` with its `{key}`
 * placeholders filled in, else the row id. Centralised so every list, chip and quick-create shares
 * one rule instead of each screen re-deciding what "blank" means.
 */
export function titleFor(schema: TableSchema, row: Record<string, string>): string {
  const direct = (row[schema.titleField] ?? '').trim()
  if (direct !== '') return direct

  const template = schema.titleFallback
  if (template) {
    const keys = [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
    if (keys.some((key) => (row[key] ?? '').trim() !== '')) {
      return template.replace(/\{(\w+)\}/g, (_, key: string) => row[key] ?? '')
    }
  }

  return row[schema.idField] ?? ''
}
