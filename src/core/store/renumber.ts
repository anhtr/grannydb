import { nextId } from '../csv'
import type { CsvRow, CsvTable } from '../csv'
import { joinList, splitList } from '../schema'
import type { SchemaSet } from '../schema'
import { isRowChange } from './queue'
import type { Change, RowChange } from './queue'

/** A new record that had to take a different id at sync time, because its own was already used. */
export interface Renumbering {
  table: string
  from: string
  to: string
}

/**
 * Whether the repo's row is this very create, already committed — a push that landed but whose
 * queue was never trimmed (the app was killed in between). Replaying it must commit nothing, as
 * every other replay does, so it is not a clash. Judged by content: every field the create sets
 * already reads the same in the repo.
 */
function alreadyCommitted(row: CsvRow, change: RowChange): boolean {
  return Object.entries(change.values ?? {}).every(([key, value]) => (row[key] ?? '') === value)
}

/**
 * Give every queued new record whose id the repo already holds the next free id instead, and point
 * everything else in the queue that refers to it at the new id too.
 *
 * Ids are assigned on the device, from whatever the device last read — so two devices offline at
 * once, or one reading a stale copy, can both hand out `S120`. A create and an edit are both
 * upserts, so without this the second `S120` would be written field by field over the first, and
 * one square would silently become the other. Run against the *fresh* read inside the sync loop,
 * this is the last moment the clash can be fixed before the id is published — after that it may be
 * in notes, in commit history, or on a sticky note, and ids are never changed once used.
 *
 * Only changes marked `create` are ever renumbered: an edit to an existing row is meant to land on
 * that row. A change queued before the flag existed has no `create` and keeps its old behaviour.
 */
export function resolveIdClashes(
  tables: Readonly<Record<string, CsvTable>>,
  schemas: SchemaSet,
  changes: readonly Change[],
): { changes: Change[]; renumbered: Renumbering[] } {
  const renumbered: Renumbering[] = []
  // Every id each table already has or is about to get, so a new id clashes with neither the repo
  // nor another queued record — nor one handed out earlier in this same pass.
  const taken = new Map<string, Set<string>>()
  const takenIn = (table: string): Set<string> => {
    let ids = taken.get(table)
    if (!ids) {
      const idField = schemas.tables[table]?.idField ?? 'id'
      ids = new Set((tables[table]?.rows ?? []).map((r) => r[idField] ?? ''))
      for (const c of changes) if (isRowChange(c) && c.table === table) ids.add(c.rowId)
      taken.set(table, ids)
    }
    return ids
  }

  for (const change of changes.slice().sort((a, b) => a.ts - b.ts)) {
    if (!isRowChange(change) || !change.create) continue
    const schema = schemas.tables[change.table]
    const table = tables[change.table]
    if (!schema || !table) continue
    const existing = table.rows.find((r) => r[schema.idField] === change.rowId)
    if (!existing || alreadyCommitted(existing, change)) continue

    const ids = takenIn(change.table)
    const to = nextId(
      { columns: [schema.idField], rows: [...ids].map((id) => ({ [schema.idField]: id })) },
      schema.idField,
      schema.idPrefix,
      schema.idPadding,
    )
    ids.add(to)
    renumbered.push({ table: change.table, from: change.rowId, to })
  }

  return { changes: renumberChanges(changes, schemas, renumbered), renumbered }
}

/**
 * Rewrite `changes` so each `from` id reads as its `to`: the record's own changes, and every `ref`
 * or `reflist` value in any queued change that points at it — a square queued with a design that
 * was quick-created alongside it follows the design to its new id. Rows already in the repo are not
 * touched; a reference there to `from` meant the record that genuinely holds that id.
 *
 * Also used after a sync, on edits queued while the push was in flight, so they land on the record
 * they were made to rather than on the other device's.
 */
export function renumberChanges(
  changes: readonly Change[],
  schemas: SchemaSet,
  renumbered: readonly Renumbering[],
): Change[] {
  if (renumbered.length === 0) return changes.slice()
  const byTable = new Map<string, Map<string, string>>()
  for (const r of renumbered) {
    if (!byTable.has(r.table)) byTable.set(r.table, new Map())
    byTable.get(r.table)!.set(r.from, r.to)
  }

  return changes.map((change) => {
    if (!isRowChange(change)) return change
    const schema = schemas.tables[change.table]
    if (!schema) return change
    const own = byTable.get(change.table)?.get(change.rowId)
    const values = change.values ? { ...change.values } : undefined

    if (values) {
      if (own) values[schema.idField] = own
      for (const field of schema.fields) {
        const map = field.refTable ? byTable.get(field.refTable) : undefined
        const value = values[field.key]
        if (!map || value === undefined) continue
        if (field.type === 'ref') {
          values[field.key] = map.get(value) ?? value
        } else if (field.type === 'reflist') {
          const sep = field.separator ?? ';'
          const ids = splitList(value, sep)
          // Rejoined only when something moved, so an untouched list keeps its exact spelling.
          if (ids.some((id) => map.has(id))) values[field.key] = joinList(ids.map((id) => map.get(id) ?? id), sep)
        }
      }
    }

    return { ...change, rowId: own ?? change.rowId, ...(values ? { values } : {}) }
  })
}
