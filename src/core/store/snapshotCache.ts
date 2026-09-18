import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval'
import type { RepoConfig, Snapshot } from '../github'

/**
 * The last successfully read dataset, kept so the app has something to draw with no network.
 *
 * This is a different cache from the blob cache in `github/read.ts`, and the difference is the
 * whole point. That one is keyed by commit sha — immutable, never stale, and **unreachable
 * offline**, because learning the sha is itself a network request. This one is keyed by *where the
 * data lives* and holds the last known good view: possibly stale, always available.
 *
 * A stale base is safe to render. Screens show `snapshot + queue`, and `syncChanges` re-reads the
 * repo fresh inside its retry loop before committing, so nothing that lands in the repo is ever
 * derived from these bytes.
 */

/**
 * Keyed by the data location, not a constant, so pointing Settings at a different repo or branch
 * cannot show you another dataset's cached rows (see ADR 0008).
 */
export function snapshotKey(config: RepoConfig): string {
  return `grannydb.snapshot:${config.owner}/${config.repo}/${config.branch}/${config.dataDir}`
}

/** Mark a snapshot as having come from this cache, keeping the time it was originally fetched. */
export function toCached(snapshot: Snapshot): Snapshot {
  return { ...snapshot, source: 'cache' }
}

/**
 * What comes back out of IndexedDB was written by some past version of the app, so it is treated as
 * untrusted input. A shape check here is cheaper than a crash three screens later.
 */
export function isStoredSnapshot(value: unknown): value is Snapshot {
  if (typeof value !== 'object' || value === null) return false
  const s = value as Partial<Snapshot>
  if (typeof s.fetchedAt !== 'number') return false
  if (typeof s.tables !== 'object' || s.tables === null) return false
  const schemas = s.schemas as Snapshot['schemas'] | undefined
  return Array.isArray(schemas?.order) && typeof schemas?.tables === 'object'
}

/** Same reason as the queue's helper: idb-keyval throws synchronously when storage is unavailable. */
async function attempt<T>(operation: () => Promise<T>): Promise<T | undefined> {
  try {
    return await operation()
  } catch {
    return undefined
  }
}

/**
 * Snapshots are plain data — parsed CSV rows and schema objects, no class instances, no functions —
 * so they go into IndexedDB as they are, with no serialisation step. Keep it that way.
 */
export async function saveSnapshot(config: RepoConfig, snapshot: Snapshot): Promise<void> {
  await attempt(() => idbSet(snapshotKey(config), snapshot))
}

export async function loadSnapshot(config: RepoConfig): Promise<Snapshot | null> {
  const raw = await attempt(() => idbGet<unknown>(snapshotKey(config)))
  return isStoredSnapshot(raw) ? toCached(raw) : null
}

export async function clearSnapshot(config: RepoConfig): Promise<void> {
  await attempt(() => idbDel(snapshotKey(config)))
}
