import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval'
import type { CsvRow } from '../csv'
import type { ProjectValue } from '../project'

/**
 * One pending edit.
 *
 * The queue stores *operations*, never rewritten files. That single choice is what makes syncing
 * from two devices safe: at sync time we fetch whatever the repo says now and replay these on top,
 * rather than overwriting the repo with a copy we read an hour ago.
 *
 * Two shapes, told apart by `op`: a row edit to a CSV table, and a key edit to a JSON document
 * (`project.json`). Both carry only what changed, for the same reason.
 */
export type Change = RowChange | DocChange

/**
 * `values` holds only the fields that actually changed, so an edit to `notes` here cannot revert a
 * `position` set elsewhere in the meantime.
 */
export interface RowChange {
  id: string
  ts: number
  table: string
  op: 'upsert' | 'delete'
  rowId: string
  values?: CsvRow
}

/**
 * Sets keys on a JSON document. `values` holds only the keys that changed, so editing the start
 * date on one device cannot revert a target changed on another — the same field-level rule as rows.
 * There is no delete: a document is not a collection, and a `null` value removes one key.
 */
export interface DocChange {
  id: string
  ts: number
  op: 'set'
  doc: 'project'
  values: Record<string, ProjectValue>
}

export function isRowChange(change: Change): change is RowChange {
  return change.op !== 'set'
}

const QUEUE_KEY = 'grannydb.queue'

export function newChangeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * idb-keyval touches `indexedDB` synchronously, so it throws before returning a promise when
 * storage is unavailable — private browsing modes, disabled site data, a non-browser test
 * environment. A trailing `.catch()` would never attach, so every call goes through here.
 */
async function attempt<T>(operation: () => Promise<T>): Promise<T | undefined> {
  try {
    return await operation()
  } catch {
    return undefined
  }
}

/**
 * True once a queue write has failed.
 *
 * When storage is unavailable the queue still works in memory for the session, but it is no longer
 * durable. That is a meaningful downgrade — the whole promise of local-first is that edits survive
 * a refresh — so the app surfaces it rather than pretending nothing changed.
 */
let persistenceFailed = false

export function isQueueDurable(): boolean {
  return !persistenceFailed
}

/**
 * IndexedDB rather than memory, so unsynced edits survive a refresh, a closed tab, or a dead
 * battery. Losing an hour of squares to an accidental swipe-up is not acceptable.
 */
export async function loadQueue(): Promise<Change[]> {
  const raw = await attempt(() => idbGet<Change[]>(QUEUE_KEY))
  if (!Array.isArray(raw)) return []
  return raw.slice().sort((a, b) => a.ts - b.ts)
}

export async function saveQueue(changes: readonly Change[]): Promise<void> {
  const copy = changes.slice()
  const result = await attempt(async () => {
    await idbSet(QUEUE_KEY, copy)
    return true
  })
  if (result !== true) persistenceFailed = true
}

export async function clearQueue(): Promise<void> {
  await attempt(() => idbDel(QUEUE_KEY))
}

/**
 * Append a change, collapsing it into a compatible pending one where possible.
 *
 * Without collapsing, editing the same square five times before syncing produces five operations
 * that all replay in order to the same result. Correct but wasteful. We only ever merge into the
 * *last* operation for that row, so ordering against other rows is untouched.
 */
export function appendChange(changes: readonly Change[], change: Change): Change[] {
  const next = changes.slice()

  if (change.op === 'set') {
    const lastIndex = next.findLastIndex((c) => c.op === 'set' && c.doc === change.doc)
    const last = next[lastIndex]
    if (last && last.op === 'set') {
      next[lastIndex] = { ...last, ts: change.ts, values: { ...last.values, ...change.values } }
      return next
    }
    next.push(change)
    return next
  }

  const lastIndex = next.findLastIndex((c) => isRowChange(c) && c.table === change.table && c.rowId === change.rowId)

  if (lastIndex !== -1) {
    const last = next[lastIndex] as RowChange
    if (change.op === 'delete') {
      // A delete supersedes everything pending for that row.
      return [...next.slice(0, lastIndex), ...next.slice(lastIndex + 1), change]
    }
    if (last.op === 'upsert') {
      next[lastIndex] = {
        ...last,
        ts: change.ts,
        values: { ...last.values, ...change.values },
      }
      return next
    }
  }

  next.push(change)
  return next
}

export function upsertChange(table: string, rowId: string, values: CsvRow): RowChange {
  return { id: newChangeId(), ts: Date.now(), table, op: 'upsert', rowId, values }
}

export function deleteChange(table: string, rowId: string): RowChange {
  return { id: newChangeId(), ts: Date.now(), table, op: 'delete', rowId }
}

export function projectChange(values: Record<string, ProjectValue>): DocChange {
  return { id: newChangeId(), ts: Date.now(), op: 'set', doc: 'project', values }
}

/** Row ids with something pending, for the "unsynced" markers in list views. */
export function pendingRowIds(changes: readonly Change[], table: string): Set<string> {
  const ids = new Set<string>()
  for (const c of changes) if (isRowChange(c) && c.table === table) ids.add(c.rowId)
  return ids
}

export function tablesTouched(changes: readonly Change[]): string[] {
  return [...new Set(changes.filter(isRowChange).map((c) => c.table))]
}
