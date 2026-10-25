import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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

/** A categorical filter: toggleable pills, any number selected at once and OR'd together. */
export interface PillFilterDescriptor {
  kind?: 'pills'
  key: string
  label: string
  options: FilterOption[]
  matches: (row: CsvRow, value: string) => boolean
}

/**
 * A numeric filter: a min–max slider from 0 to `max`, the highest value currently in the data. Every
 * number is filtered this way rather than as pills of its distinct values — "at least 2 skeins" or
 * "used in 1 to 3 squares" are range questions, and a pill per count could only answer them one exact
 * count at a time.
 */
export interface RangeFilterDescriptor {
  kind: 'range'
  key: string
  label: string
  max: number
  value: (row: CsvRow) => number
}

export type FilterDescriptor = PillFilterDescriptor | RangeFilterDescriptor

/**
 * A range filter's selection, saved in the same `string[]` slot a pill filter uses: `[min, max]`, with
 * `''` at either end meaning unbounded. The top end is saved as unbounded whenever the thumb sits at
 * the data's maximum, so "4 or more" keeps meaning that after a yarn with more skeins than anything
 * before it is added, rather than silently capping at whatever the maximum was on the day. A one-item
 * `['3']` — the old "3+" threshold pills' saved shape — therefore still reads as "3 or more".
 */
export function rangeMatches(n: number, values: string[]): boolean {
  const [lo = '', hi = ''] = values
  return (lo === '' || n >= Number(lo)) && (hi === '' || n <= Number(hi))
}

/** The thumbs' positions for a saved selection, clamped into 0..`max` as the data stands now. */
export function readRange(values: string[], max: number): { lo: number; hi: number } {
  const [lo = '', hi = ''] = values
  const from = Math.min(Math.max(Number(lo) || 0, 0), max)
  const to = hi === '' ? max : Math.min(Math.max(Number(hi) || 0, from), max)
  return { lo: from, hi: to }
}

/** The selection to save for thumbs at `lo`/`hi` — empty, meaning "no filter", when they span it all. */
export function rangeSelection(lo: number, hi: number, max: number): string[] {
  if (lo <= 0 && hi >= max) return []
  return [lo > 0 ? String(lo) : '', hi < max ? String(hi) : '']
}

