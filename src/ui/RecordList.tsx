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
import type { ListPrefs, SortRule } from '../core/prefs'
import { appStore, pendingRowIds } from '../core/store'
import { useAppState, useCanEdit, useResolveRef, useTable, useTableSchema } from '../app/hooks'
import { Badge, BadgeStack, Button, Card, EmptyState, inputClass, Link, Spinner } from './components'

interface FilterOption {
  value: string
  label: string
}

export interface FilterDescriptor {
  key: string
  label: string
  options: FilterOption[]
  matches: (row: CsvRow, value: string) => boolean
  /** Whether more than one option can be selected at once (checkboxes, OR'd together) rather than
   * just one (radio buttons). Defaults to `true` when omitted. A "min" threshold filter (e.g. "skeins
   * left") sets this `false` — "3+ or 5+ at once" isn't a meaningful combination the way "product line
   * A or B" is, since each threshold already includes every value the one above it would match. */
  multi?: boolean
}

/**
 * A sort option for a value that lives outside the schema — a cross-table count like "squares using
 * this yarn as main", say — computed from data the page already has loaded rather than read off a
 * field. Numeric only: every current use is a count, and a computed *label* sort would need its own
 * comparison shape, not built until something actually needs it.
 */
export interface ComputedSortOption {
  key: string
  label: string
  value: (row: CsvRow) => number
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
          multi: false,
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
              .sort((a, b) => compareIds(a.label, b.label))
      return { key: field.key, label: field.label, options, matches: (row, value) => fieldValue(row) === value }
    })

    const derived = (schema.derivedFilters ?? []).map((filter): FilterDescriptor => {
      const getValue = (row: CsvRow) => derivedFilterValue(schema, filter, row, resolve)
      const throughField = derivedFilterField(schema, filter, resolve)
      const values = [...new Set(data.rows.map(getValue).filter((v) => v !== ''))]
      const options = values
        .map((v) => ({ value: v, label: throughField ? refDisplayLabel(throughField, v, resolve) : v }))
        .sort((a, b) => compareIds(a.label, b.label))
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
  /** Set instead of `field` for a sort computed outside the schema — see `ComputedSortOption`. */
  computed?: ComputedSortOption
}

export interface SortOption {
  key: SortKey
  label: string
}

/** A sortable field's own value on `row` — the *effective* one when it has `inheritFrom`, same as
 * filtering already does (see `useFilterDescriptors`), so sorting a square by Construction groups
 * squares that inherit it from their design correctly instead of stranding them at whichever end of
 * the order an empty string happens to land on. */
function sortValue(schema: TableSchema, field: FieldDef, row: CsvRow, resolve: ResolveRef): string {
  return field.inheritFrom ? effectiveValue(schema, field, row, resolve).value : (row[field.key] ?? '')
}

function compareValues(a: CsvRow, b: CsvRow, schema: TableSchema, spec: SortSpec, resolve: ResolveRef): number {
  if (spec.key === 'title') return compareIds(titleFor(schema, a), titleFor(schema, b))
  if (spec.computed) return spec.computed.value(a) - spec.computed.value(b)
  if (spec.field) {
    if (spec.field.type === 'number') {
      return (Number(a[spec.field.key]) || 0) - (Number(b[spec.field.key]) || 0)
    }
    const va = sortValue(schema, spec.field, a, resolve)
    const vb = sortValue(schema, spec.field, b, resolve)
    // Natural compare (not plain localeCompare) so a ref label like a yarn's "77 (Sunflower)" sorts by
    // the leading number instead of digit-by-digit, which would put "129 (…)" before "77 (…)".
    return compareIds(refDisplayLabel(spec.field, va, resolve), refDisplayLabel(spec.field, vb, resolve))
  }
  return compareIds(a[schema.idField] ?? '', b[schema.idField] ?? '')
}

/**
 * Sorted by `specs` in order — each one only breaks ties left by the ones before it — then by title
 * alphabetically (always ascending, regardless of any spec's direction) and then by id, so the order
 * is fully determined instead of falling back to whatever order the rows happened to already be in.
 * `specs` is normally what the person built in the sort panel (see `SortPanel`), seeded from the
 * schema's own `defaultSort`/`defaultSort.thenBy` the first time a list is opened.
 */
export function sortRows(rows: CsvRow[], schema: TableSchema, specs: SortSpec[], resolve: ResolveRef): CsvRow[] {
  return [...rows].sort((a, b) => {
    for (const spec of specs) {
      const cmp = compareValues(a, b, schema, spec, resolve)
      if (cmp !== 0) return spec.dir === 'desc' ? -cmp : cmp
    }
    const byTitle = compareIds(titleFor(schema, a), titleFor(schema, b))
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
  /** Sort options for values computed outside the schema, e.g. a cross-table count. */
  extraSortOptions?: ComputedSortOption[]
  /** Filter dropdowns for values computed outside the schema, e.g. a derived flag. */
  extraFilters?: FilterDescriptor[]
}

/** The sort rules a table's list starts with, before anyone has picked their own: the schema's
 * `defaultSort`, and its `thenBy` as a second-priority rule when it has one, else a bare id sort. */
function defaultSorts(schema: TableSchema | null): SortRule[] {
  if (!schema?.defaultSort) return [{ key: 'id', dir: 'asc' }]
  const sorts: SortRule[] = [{ key: schema.defaultSort.key ?? 'id', dir: schema.defaultSort.direction ?? 'asc' }]
  if (schema.defaultSort.thenBy) {
    sorts.push({ key: schema.defaultSort.thenBy, dir: schema.defaultSort.thenDirection ?? 'asc' })
  }
  return sorts
}

function sortsEqual(a: SortRule[], b: SortRule[]): boolean {
  return a.length === b.length && a.every((rule, i) => rule.key === b[i].key && rule.dir === b[i].dir)
}

/** Reads a filter's value saved under the old single-string shape, from before multi-select, as a
 * one-item array, so an existing device doesn't silently lose its saved filter the first time this
 * ships. */
function normalizeFilters(saved: Record<string, string | string[]> | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [key, value] of Object.entries(saved ?? {})) {
    const list = Array.isArray(value) ? value : value ? [value] : []
    if (list.length > 0) out[key] = list
  }
  return out
}

/** This table's remembered list state, or the schema's own default when nothing was saved yet.
 * Also reads a list saved under the old single-key `sortKey`/`sortDir` shape, from before multi-sort,
 * so an existing device doesn't silently lose its saved sort the first time this ships. */
function initialListPrefs(schema: TableSchema | null, saved: ListPrefs | undefined): ListPrefs {
  const legacy = saved as (ListPrefs & { sortKey?: string; sortDir?: SortDir }) | undefined
  if (saved?.sorts?.length) return { filters: normalizeFilters(saved.filters), sorts: saved.sorts }
  if (legacy?.sortKey) {
    return { filters: normalizeFilters(legacy.filters), sorts: [{ key: legacy.sortKey, dir: legacy.sortDir ?? 'asc' }] }
  }
  return { filters: normalizeFilters(saved?.filters), sorts: defaultSorts(schema) }
}

export function RecordList({ table, renderRow, header, extraSortOptions, extraFilters }: RecordListProps) {
  const state = useAppState()
  const schema = useTableSchema(table)
  const data = useTable(table)
  const resolve = useResolveRef()
  const canEdit = useCanEdit()
  const [query, setQuery] = useState('')
  const [sortPanelOpen, setSortPanelOpen] = useState(false)
  const [filterPanelOpen, setFilterPanelOpen] = useState(false)
  const [listPrefs, setListPrefsState] = useState<ListPrefs>(() =>
    initialListPrefs(schema, state.prefs.lists[table]),
  )
  const { filters, sorts } = listPrefs

  // Saved locally (see `core/prefs`), keyed by table, so leaving and reopening a list keeps how it
  // was last narrowed and sorted — but device-local only, never part of the synced data.
  const setListPrefs = (next: Partial<ListPrefs>) => {
    const merged = { ...listPrefs, ...next }
    setListPrefsState(merged)
    appStore.setPrefs({ ...state.prefs, lists: { ...state.prefs.lists, [table]: merged } })
  }

  const pending = useMemo(() => pendingRowIds(state.changes, table), [state.changes, table])
  const schemaFilterDescriptors = useFilterDescriptors(schema, data)
  const filterDescriptors = [...schemaFilterDescriptors, ...(extraFilters ?? [])]
  const sortOptions = schema ? sortableFields(schema) : []
  const computedSortOptions = extraSortOptions ?? []
  // Every key the sort panel can offer, id/title first, in the order fields appear in the schema.
  const allSortOptions: SortOption[] = [
    { key: 'id', label: 'ID' },
    { key: 'title', label: 'Name' },
    ...sortOptions.map((f) => ({ key: f.key, label: f.label })),
    ...computedSortOptions.map((c) => ({ key: c.key, label: c.label })),
  ]
  const specFor = (rule: SortRule): SortSpec => ({
    key: rule.key,
    dir: rule.dir,
    field: sortOptions.find((f) => f.key === rule.key),
    computed: computedSortOptions.find((c) => c.key === rule.key),
  })

  const rows = useMemo(() => {
    if (!schema || !data) return []
    const filtered = data.rows.filter((row) => {
      if (!matchesSearch(searchText(schema, row, resolve, schema.searchFields), query)) return false
      return filterDescriptors.every((d) => {
        const values = filters[d.key]
        return !values || values.length === 0 || values.some((value) => d.matches(row, value))
      })
    })
    return sortRows(filtered, schema, sorts.map(specFor), resolve)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, data, query, filters, filterDescriptors, sorts, sortOptions, computedSortOptions, resolve])

  if (!schema || !data) return <Spinner />

  const activeFilters = Object.values(filters).filter((v) => v.length > 0).length
  const sortActive = !sortsEqual(sorts, defaultSorts(schema))
  const sortLabel = (key: string) => allSortOptions.find((o) => o.key === key)?.label ?? key
  const sortButtonText =
    sorts.length === 0
      ? 'Sort'
      : sorts.length === 1
        ? `Sort: ${sortLabel(sorts[0].key)} ${sorts[0].dir === 'asc' ? '↑' : '↓'}`
        : `Sort: ${sortLabel(sorts[0].key)} +${sorts.length - 1}`

  return (
    <div className="pb-32">
      {header}

      <div className="sticky top-0 z-10 border-b border-line bg-paper/95 px-4 py-2.5 backdrop-blur">
        <div className="relative flex gap-1.5">
          <input
            type="search"
            inputMode="search"
            enterKeyHint="search"
            className={`${inputClass} min-w-0 flex-1`}
            placeholder={`Search ${schema.label.toLowerCase()}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {allSortOptions.length > 0 ? (
            <button
              type="button"
              aria-label="Sort"
              aria-expanded={sortPanelOpen}
              className={`tap-target shrink-0 whitespace-nowrap rounded-xl border px-3 text-sm ${
                sortActive ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-card'
              }`}
              onClick={() => {
                setFilterPanelOpen(false)
                setSortPanelOpen((v) => !v)
              }}
            >
              {sortButtonText}
            </button>
          ) : null}
          {filterDescriptors.length > 0 ? (
            <button
              type="button"
              aria-label="Filter"
              aria-expanded={filterPanelOpen}
              className={`tap-target shrink-0 whitespace-nowrap rounded-xl border px-3 text-sm ${
                activeFilters > 0 ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-card'
              }`}
              onClick={() => {
                setSortPanelOpen(false)
                setFilterPanelOpen((v) => !v)
              }}
            >
              Filter{activeFilters > 0 ? ` (${activeFilters})` : ''}
            </button>
          ) : null}
          {sortPanelOpen ? (
            <SortPanel
              options={allSortOptions}
              sorts={sorts}
              defaultSorts={defaultSorts(schema)}
              onChange={(next) => setListPrefs({ sorts: next })}
              onClose={() => setSortPanelOpen(false)}
            />
          ) : null}
          {filterPanelOpen ? (
            <FilterPanel
              descriptors={filterDescriptors}
              filters={filters}
              onChange={(next) => setListPrefs({ filters: next })}
              onClose={() => setFilterPanelOpen(false)}
            />
          ) : null}
        </div>
      </div>

      <p className="px-4 py-1.5 text-xs text-muted">
        {rows.length} of {data.rows.length}
        {activeFilters > 0 || query !== '' ? ' (filtered)' : ''}
      </p>

      {rows.length === 0 ? (
        <EmptyState
          title={`No ${schema.label.toLowerCase()} match`}
          hint="Try clearing the search or filters."
        />
      ) : (
        <ul className="space-y-1.5 px-4">
          {rows.map((row) => {
            const id = row[schema.idField] ?? ''
            return (
              <li key={id}>
                <Link to={`/${table}/${id}`} className="block">
                  <Card className="p-2.5 transition hover:border-accent">
                    {renderRow ? (
                      renderRow(row, schema)
                    ) : (
                      <DefaultRow row={row} schema={schema} resolve={resolve} />
                    )}
                    {pending.has(id) ? (
                      <div className="mt-1.5">
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

      {canEdit ? <NewRecordButton table={table} schema={schema} /> : null}
    </div>
  )
}

/**
 * Sort as a priority-ordered list of rules rather than one field: each rule only breaks ties left by
 * the ones above it (see `sortRows`), so someone can, say, sort squares by design and then by
 * construction within a design — a single-key sort can't express that. Reordering is by up/down
 * buttons rather than drag-and-drop, which is simpler to make work with touch and a screen reader
 * alike than a custom drag implementation would be.
 */
function SortPanel({
  options,
  sorts,
  defaultSorts,
  onChange,
  onClose,
}: {
  options: SortOption[]
  sorts: SortRule[]
  defaultSorts: SortRule[]
  onChange: (sorts: SortRule[]) => void
  onClose: () => void
}) {
  const activeKeys = new Set(sorts.map((s) => s.key))
  const available = options.filter((o) => !activeKeys.has(o.key))

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= sorts.length) return
    const next = [...sorts]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }
  const toggleDir = (index: number) => {
    onChange(sorts.map((s, i) => (i === index ? { ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' } : s)))
  }
  const remove = (index: number) => {
    const next = sorts.filter((_, i) => i !== index)
    onChange(next.length > 0 ? next : [{ key: 'id', dir: 'asc' }])
  }
  const add = (key: string) => {
    if (key) onChange([...sorts, { key, dir: 'asc' }])
  }

  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} aria-hidden />
      <div className="absolute inset-x-0 top-full z-20 mt-2 rounded-xl border border-line bg-card p-3 shadow-lg">
        <p className="mb-2 text-xs font-medium text-muted">Sort by, in priority order</p>
        <ol className="space-y-1.5">
          {sorts.map((sort, i) => (
            <li key={sort.key} className="flex items-center gap-1.5">
              <span className="w-4 shrink-0 text-center text-xs text-muted">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {options.find((o) => o.key === sort.key)?.label ?? sort.key}
              </span>
              <button
                type="button"
                aria-label={sort.dir === 'asc' ? 'Ascending' : 'Descending'}
                className="tap-target rounded-lg border border-line px-2 text-xs"
                onClick={() => toggleDir(i)}
              >
                {sort.dir === 'asc' ? '↑' : '↓'}
              </button>
              <button
                type="button"
                aria-label="Move up in priority"
                disabled={i === 0}
                className="tap-target rounded-lg border border-line px-2 text-xs disabled:opacity-30"
                onClick={() => move(i, -1)}
              >
                ▲
              </button>
              <button
                type="button"
                aria-label="Move down in priority"
                disabled={i === sorts.length - 1}
                className="tap-target rounded-lg border border-line px-2 text-xs disabled:opacity-30"
                onClick={() => move(i, 1)}
              >
                ▼
              </button>
              <button
                type="button"
                aria-label={`Remove ${options.find((o) => o.key === sort.key)?.label ?? sort.key} from sort`}
                className="tap-target rounded-lg border border-line px-2 text-xs text-muted"
                onClick={() => remove(i)}
              >
                ×
              </button>
            </li>
          ))}
        </ol>
        {available.length > 0 ? (
          <select
            aria-label="Add sort field"
            className={`${inputClass} mt-2`}
            value=""
            onChange={(e) => add(e.target.value)}
          >
            <option value="">+ Add sort field…</option>
            {available.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        ) : null}
        <div className="mt-2 flex items-center justify-between">
          <button type="button" className="text-xs text-accent" onClick={() => onChange(defaultSorts)}>
            Reset to default
          </button>
          <button type="button" className="tap-target text-xs text-muted" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </>
  )
}

/**
 * All the list's filter dropdowns in one floating panel, opened from a single "Filter" button rather
 * than laid out inline — a side-bar-of-filters-on-demand instead of a row that grows with every
 * filterable field the schema defines and eats space even when nothing is filtered.
 */
/** One filter's options as a row of toggleable pills — checkboxes (any number at once, OR'd
 * together) for a plain categorical field, radios (one at a time, "Any" clears it) for a "min"
 * threshold field where combining values would not mean anything. */
function FilterOptionPills({
  descriptor,
  selected,
  onChange,
}: {
  descriptor: FilterDescriptor
  selected: string[]
  onChange: (values: string[]) => void
}) {
  const multi = descriptor.multi !== false
  const pillClass = (active: boolean) =>
    `tap-target rounded-lg border px-2.5 text-xs ${active ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-card'}`

  if (multi) {
    return (
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Filter by ${descriptor.label}`}>
        {descriptor.options.map((option) => {
          const active = selected.includes(option.value)
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              className={pillClass(active)}
              onClick={() =>
                onChange(active ? selected.filter((v) => v !== option.value) : [...selected, option.value])
              }
            >
              {option.label}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`Filter by ${descriptor.label}`}>
      <button
        type="button"
        aria-pressed={selected.length === 0}
        className={pillClass(selected.length === 0)}
        onClick={() => onChange([])}
      >
        Any
      </button>
      {descriptor.options.map((option) => {
        const active = selected[0] === option.value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            className={pillClass(active)}
            onClick={() => onChange([option.value])}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function FilterPanel({
  descriptors,
  filters,
  onChange,
  onClose,
}: {
  descriptors: FilterDescriptor[]
  filters: Record<string, string[]>
  onChange: (filters: Record<string, string[]>) => void
  onClose: () => void
}) {
  const activeCount = Object.values(filters).filter((v) => v.length > 0).length
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} aria-hidden />
      <div className="absolute inset-x-0 top-full z-20 mt-2 max-h-[70vh] overflow-y-auto rounded-xl border border-line bg-card p-3 shadow-lg">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium text-muted">Filter by</p>
          {activeCount > 0 ? (
            <button type="button" className="text-xs text-accent" onClick={() => onChange({})}>
              Clear all
            </button>
          ) : null}
        </div>
        <div className="space-y-3">
          {descriptors.map((d) => (
            <div key={d.key}>
              <label className="mb-1 block text-xs text-muted">{d.label}</label>
              <FilterOptionPills
                descriptor={d}
                selected={filters[d.key] ?? []}
                onChange={(values) => onChange({ ...filters, [d.key]: values })}
              />
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-end">
          <button type="button" className="tap-target text-xs text-muted" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </>
  )
}

/**
 * Floating above the bottom nav rather than up in the header, so adding a record stays in thumb
 * reach no matter how far the list has been scrolled. `pointer-events-none` on the wrapper lets taps
 * pass through to the list on either side of the button; only the button itself re-enables them.
 */
function NewRecordButton({ table, schema }: { table: string; schema: TableSchema }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-16 z-20 flex justify-end px-4 pb-safe">
      <div className="mx-auto flex w-full max-w-2xl justify-end">
        <Link to={`/${table}/new`} className="pointer-events-auto">
          <Button variant="primary" className="shadow-lg shadow-black/20">
            New {schema.labelSingular.toLowerCase()}
          </Button>
        </Link>
      </div>
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
      <BadgeStack rows={[[<span key="id" className="font-mono text-xs text-muted">{row[schema.idField]}</span>]]} />
    </div>
  )
}
