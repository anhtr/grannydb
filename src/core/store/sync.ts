import { ensureColumns, serializeCsv } from '../csv'
import type { CsvTable } from '../csv'
import { schemaColumns, validateDataset } from '../schema'
import type { Issue, SchemaSet } from '../schema'
import { commitFiles, readFromApi, StaleHeadError } from '../github'
import type { FileChange, RepoConfig, Snapshot } from '../github'
import { applyChanges } from './merge'
import { commitMessage } from './message'
import type { Change } from './queue'

export interface SyncResult {
  status: 'committed' | 'nothing-to-do'
  /** Sha of the new commit, or of the unchanged head. */
  sha: string
  paths: string[]
  changeCount: number
  attempts: number
  /** Validation problems in the merged data. Non-blocking; surfaced for review. */
  issues: Issue[]
}

export interface LastSync {
  at: number
  sha: string
  paths: string[]
  changeCount: number
}

const LAST_SYNC_KEY = 'grannydb.last-sync'

export function loadLastSync(): LastSync | null {
  try {
    const raw = localStorage.getItem(LAST_SYNC_KEY)
    return raw ? (JSON.parse(raw) as LastSync) : null
  } catch {
    return null
  }
}

export function saveLastSync(value: LastSync): void {
  localStorage.setItem(LAST_SYNC_KEY, JSON.stringify(value))
}

/**
 * Serialise a table for writing, aligning its columns with the schema first.
 *
 * `ensureColumns` appends schema fields the file does not have yet, which is how a newly added
 * schema field gets a column. It never reorders or drops what is already there, so a column added
 * by hand in a spreadsheet survives.
 */
function toFile(table: CsvTable, schemas: SchemaSet, name: string): { path: string; text: string } | null {
  const schema = schemas.tables[name]
  if (!schema) return null
  const aligned = ensureColumns(table, schemaColumns(schema))
  return { path: schema.file, text: serializeCsv(aligned, { sortBy: schema.idField }) }
}

/**
 * Push the pending queue as a single commit.
 *
 * The loop is the interesting part. Each attempt:
 *   1. reads the repo *fresh*, pinned to a commit sha
 *   2. replays the queue onto that data
 *   3. writes the result, refusing to move the branch if it shifted meanwhile
 *
 * So a conflict is not an error state needing a merge UI — it is just a retry against newer data.
 * Edits made on a laptop, or by hand in the GitHub web editor, are picked up and preserved rather
 * than clobbered, because we never send back a file we read before those edits existed.
 */
export async function syncChanges(
  config: RepoConfig,
  token: string,
  changes: readonly Change[],
  options: { maxAttempts?: number; signal?: AbortSignal } = {},
): Promise<SyncResult> {
  if (changes.length === 0) {
    return { status: 'nothing-to-do', sha: '', paths: [], changeCount: 0, attempts: 0, issues: [] }
  }

  const maxAttempts = options.maxAttempts ?? 3
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let snapshot: Snapshot
    try {
      snapshot = await readFromApi(config, token, options.signal)
    } catch (error) {
      lastError = error
      break
    }
    if (!snapshot.commit) throw new Error('Cannot sync: the read did not report a commit sha.')

    const merged = applyChanges(snapshot.tables, snapshot.schemas, changes)

    // Only write tables whose serialised form actually differs. This keeps a no-op edit from
    // producing an empty commit, and stops untouched tables from being reformatted.
    const files: FileChange[] = []
    for (const name of snapshot.schemas.order) {
      const before = snapshot.tables[name]
      const after = merged[name]
      if (!before || !after) continue
      const beforeFile = toFile(before, snapshot.schemas, name)
      const afterFile = toFile(after, snapshot.schemas, name)
      if (!beforeFile || !afterFile) continue
      if (beforeFile.text !== afterFile.text) {
        files.push({ path: afterFile.path, content: afterFile.text })
      }
    }

    const issues = validateDataset(snapshot.schemas, merged)

    if (files.length === 0) {
      return {
        status: 'nothing-to-do',
        sha: snapshot.commit,
        paths: [],
        changeCount: changes.length,
        attempts: attempt,
        issues,
      }
    }

    try {
      const result = await commitFiles(
        config,
        token,
        files,
        commitMessage(changes, snapshot.schemas),
        snapshot.commit,
        options.signal,
      )
      return {
        status: 'committed',
        sha: result.sha,
        paths: result.paths,
        changeCount: changes.length,
        attempts: attempt,
        issues,
      }
    } catch (error) {
      lastError = error
      // Someone moved the branch. Loop round, re-read, replay onto the newer data.
      if (error instanceof StaleHeadError) continue
      throw error
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Sync failed after repeated attempts.')
}
