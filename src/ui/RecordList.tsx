import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { CsvRow, CsvTable } from '../core/csv'
import { compareIds } from '../core/csv'
import {
  derivedFilterField,
  derivedFilterValue,
  effectiveValue,
  fieldByKey,
  filterFields,
  matchesSearch,
  refDisplayLabel,
  searchText,
  sortableFields,
  titleFor,
} from '../core/schema'
import type { FieldDef, ResolveRef, TableSchema } from '../core/schema'
import type { ListPrefs } from '../core/prefs'
import { appStore, pendingRowIds } from '../core/store'
import { useAppState, useResolveRef, useTable, useTableSchema } from '../app/hooks'
import { Badge, Card, EmptyState, inputClass, Link, Spinner } from './components'

interface FilterOption {
  value: string
  label: string
}

interface FilterDescriptor {
  key: string
  label: string
  options: FilterOption[]
  matches: (row: CsvRow, value: string) => boolean
}

/**
 * `"min"` thresholds for a numeric field: "N or more", built from whatever counts are actually
 * present in the data rather than a fixed range, so the dropdown never offers a threshold nothing
 * could match. Starts at 1 — "0 or more" is already what the dropdown's own blank "any" option means,
 * so a `0` entry would just be a second, confusingly-worded way to clear the filter.
 */
function minThresholdOptions(field: FieldDef, data: CsvTable): FilterOption[] {
  const max = data.rows.reduce((m, r) => Math.max(m, Math.floor(Number(r[field.key]) || 0)), 0)
  const options: FilterOption[] = []
  for (let n = 1; n <= max; n++) {
    options.push({ value: String(n), label: `${n}+` })
  }
  return options
}

/** Build the filter dropdowns: fields marked `"filter": true`, plus the schema's `derivedFilters`. */
function useFilterDescriptors(schema: TableSchema | null, data: CsvTable | null) {
  const resolve = useResolveRef()
  return useMemo<FilterDescriptor[]>(() => {
    if (!schema || !data) return []

    const direct = filterFields(schema).map((field): FilterDescriptor => {
      // A field with `inheritFrom` (e.g. a square's blank `construction_type`) filters on what it
      // *resolves to*, not the raw stored cell — otherwise every square that inherits rather than
      // overrides would be invisible to the filter. See ADR 0016.
      const fieldValue = (row: CsvRow): string =>
        field.inheritFrom ? effectiveValue(schema, field, row, resolve).value : row[field.key] ?? ''

      if (field.filterMode === 'min') {
        return {
          key: field.key,
          label: field.label,
          options: minThresholdOptions(field, data),
          matches: (row, value) => (Number(row[field.key]) || 0) >= Number(value),
        }
      }
      const values = [...new Set(data.rows.map((r) => fieldValue(r)).filter((v) => v !== ''))]
      const options =
        field.type === 'enum' && field.options
          ? field.options.map((o) => ({ value: o, label: o }))
          : values
              .map((v) => ({ value: v, label: refDisplayLabel(field, v, resolve) }))
              .sort((a, b) => a.label.localeCompare(b.label))
      return { key: field.key, label: field.label, options, matches: (row, value) => fieldValue(row) === value }
    })

    const derived = (schema.derivedFilters ?? []).map((filter): FilterDescriptor => {
      const getValue = (row: CsvRow) => derivedFilterValue(schema, filter, row, resolve)
      const throughField = derivedFilterField(schema, filter, resolve)
      const values = [...new Set(data.rows.map(getValue).filter((v) => v !== ''))]
      const options = values
        .map((v) => ({ value: v, label: throughField ? refDisplayLabel(throughField, v, resolve) : v }))
        .sort((a, b) => a.label.localeCompare(b.label))
      return { key: filter.key, label: filter.label, options, matches: (row, value) => getValue(row) === value }
    })

    return [...direct, ...derived]
  }, [schema, data, resolve])
}

type SortKey = string
type SortDir = 'asc' | 'desc'

export interface SortSpec {
  key: SortKey
  field: FieldDef | undefined
  dir: SortDir
}

/** A sortable field's own value on `row` — the *effective* one when it has `inheritFrom`, same as
 * filtering already does (see `useFilterDescriptors`), so sorting a square by Construction groups
 * squares that inherit it from their design correctly instead of stranding them at whichever end of
 * the order an empty string happens to land on. */
function sortValue(schema: TableSchema, field: FieldDef, row: CsvRow, resolve: ResolveRef): string {
  return field.inheritFrom ? effectiveValue(schema, field, row, resolve).value : (row[field.key] ?? '')
}

