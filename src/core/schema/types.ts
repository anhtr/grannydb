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
  /**
   * `ref`/`reflist` only: which fields on the *referenced* row the picker's live search matches
   * against, e.g. a square's `design_id` searching the design's `name` and `source`. Omit to search
   * every field on the referenced row.
   */
  searchFields?: string[]
  /** Offer this field as a sort option in list views, alongside the built-in id and name sorts. */
  sortable?: boolean
  /**
   * `number` fields only, and only meaningful alongside `"filter": true`. `'exact'` (the default)
   * offers a dropdown of the distinct values present. `'min'` instead offers "N or more" thresholds
   * built from the distinct values present, e.g. yarn `skeins`: "find anything with at least 2 left"
   * is a range question, not a lookup of one exact count.
   */
  filterMode?: 'exact' | 'min'
  /**
   * When this field's own value is blank, read it instead by hopping through a `ref` field on this
   * row to a field on the row it points at — e.g. a square's blank `construction_type` falling back
   * to its design's. See `effectiveValue` in `core/schema/search.ts`.
   */
  inheritFrom?: InheritFromDef
}

/**
 * Where a blank field falls back to: `via` names a `ref` field on the same table, `throughField`
 * names the field to read on the row that `ref` points at. One hop only, same restriction as
 * `DerivedFilterDef` and for the same reason — a chain would need a second mechanism.
 */
export interface InheritFromDef {
  via: string
  throughField: string
}

/**
 * A filter computed by hopping through a `ref` field to a field on the table it points at, for
 * filtering by something this table does not store directly — e.g. a square's design's source.
 */
export interface DerivedFilterDef {
  key: string
  label: string
  /** A `ref` field on this table to hop through, e.g. "design_id". */
  via: string
  /** Field on the hopped-to table to read and offer as filter options, e.g. "source". */
  throughField: string
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
  /**
   * Which of this table's own fields the list search box matches against. Omit to search every
   * field — right for a table with few enough fields that "search everything" is the honest default.
   */
  searchFields?: string[]
  /** Filters computed by hopping through a `ref` field rather than read off a column directly. */
  derivedFilters?: DerivedFilterDef[]
  /**
   * Sort applied the first time this table's list is opened on a device, before any sort the person
   * picks themselves gets saved locally (see `core/prefs`). `key` is `"id"`, `"title"`, or a field
   * marked `"sortable": true`. Omit to fall back to the built-in id sort.
   */
  defaultSort?: { key: string; direction?: 'asc' | 'desc' }
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

export function sortableFields(schema: TableSchema): FieldDef[] {
  return schema.fields.filter((f) => f.sortable)
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
