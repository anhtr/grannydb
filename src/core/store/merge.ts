import { applyDelete, applyUpsert } from '../csv'
import type { CsvTable } from '../csv'
import type { SchemaSet } from '../schema'
import type { Change } from './queue'

/**
 * Base data with the pending queue replayed on top.
 *
 * This is the read model. Every screen renders from it, which is why a local edit shows up
 * instantly and never appears to have been swallowed — and why the exact same function can be
 * pointed at freshly fetched data at sync time to produce what we commit.
 *
 * Changes are applied in timestamp order; last writer wins per field.
 */
export function applyChanges(
  tables: Readonly<Record<string, CsvTable>>,
  schemas: SchemaSet,
  changes: readonly Change[],
): Record<string, CsvTable> {
  const result: Record<string, CsvTable> = { ...tables }
  const ordered = changes.slice().sort((a, b) => a.ts - b.ts)

  for (const change of ordered) {
    const schema = schemas.tables[change.table]
    const table = result[change.table]
    // A change for a table the schema no longer knows about is dropped rather than crashing the
    // app. It stays in the queue and surfaces on the sync screen.
    if (!schema || !table) continue

    result[change.table] =
      change.op === 'delete'
        ? applyDelete(table, schema.idField, change.rowId)
        : applyUpsert(table, schema.idField, change.rowId, change.values ?? {})
  }

  return result
}

/** Changes that could not be applied, e.g. because their table vanished from the schema. */
export function unapplicableChanges(
  tables: Readonly<Record<string, CsvTable>>,
  schemas: SchemaSet,
  changes: readonly Change[],
): Change[] {
  return changes.filter((c) => !schemas.tables[c.table] || !tables[c.table])
}