function compareValues(a: CsvRow, b: CsvRow, schema: TableSchema, spec: SortSpec, resolve: ResolveRef): number {
  if (spec.key === 'title') return titleFor(schema, a).localeCompare(titleFor(schema, b))
  if (spec.field) {
    if (spec.field.type === 'number') {
      return (Number(a[spec.field.key]) || 0) - (Number(b[spec.field.key]) || 0)
    }
    const va = sortValue(schema, spec.field, a, resolve)
    const vb = sortValue(schema, spec.field, b, resolve)
    return refDisplayLabel(spec.field, va, resolve).localeCompare(refDisplayLabel(spec.field, vb, resolve))
  }
  return compareIds(a[schema.idField] ?? '', b[schema.idField] ?? '')
}

/**
 * Sorted by `primary`, ties broken by `secondary` when the schema's `defaultSort.thenBy` applies (see
 * `secondarySort` below), then by title alphabetically (always ascending, regardless of either
 * direction) and then by id, so the order is fully determined instead of falling back to whatever
 * order the rows happened to already be in.
 */
export function sortRows(
  rows: CsvRow[],
  schema: TableSchema,
  primary: SortSpec,
  resolve: ResolveRef,
  secondary?: SortSpec,
): CsvRow[] {
  const sign = primary.dir === 'desc' ? -1 : 1
  const secondSign = secondary && secondary.dir === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => {
    const byPrimary = compareValues(a, b, schema, primary, resolve)
    if (byPrimary !== 0) return sign * byPrimary
    if (secondary) {
      const bySecondary = compareValues(a, b, schema, secondary, resolve)
      if (bySecondary !== 0) return secondSign * bySecondary
    }
    const byTitle = titleFor(schema, a).localeCompare(titleFor(schema, b))
    if (byTitle !== 0) return byTitle
    return compareIds(a[schema.idField] ?? '', b[schema.idField] ?? '')
  })
}

export interface RecordListProps {
  table: string
  /** Render one row. Defaults to a generic title/subtitle card. */
  renderRow?: (row: CsvRow, schema: TableSchema) => ReactNode
  /** Extra content above the list, e.g. progress stats. */
  header?: ReactNode
}

/** This table's remembered list state, or the schema's own default when nothing was saved yet. */
function initialListPrefs(schema: TableSchema | null, saved: ListPrefs | undefined): ListPrefs {
  return {
    filters: saved?.filters ?? {},
    sortKey: saved?.sortKey ?? schema?.defaultSort?.key ?? 'id',
    sortDir: saved?.sortDir ?? schema?.defaultSort?.direction ?? 'asc',
  }
}

