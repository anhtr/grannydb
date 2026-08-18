import { useSyncExternalStore } from 'react'
import { appStore } from '../core/store'
import type { AppState } from '../core/store'
import type { CsvRow, CsvTable } from '../core/csv'
import { findRow } from '../core/csv'
import type { SchemaSet, TableSchema } from '../core/schema'

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

export function usePendingCount(): number {
  return useAppState().changes.length
}

/** Whether the current session can write, i.e. has a token saved. */
export function useCanEdit(): boolean {
  return useAppState().token !== null
}