/** The highest of `value` across `rows`, rounded up so a slider in whole steps can reach it. */
export function rangeMax(rows: CsvRow[], value: (row: CsvRow) => number): number {
  return Math.ceil(rows.reduce((m, r) => Math.max(m, value(r)), 0))
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

      if (field.type === 'number') {
        const value = (row: CsvRow) => Number(fieldValue(row)) || 0
        return { kind: 'range', key: field.key, label: field.label, max: rangeMax(data.rows, value), value }
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

/**
 * Each list's search text and scroll position, for this session only - opening a record and coming
 * back should land where you were, typed search included. Not saved with the filters and sort in
 * `prefs`: a search is a passing question, and finding one still applied tomorrow would be a surprise.
 */
const listMemory = new Map<string, { query: string; scrollY: number }>()

/** Keeps `listMemory` current for `table` and puts the scroll position back on return. */
function useListMemory(table: string, query: string, ready: boolean) {
  const queryRef = useRef(query)
  queryRef.current = query
  const restored = useRef(false)

  useLayoutEffect(() => {
    if (!ready || restored.current) return
    restored.current = true
    const saved = listMemory.get(table)
    if (saved) window.scrollTo(0, saved.scrollY)
  }, [table, ready])

  // Not before the rows are in: a spinner's scroll position of 0 would overwrite the saved one. A
  // layout effect, so the listener is gone before the next screen resets the scroll to the top.
  useLayoutEffect(() => {
    if (!ready) return
    const remember = () => listMemory.set(table, { query: queryRef.current, scrollY: window.scrollY })
    remember()
    window.addEventListener('scroll', remember, { passive: true })
    return () => window.removeEventListener('scroll', remember)
  }, [table, query, ready])
}

export function RecordList({ table, renderRow, header, extraSortOptions, extraFilters }: RecordListProps) {
  const state = useAppState()
  const schema = useTableSchema(table)
  const data = useTable(table)
  const resolve = useResolveRef()
  const canEdit = useCanEdit()
  const [query, setQuery] = useState(() => listMemory.get(table)?.query ?? '')
  useListMemory(table, query, schema !== null && data !== null)
  const [sortPanelOpen, setSortPanelOpen] = useState(false)
  const [filterPanelOpen, setFilterPanelOpen] = useState(false)
  useEffect(() => {
    if (!sortPanelOpen && !filterPanelOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setSortPanelOpen(false)
      setFilterPanelOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sortPanelOpen, filterPanelOpen])
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
        if (!values || values.length === 0) return true
        return d.kind === 'range' ? rangeMatches(d.value(row), values) : values.some((v) => d.matches(row, v))
      })
    })
    return sortRows(filtered, schema, sorts.map(specFor), resolve)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, data, query, filters, filterDescriptors, sorts, sortOptions, computedSortOptions, resolve])

  if (!schema || !data) return <Spinner />

  const activeFilters = Object.values(filters).filter((v) => v.length > 0).length
  const sortActive = !sortsEqual(sorts, defaultSorts(schema))
  const sortLabel = (key: string) => allSortOptions.find((o) => o.key === key)?.label ?? key
  // Split so only the field name truncates on a narrow screen, never the direction or the "+1".
  const sortButtonMain = sorts.length === 0 ? 'Sort' : `Sort: ${sortLabel(sorts[0].key)}`
  const sortButtonTail =
    sorts.length === 0 ? '' : sorts.length === 1 ? (sorts[0].dir === 'asc' ? '↑' : '↓') : `+${sorts.length - 1}`
  const sortButtonText = `${sortButtonMain} ${sortButtonTail}`.trim()

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
            aria-label={`Search ${schema.label.toLowerCase()}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            // The list already filters as you type, so the keyboard's Search key has nothing left to do
            // but get out of the way of the results.
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
          />
          {allSortOptions.length > 0 ? (
            <button
              type="button"
              title={sortButtonText}
              aria-expanded={sortPanelOpen}
              // Capped and truncated: a long rule ("Sort: Main colour +1") otherwise squeezes the search
              // box down to a few letters on a phone. The panel spells the rules out in full.
              className={`tap-target flex min-w-0 max-w-[40%] shrink items-center gap-1 whitespace-nowrap rounded-xl border px-3 text-sm ${
                sortActive ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-card'
              }`}
              onClick={() => {
                setFilterPanelOpen(false)
                setSortPanelOpen((v) => !v)
              }}
            >
              <span className="min-w-0 truncate">{sortButtonMain}</span>
              {sortButtonTail ? <span className="shrink-0">{sortButtonTail}</span> : null}
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

      {data.rows.length === 0 ? (
        <EmptyState
          title={`No ${schema.label.toLowerCase()} yet`}
          hint={canEdit ? `Add one with the New ${schema.labelSingular.toLowerCase()} button.` : undefined}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title={`No ${schema.label.toLowerCase()} match`}
          action={
            <Button
              onClick={() => {
                setQuery('')
                if (activeFilters > 0) setListPrefs({ filters: {} })
              }}
            >
              Clear {query !== '' && activeFilters > 0 ? 'search and filters' : query !== '' ? 'search' : 'filters'}
            </Button>
          }
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

/** A dropdown panel under the search row, no taller than the space between that row (~7rem from the
 * top while it is stuck there) and the bottom bar, so its end never slides under the nav. */
const panelClass =
  'absolute inset-x-0 top-full z-20 mt-2 max-h-[calc(100dvh-var(--footer-height,4rem)-8rem)] overflow-y-auto rounded-xl border border-line bg-card shadow-lg'

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
      <div className={`${panelClass} p-3`}>
        <p className="mb-2 text-xs font-medium text-muted">Sort by, in priority order</p>
        <ol className="space-y-1.5">
          {sorts.map((sort, i) => (
            // Wraps the four controls under the name on a narrow phone rather than truncating the name to
            // a couple of letters - which rule is which matters more than keeping it on one line.
            <li key={sort.key} className="flex flex-wrap items-center gap-1.5">
              <span className="w-4 shrink-0 text-center text-xs text-muted">{i + 1}</span>
              <span className="min-w-[7rem] flex-1 truncate text-sm">
                {options.find((o) => o.key === sort.key)?.label ?? sort.key}
              </span>
              <span className="ml-auto flex gap-1.5">
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
              </span>
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
function pillClass(active: boolean): string {
  return `tap-target rounded-lg border px-2.5 text-xs ${active ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-card'}`
}

/** A filter past this many options gets a search box instead of a flat pill row — see
 * `SearchableFilterPills`. Below it, every option fits as a glance-able row; a status or
 * construction filter (a handful of enum values) never crosses this. */
const SEARCHABLE_FILTER_THRESHOLD = 8

/**
 * A filter with more options than fit as a glance-able row (design, colour — issue #4) gets a search
 * box instead of listing every one. Same "type to narrow, tap to toggle" pattern a `ref` field's
 * multi-select already uses (`RefListInput`'s extra-colours picker): with the box empty, only what is
 * already selected shows, not every option the filter has — so this stays usable once a filter has
 * hundreds of values, the same way the colour picker stays usable once the yarn table does.
 */
function SearchableFilterPills({
  descriptor,
  selected,
  onChange,
}: {
  descriptor: PillFilterDescriptor
  selected: string[]
  onChange: (values: string[]) => void
}) {
  const [query, setQuery] = useState('')
  const searching = query.trim() !== ''
  const visible = descriptor.options.filter(
    (option) => selected.includes(option.value) || (searching && matchesSearch(option.label, query)),
  )

  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])
  }

  return (
    <div className="space-y-1.5">
      <input
        type="search"
        className={`${inputClass} px-2.5 py-1.5 text-xs`}
        placeholder={`Search ${descriptor.label.toLowerCase()}`}
        aria-label={`Search ${descriptor.label.toLowerCase()} options`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Filter by ${descriptor.label}`}>
        {visible.map((option) => {
          const active = selected.includes(option.value)
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              className={pillClass(active)}
              onClick={() => toggle(option.value)}
            >
              {option.label}
            </button>
          )
        })}
        {!searching && selected.length === 0 ? (
          <span className="py-1.5 text-xs text-muted">Type to search — nothing selected yet.</span>
        ) : null}
        {searching && visible.length === 0 ? <span className="py-1.5 text-xs text-muted">No matches.</span> : null}
      </div>
    </div>
  )
}

/** One filter's options as a row of toggleable pills, any number at once and OR'd together. Past
 * `SEARCHABLE_FILTER_THRESHOLD` options, delegates to `SearchableFilterPills` instead of laying
 * every one out flat. */
function FilterOptionPills({
  descriptor,
  selected,
  onChange,
}: {
  descriptor: PillFilterDescriptor
  selected: string[]
  onChange: (values: string[]) => void
}) {
  if (descriptor.options.length > SEARCHABLE_FILTER_THRESHOLD) {
    return <SearchableFilterPills descriptor={descriptor} selected={selected} onChange={onChange} />
  }

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

/** What a range filter's selection reads as, next to its label: "Any", "2+", "up to 5" or "2–5". */
function rangeSummary(lo: number, hi: number, max: number): string {
  if (lo <= 0 && hi >= max) return 'Any'
  if (lo === hi) return String(lo)
  if (hi >= max) return `${lo}+`
  if (lo <= 0) return `up to ${hi}`
  return `${lo}–${hi}`
}

/** Native thumbs travel inset by half their own width; the drawn fill has to match. See `.range-pair`. */
const RANGE_THUMB_PX = 24

function thumbOffset(n: number, max: number): string {
  return `calc(${RANGE_THUMB_PX / 2}px + (100% - ${RANGE_THUMB_PX}px) * ${n / max})`
}

/**
 * A min–max slider: two native `<input type="range">` stacked on one track rather than a custom
 * pointer-dragging widget, so keyboard steps, touch, and screen-reader announcements all come from
 * the browser for free. The cost is styling — see `.range-pair` in `styles.css` for how only the
 * thumbs are made to take pointer events, so each stays reachable through the other input.
 */
function RangeFilter({
  descriptor,
  selected,
  onChange,
}: {
  descriptor: RangeFilterDescriptor
  selected: string[]
  onChange: (values: string[]) => void
}) {
  const { max, label } = descriptor
  const { lo, hi } = readRange(selected, max)
  if (max <= 0) return <p className="text-xs text-muted">Every one is 0 so far.</p>

  return (
    <div className="range-pair relative h-11">
      <div
        className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-line"
        style={{ left: thumbOffset(0, max), right: `${RANGE_THUMB_PX / 2}px` }}
      />
      <div
        className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-accent"
        style={{ left: thumbOffset(lo, max), width: `calc((100% - ${RANGE_THUMB_PX}px) * ${(hi - lo) / max})` }}
      />
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={lo}
        aria-label={`Minimum ${label.toLowerCase()}`}
        // Both thumbs parked at the top end would leave only the upper one grabbable, and it can only
        // move down to where the lower one already is — so the lower input rises above it there.
        className={lo > max / 2 ? 'z-[1]' : undefined}
        onChange={(e) => onChange(rangeSelection(Math.min(Number(e.target.value), hi), hi, max))}
      />
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={hi}
        aria-label={`Maximum ${label.toLowerCase()}`}
        onChange={(e) => onChange(rangeSelection(lo, Math.max(Number(e.target.value), lo), max))}
      />
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
      <div className={`${panelClass} p-3`}>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium text-muted">Filter by</p>
          {activeCount > 0 ? (
            <button type="button" className="text-xs text-accent" onClick={() => onChange({})}>
              Clear all
            </button>
          ) : null}
        </div>
        <div className="space-y-3">
          {descriptors.map((d) => {
            const selected = filters[d.key] ?? []
            const set = (values: string[]) => onChange({ ...filters, [d.key]: values })
            if (d.kind === 'range') {
              const { lo, hi } = readRange(selected, d.max)
              return (
                <div key={d.key}>
                  <div className="flex items-baseline justify-between text-xs text-muted">
                    <span>{d.label}</span>
                    <span className={selected.length > 0 ? 'text-accent' : undefined}>
                      {rangeSummary(lo, hi, d.max)}
                    </span>
                  </div>
                  <RangeFilter descriptor={d} selected={selected} onChange={set} />
                </div>
              )
            }
            return (
              <div key={d.key}>
                <label className="mb-1 block text-xs text-muted">{d.label}</label>
                <FilterOptionPills descriptor={d} selected={selected} onChange={set} />
              </div>
            )
          })}
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
    <div className="pointer-events-none fixed inset-x-0 bottom-[var(--footer-height,4rem)] z-20 flex justify-end px-4 pb-2">
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