export function RecordList({ table, renderRow, header }: RecordListProps) {
  const state = useAppState()
  const schema = useTableSchema(table)
  const data = useTable(table)
  const resolve = useResolveRef()
  const [query, setQuery] = useState('')
  const [listPrefs, setListPrefsState] = useState<ListPrefs>(() =>
    initialListPrefs(schema, state.prefs.lists[table]),
  )
  const { filters, sortKey, sortDir } = listPrefs

  // Saved locally (see `core/prefs`), keyed by table, so leaving and reopening a list keeps how it
  // was last narrowed and sorted — but device-local only, never part of the synced data.
  const setListPrefs = (next: Partial<ListPrefs>) => {
    const merged = { ...listPrefs, ...next }
    setListPrefsState(merged)
    appStore.setPrefs({ ...state.prefs, lists: { ...state.prefs.lists, [table]: merged } })
  }

  const pending = useMemo(() => pendingRowIds(state.changes, table), [state.changes, table])
  const filterDescriptors = useFilterDescriptors(schema, data)
  const sortOptions = schema ? sortableFields(schema) : []
  const sortField = schema ? sortOptions.find((f) => f.key === sortKey) : undefined

  // `thenBy` only kicks in while the list is showing exactly the schema's own default combination —
  // once the person picks a different primary sort from the dropdown, ties break by title/id like any
  // other sort, rather than by a secondary field they never asked for.
  const secondarySort: SortSpec | undefined =
    schema?.defaultSort?.thenBy && sortKey === (schema.defaultSort.key ?? 'id')
      ? {
          key: schema.defaultSort.thenBy,
          field: sortOptions.find((f) => f.key === schema.defaultSort!.thenBy),
          dir: schema.defaultSort.thenDirection ?? 'asc',
        }
      : undefined

  const rows = useMemo(() => {
    if (!schema || !data) return []
    const filtered = data.rows.filter((row) => {
      if (!matchesSearch(searchText(schema, row, resolve, schema.searchFields), query)) return false
      return filterDescriptors.every((d) => {
        const value = filters[d.key]
        return !value || d.matches(row, value)
      })
    })
    return sortRows(filtered, schema, { key: sortKey, field: sortField, dir: sortDir }, resolve, secondarySort)
  }, [schema, data, query, filters, filterDescriptors, sortKey, sortField, sortDir, resolve, secondarySort])

  if (!schema || !data) return <Spinner />

  const activeFilters = Object.values(filters).filter((v) => v !== '').length
  const sortActive = sortKey !== (schema.defaultSort?.key ?? 'id') || sortDir !== (schema.defaultSort?.direction ?? 'asc')

  return (
    <div className="pb-24">
      {header}

      <div className="sticky top-0 z-10 space-y-2 border-b border-line bg-paper/95 px-4 py-3 backdrop-blur">
        <input
          type="search"
          inputMode="search"
          enterKeyHint="search"
          className={inputClass}
          placeholder={`Search ${schema.label.toLowerCase()}`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {filterDescriptors.length > 0 || sortOptions.length > 0 ? (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {sortOptions.length > 0 ? (
              <>
                <select
                  aria-label="Sort by"
                  className={`tap-target shrink-0 rounded-xl border px-3 text-sm ${
                    sortActive ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-card'
                  }`}
                  value={sortKey}
                  onChange={(e) => setListPrefs({ sortKey: e.target.value })}
                >
                  <option value="id">Sort: ID</option>
                  <option value="title">Sort: Name</option>
                  {sortOptions.map((field) => (
                    <option key={field.key} value={field.key}>
                      Sort: {field.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label={sortDir === 'asc' ? 'Sort ascending' : 'Sort descending'}
                  title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
                  className={`tap-target shrink-0 rounded-xl border px-3 text-sm ${
                    sortActive ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-card'
                  }`}
                  onClick={() => setListPrefs({ sortDir: sortDir === 'asc' ? 'desc' : 'asc' })}
                >
                  {sortDir === 'asc' ? '↑' : '↓'}
                </button>
              </>
            ) : null}
            {filterDescriptors.map((d) => (
              <select
                key={d.key}
                aria-label={`Filter by ${d.label}`}
                className={`tap-target shrink-0 rounded-xl border px-3 text-sm ${
                  filters[d.key] ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-card'
                }`}
                value={filters[d.key] ?? ''}
                onChange={(e) => setListPrefs({ filters: { ...filters, [d.key]: e.target.value } })}
              >
                <option value="">{d.label}: any</option>
                {d.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ))}
          </div>
        ) : null}
      </div>

      <p className="px-4 py-2 text-xs text-muted">
        {rows.length} of {data.rows.length}
        {activeFilters > 0 || query !== '' ? ' (filtered)' : ''}
      </p>

      {rows.length === 0 ? (
        <EmptyState
          title={`No ${schema.label.toLowerCase()} match`}
          hint="Try clearing the search or filters."
        />
      ) : (
        <ul className="space-y-2 px-4">
          {rows.map((row) => {
            const id = row[schema.idField] ?? ''
            return (
              <li key={id}>
                <Link to={`/${table}/${id}`} className="block">
                  <Card className="p-3 transition hover:border-accent">
                    {renderRow ? (
                      renderRow(row, schema)
                    ) : (
                      <DefaultRow row={row} schema={schema} resolve={resolve} />
                    )}
                    {pending.has(id) ? (
                      <div className="mt-2">
                        <Badge tone="warn">Unsynced</Badge>
                      </div>
                    ) : null}
                  </Card>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function DefaultRow({
  row,
  schema,
  resolve,
}: {
  row: CsvRow
  schema: TableSchema
  resolve: ResolveRef
}) {
  const title = titleFor(schema, row) || '(untitled)'
  const subtitleField = schema.subtitleField ? fieldByKey(schema, schema.subtitleField) : undefined
  const subtitle = subtitleField
    ? refDisplayLabel(subtitleField, row[subtitleField.key] ?? '', resolve)
    : ''
  const swatch = schema.swatchField ? row[schema.swatchField] : undefined

  return (
    <div className="flex items-center gap-3">
      {schema.swatchField ? (
        <span
          className="size-9 shrink-0 rounded-full border border-black/10"
          style={{ background: swatch || 'transparent' }}
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{title}</p>
        {subtitle ? <p className="truncate text-sm text-muted">{subtitle}</p> : null}
      </div>
      <span className="shrink-0 font-mono text-xs text-muted">{row[schema.idField]}</span>
    </div>
  )
}
