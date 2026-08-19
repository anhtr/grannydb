import type { DerivedFilterDef, FieldDef, TableSchema } from './types'
import { fieldByKey, titleFor } from './types'
import { splitList } from './validate'

/**
 * Live search and filter/sort label resolution, shared by every list's search box and every ref
 * picker's live search. Pure — no React — so it runs the same way in a form combobox and a list
 * filter dropdown, and is testable without mounting anything.
 */

export interface RefLookup {
  schema: TableSchema
  rows: Map<string, Record<string, string>>
}

/** Look up another table's schema and rows by name. Returns undefined while still loading. */
export type ResolveRef = (table: string) => RefLookup | undefined

/**
 * Case-insensitive substring/wildcard match: `*` matches any run of characters, `?` matches exactly
 * one. Plain text with no wildcards behaves as "contains", which is what every search box here
 * promises regardless of whether the person typing knows the wildcards exist.
 */
export function matchesSearch(haystack: string, query: string): boolean {
  const q = query.trim()
  if (q === '') return true
  const pattern = q
    .toLowerCase()
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  try {
    return new RegExp(pattern).test(haystack.toLowerCase())
  } catch {
    // An unbalanced bracket or similar makes the regex invalid; fall back to a literal contains
    // rather than let a stray character make search throw instead of just matching less.
    return haystack.toLowerCase().includes(q.toLowerCase())
  }
}

function refLabel(resolve: ResolveRef, table: string, id: string): string {
  const ref = resolve(table)
  if (!ref) return id
  const row = ref.rows.get(id)
  return row ? titleFor(ref.schema, row) : id
}

/**
 * Flatten a row into the text a search box matches against. `ref`/`reflist` fields resolve to the
 * referenced row's title, so searching a square for "granny stripe" finds it by design name rather
 * than the "D03" id actually stored in the cell.
 *
 * `keys` restricts which fields contribute, e.g. a design picker searching only `name` and `source`.
 * Omit it to use every field on `schema` (a ref field's default: search everything it points at).
 */
export function searchText(
  schema: TableSchema,
  row: Record<string, string>,
  resolve: ResolveRef,
  keys?: readonly string[],
): string {
  const fields: FieldDef[] = keys
    ? keys
        .map((k) => schema.fields.find((f) => f.key === k))
        .filter((f): f is FieldDef => f !== undefined)
    : schema.fields

  const parts: string[] = []
  for (const field of fields) {
    const value = row[field.key] ?? ''
    if (value === '') continue
    if (field.type === 'ref' && field.refTable) {
      parts.push(refLabel(resolve, field.refTable, value))
    } else if (field.type === 'reflist' && field.refTable) {
      for (const id of splitList(value, field.separator ?? ';')) {
        parts.push(refLabel(resolve, field.refTable, id))
      }
    } else {
      parts.push(value)
    }
  }
  return parts.join(' ')
}

/**
 * The label to show for a value stored in a `ref` field, e.g. a design's name instead of "D03".
 * Passes anything that is not a `ref` straight through, so it is safe to call on every filter field
 * uniformly rather than branching at each call site.
 */
export function refDisplayLabel(
  field: Pick<FieldDef, 'type' | 'refTable'>,
  value: string,
  resolve: ResolveRef,
): string {
  if (field.type === 'ref' && field.refTable) return refLabel(resolve, field.refTable, value)
  return value
}

/** The field a derived filter reads through, resolved via its `via` ref field's target table. */
export function derivedFilterField(
  schema: TableSchema,
  filter: DerivedFilterDef,
  resolve: ResolveRef,
): FieldDef | undefined {
  const viaField = schema.fields.find((f) => f.key === filter.via)
  if (!viaField?.refTable) return undefined
  return resolve(viaField.refTable)?.schema.fields.find((f) => f.key === filter.throughField)
}

/** A row's value for a derived filter: hop through `via`'s referenced row and read `throughField`. */
export function derivedFilterValue(
  schema: TableSchema,
  filter: DerivedFilterDef,
  row: Record<string, string>,
  resolve: ResolveRef,
): string {
  const viaField = schema.fields.find((f) => f.key === filter.via)
  if (!viaField?.refTable) return ''
  const viaRow = resolve(viaField.refTable)?.rows.get(row[filter.via] ?? '')
  return viaRow?.[filter.throughField] ?? ''
}

/**
 * A field's effective value: its own value, or — when blank and the field declares `inheritFrom` —
 * the value read by hopping through `via` to `throughField` on the row it points at, e.g. a square's
 * blank `construction_type` falling back to its design's. `inherited` is true only when the hop
 * actually found something, so a blank field pointing at a row that is also blank still reads as
 * "not set" rather than falsely claiming to be inherited.
 */
export function effectiveValue(
  schema: TableSchema,
  field: FieldDef,
  row: Record<string, string>,
  resolve: ResolveRef,
): { value: string; inherited: boolean } {
  // Trimmed because a hand-edited cell can carry stray leading/trailing whitespace that
  // `validateValue`'s enum check already tolerates (it trims before comparing to `options`) — without
  // trimming here too, that "valid" cell would still fail every exact-match comparison downstream
  // (stats tallies, filters) against the clean option string, and disappear from them silently.
  const own = (row[field.key] ?? '').trim()
  if (own !== '' || !field.inheritFrom) return { value: own, inherited: false }
  const viaField = fieldByKey(schema, field.inheritFrom.via)
  if (!viaField?.refTable) return { value: '', inherited: false }
  const viaRow = resolve(viaField.refTable)?.rows.get(row[viaField.key] ?? '')
  const value = (viaRow?.[field.inheritFrom.throughField] ?? '').trim()
  return { value, inherited: value !== '' }
}
