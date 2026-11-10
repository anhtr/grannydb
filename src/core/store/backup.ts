import type { CsvTable } from '../csv'
import type { RepoConfig } from '../github'
import { projectPath, serializeProject } from '../project'
import type { ProjectDoc } from '../project'
import type { SchemaSet } from '../schema'
import type { Change } from './queue'
import { toFile } from './sync'

/**
 * The data as this device holds it, in one document that can be saved as a file.
 *
 * The repo is the backup for everything that has been synced (docs/06-operations.md). What it
 * cannot hold is what has not reached it: edits queued on a device that is offline, has lost its
 * token, or keeps failing to sync. Those exist in one browser's storage and nowhere else, and this
 * is the way to get them out of it.
 */
export interface Backup {
  format: 'grannydb-backup'
  /** Of this document's shape, so a later reader can tell what it is looking at. */
  formatVersion: 1
  /** ISO 8601 instant the backup was made. */
  exportedAt: string
  /** Where the data was read from, and the commit it was read at (null for the published bundle). */
  source: { owner: string; repo: string; branch: string; dataDir: string; commit: string | null }
  /**
   * Repo path to file text, pending edits already applied: each table's CSV exactly as the next
   * sync would write it, and `project.json`. Dropping these over the files in a clone restores the
   * state this device was showing.
   */
  files: Record<string, string>
  /**
   * The unsynced edits themselves, as queued. Already folded into `files`; kept as well because
   * they say *what changed*, which the files alone do not.
   */
  pendingChanges: Change[]
}

export interface BackupInput {
  config: RepoConfig
  commit: string | null
  schemas: SchemaSet
  /** Tables with the queue replayed on top - `AppState.data`. */
  data: Record<string, CsvTable>
  /** `project.json` with the queue replayed on top - `AppState.project`. */
  project: ProjectDoc
  changes: readonly Change[]
  exportedAt: Date
}

/** One table's CSV as the next sync would write it, or null for a table with no schema or no data. */
export function tableCsv(schemas: SchemaSet, data: Record<string, CsvTable>, table: string): { path: string; text: string } | null {
  const rows = data[table]
  return rows ? toFile(rows, schemas, table) : null
}

/**
 * Schemas are left out on purpose. The app holds them parsed, not as text, and writing them back
 * out would drop any key it does not know - the one thing every writer here is careful not to do.
 * They change by hand, in the repo, and are safe there.
 */
export function buildBackup(input: BackupInput): Backup {
  const { config, schemas, data } = input
  const files: Record<string, string> = {}
  for (const table of schemas.order) {
    const file = tableCsv(schemas, data, table)
    if (file) files[file.path] = file.text
  }
  // An empty document means the data directory has no project.json; a backup should not invent one.
  if (Object.keys(input.project).length > 0) files[projectPath(config.dataDir)] = serializeProject(input.project)
  return {
    format: 'grannydb-backup',
    formatVersion: 1,
    exportedAt: input.exportedAt.toISOString(),
    source: { owner: config.owner, repo: config.repo, branch: config.branch, dataDir: config.dataDir, commit: input.commit },
    files,
    pendingChanges: [...input.changes],
  }
}
