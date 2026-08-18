import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { CsvRow } from '../core/csv'
import { sortedRows } from '../core/csv'
import { filterFields, titleFor } from '../core/schema'
import type { TableSchema } from '../core/schema'
import { pendingRowIds } from '../core/store'
import { useAppState, useTable, useTableSchema } from '../app/hooks'
import { Badge, Card, EmptyState, inputClass, Link, Spinner } from './components'

/**
 * Search across every cell in the row.
 *
 * 400 rows is small enough that a linear scan per keystroke is imperceptible, and the honest
 * simple thing beats an index we would have to keep in step with the queue.
 */
function matchesQuery(row: CsvRow, query: string): boolean {
  if (query === '') return true
  const needle = query.toLowerCase()
  return Object.values(row).some((v) => v.toLowerCase().includes(needle))
}

/** Distinct non-empty values for a column, for the filter dropdowns. */
function distinctValues(rows: readonly CsvRow[], key: string): string[] {
  return [...new Set(rows.map((r) => r[key] ?? '').filter((v) => v !== ''))].sort((a, b) =>
    a.localeCompare(b),
  )
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
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})

  const pending = useMemo(() => pendingRowIds(state.changes, table), [state.changes, table])

  const rows = useMemo(() => {
    if (!schema || !data) return []
    return sortedRows(data, schema.idField).filter((row) => {
      if (!matchesQuery(row, query)) return false
      return Object.entries(filters).every(([key, value]) => value === '' || row[key] === value)
    })
  }, [schema, data, query, filters])

  if (!schema || !data) return <Spinner />

  const filterable = filterFields(schema)
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
        {filterable.length > 0 ? (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {filterable.map((field) => {
              const options =
                field.type === 'enum' && field.options
                  ? field.options
                  : distinctValues(data.rows, field.key)
              return (
                <select
                  key={field.key}
                  aria-label={`Filter by ${field.label}`}
                  className={`tap-target shrink-0 rounded-xl border px-3 text-sm ${
                    filters[field.key] ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-card'
                  }`}
                  value={filters[field.key] ?? ''}
                  onChange={(e) => setFilters({ ...filters, [field.key]: e.target.value })}
                >
                  <option value="">{field.label}: any</option>
                  {options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              )
            })}
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
                      <DefaultRow row={row} schema={schema} />
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

function DefaultRow({ row, schema }: { row: CsvRow; schema: TableSchema }) {
  const title = titleFor(schema, row) || '(untitled)'
  const subtitle = schema.subtitleField ? row[schema.subtitleField] : ''
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
