import { useMemo, useSyncExternalStore } from 'react'
import { appStore } from '../core/store'
import type { AppState } from '../core/store'
import type { CsvRow, CsvTable } from '../core/csv'
import { findRow } from '../core/csv'
import { idSet } from '../core/schema'
import type { RefLookup, ResolveRef, SchemaSet, TableSchema } from '../core/schema'

export function useAppState(): AppState {
  return useSyncExternalStore(appStore.subscribe, appStore.getState, appStore.getState)
}

export function useSchemas(): SchemaSet | null {
  return useAppState().snapshot?.schemas ?? null
}

export function useTableSchema(table: string): TableSchema | null {
  return useAppState().snapshot?.schemas.tables[table] ?? null
}

/** Merged data for a table: what is in the repo, plus anything queued locally. */
export function useTable(table: string): CsvTable | null {
  return useAppState().data[table] ?? null
}

export function useRow(table: string, id: string | undefined): CsvRow | null {
  const state = useAppState()
  if (!id) return null
  const schema = state.snapshot?.schemas.tables[table]
  const data = state.data[table]
  if (!schema || !data) return null
  return findRow(data, schema.idField, id) ?? null
}

/** Lookup map from id to row, for resolving `ref` fields without repeated scans. */
export function useLookup(table: string): Map<string, CsvRow> {
  const state = useAppState()
  const schema = state.snapshot?.schemas.tables[table]
  const data = state.data[table]
  const map = new Map<string, CsvRow>()
  if (!schema || !data) return map
  for (const row of data.rows) {
    const id = row[schema.idField]
    if (id) map.set(id, row)
  }
  return map
}

/**
 * Look up any table's schema and rows by name, for resolving `ref` chains that are not known ahead
 * of time — a search box, a filter, a derived filter. Built once per data change and cached per
 * table for the render, rather than a hook per table, since the tables involved vary by field.
 */
export function useResolveRef(): ResolveRef {
  const state = useAppState()
  return useMemo(() => {
    const cache = new Map<string, RefLookup | undefined>()
    return (table: string) => {
      if (cache.has(table)) return cache.get(table)
      const schema = state.snapshot?.schemas.tables[table]
      const data = state.data[table]
      let result: RefLookup | undefined
      if (schema && data) {
        const rows = new Map<string, CsvRow>()
        for (const row of data.rows) {
          const id = row[schema.idField]
          if (id) rows.set(id, row)
        }
        result = { schema, rows }
      }
      cache.set(table, result)
      return result
    }
  }, [state.snapshot, state.data])
}

/**
 * Ids that exist in each table, keyed by table name — for catching a `ref` that points nowhere
 * before it is saved. Shared by every form that validates a row, so a quick-create form gets the same
 * referential check as the main record form without recomputing it separately.
 */
export function useRefIds(): Record<string, ReadonlySet<string>> {
  const state = useAppState()
  return useMemo(() => {
    const map: Record<string, Set<string>> = {}
    if (!state.snapshot) return map
    for (const name of state.snapshot.schemas.order) {
      const s = state.snapshot.schemas.tables[name]
      const t = state.data[name]
      if (s && t) map[name] = idSet(t, s.idField)
    }
    return map
  }, [state.snapshot, state.data])
}

export function usePendingCount(): number {
  return useAppState().changes.length
}

/** Whether the current session can write, i.e. has a token saved. */
export function useCanEdit(): boolean {
  return useAppState().token !== null
}
