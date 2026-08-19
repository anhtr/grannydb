import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { CsvRow, CsvTable } from '../core/csv'
import { compareIds } from '../core/csv'
import {
  derivedFilterField,
  derivedFilterValue,
  fieldByKey,
  filterFields,
  matchesSearch,
  refDisplayLabel,
  searchText,
  sortableFields,
  titleFor,
} from '../core/schema'
import type { FieldDef, ResolveRef, TableSchema } from '../core/schema'
import { pendingRowIds } from '../core/store'
import { useAppState, useResolveRef, useTable, useTableSchema } from '../app/hooks'
import { Badge, Card, EmptyState, inputClass, Link, Spinner } from './components'

interface FilterOption {
  value: string
  label: string
}

interface FilterDescriptor {
  key: string
  label: string
  getValue: (row: CsvRow) => string
  options: FilterOption[]
}

/** Build the filter dropdowns: fields marked `"filter": true`, plus the schema's `derivedFilters`. */
function useFilterDescriptors(schema: TableSchema | null, data: CsvTable | null) {
  const resolve = useResolveRef()
  return useMemo<FilterDescriptor[]>(() => {
    if (!schema || !data) return []

    const direct = filterFields(schema).map((field): FilterDescriptor => {
      const values = [...new Set(data.rows.map((r) => r[field.key] ?? '').filter((v) => v !== ''))]
      const options =
        field.type === 'enum' && field.options
          ? field.options.map((o) => ({ value: o, label: o }))
          : values
              .map((v) => ({ value: v, label: refDisplayLabel(field, v, resolve) }))
              .sort((a, b) => a.label.localeCompare(b.label))
      return { key: field.key, label: field.label, getValue: (row) => row[field.key] ?? '', options }
    })

    const derived = (schema.derivedFilters ?? []).map((filter): FilterDescriptor => {
      const getValue = (row: CsvRow) => derivedFilterValue(schema, filter, row, resolve)
      const throughField = derivedFilterField(schema, filter, resolve)
      const values = [...new Set(data.rows.map(getValue).filter((v) => v !== ''))]
      const options = values
        .map((v) => ({ value: v, label: throughField ? refDisplayLabel(throughField, v, resolve) : v }))
        .sort((a, b) => a.label.localeCompare(b.label))
      return { key: filter.key, label: filter.label, getValue, options }
    })

    return [...direct, ...derived]
  }, [schema, data, resolve])
}

type SortKey = string

function sortRows(
  rows: CsvRow[],
  schema: TableSchema,
  sortKey: SortKey,
  sortField: FieldDef | undefined,
  resolve: ResolveRef,
): CsvRow[] {
  if (sortKey === 'name') {
    return [...rows].sort((a, b) => titleFor(schema, a).localeCompare(titleFor(schema, b)))
  }
  if (sortField) {
    return [...rows].sort((a, b) =>
      refDisplayLabel(sortField, a[sortField.key] ?? '', resolve).localeCompare(
        refDisplayLabel(sortField, b[sortField.key] ?? '', resolve),
      ),
    )
  }
  return [...rows].sort((a, b) => compareIds(a[schema.idField] ?? '', b[schema.idField] ?? ''))
}

export interface RecordListProps {
  table: string
  /** Render one row. Defaults to a generic title/subtitle card. */
  renderRow?: (row: CsvRow, schema: TableSchema) => ReactNode
  /** Extra content above the list, e.g. progress stats. */
  header?: ReactNode
}

export function RecordList({ table, renderRow, header }: RecordListProps) {
  const state = useAppState()
  const schema = useTableSchema(table)
  const data = useTable(table)
  const resolve = useResolveRef()
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [sortKey, setSortKey] = useState<SortKey>('id')

  const pending = useMemo(() => pendingRowIds(state.changes, table), [state.changes, table])
  const filterDescriptors = useFilterDescriptors(schema, data)
  const sortOptions = schema ? sortableFields(schema) : []
  const sortField = schema ? sortOptions.find((f) => f.key === sortKey) : undefined

  const rows = useMemo(() => {
    if (!schema || !data) return []
    const filtered = data.rows.filter((row) => {
      if (!matchesSearch(searchText(schema, row, resolve, schema.searchFields), query)) return false
      return filterDescriptors.every((d) => {
        const value = filters[d.key]
        return !value || d.getValue(row) === value
      })
    })
    return sortRows(filtered, schema, sortKey, sortField, resolve)
  }, [schema, data, query, filters, filterDescriptors, sortKey, sortField, resolve])

  if (!schema || !data) return <Spinner />

  const activeFilters = Object.values(filters).filter((v) => v !== '').length

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
              <select
                aria-label="Sort by"
                className={`tap-target shrink-0 rounded-xl border px-3 text-sm ${
                  sortKey !== 'id' ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-card'
                }`}
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value)}
              >
                <option value="id">Sort: ID</option>
                <option value="name">Sort: Name</option>
                {sortOptions.map((field) => (
                  <option key={field.key} value={field.key}>
                    Sort: {field.label}
                  </option>
                ))}
              </select>
            ) : null}
            {filterDescriptors.map((d) => (
              <select
                key={d.key}
                aria-label={`Filter by ${d.label}`}
                className={`tap-target shrink-0 rounded-xl border px-3 text-sm ${
                  filters[d.key] ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-card'
                }`}
                value={filters[d.key] ?? ''}
                onChange={(e) => setFilters({ ...filters, [d.key]: e.target.value })}
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
