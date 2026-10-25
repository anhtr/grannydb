import { get as idbGet, set as idbSet } from 'idb-keyval'
import { parseCsv } from '../csv'
import type { CsvTable } from '../csv'
import { buildSchemaSet, manifestPath, schemaPath } from '../schema'
import type { SchemaSet } from '../schema'
import { parseProject, projectPath } from '../project'
import type { ProjectDoc } from '../project'
import { apiJson, apiText, GitHubError, plainText } from './client'
import type { RepoConfig } from './config'

/**
 * Where a loaded dataset came from. `cache` is not a read path here — it is set by the store when a
 * failed read falls back to the copy saved on the device; see `store/snapshotCache.ts`.
 */
export type SourceKind = 'api' | 'bundle' | 'raw' | 'cache'

export interface Snapshot {
  /** Commit the data was read at. Null for the build-time bundle, which is pinned by deploy. */
  commit: string | null
  schemas: SchemaSet
  tables: Record<string, CsvTable>
  /** `project.json`, or `{}` when the data directory has none. */
  project: ProjectDoc
  source: SourceKind
  fetchedAt: number
}

/** Reads one text file. The three sources differ only in this function. */
type FileReader = (path: string) => Promise<string>

/**
 * idb-keyval reaches for `indexedDB` synchronously, so it throws before returning a promise when
 * storage is unavailable (private browsing, disabled site data, a test environment). A trailing
 * `.catch()` never attaches. The cache is an optimisation, so failing to reach it must degrade to
 * a network fetch rather than break the load.
 */
async function cacheGet(key: string): Promise<string | undefined> {
  try {
    return await idbGet<string>(key)
  } catch {
    return undefined
  }
}

async function cacheSet(key: string, value: string): Promise<void> {
  try {
    await idbSet(key, value)
  } catch {
    /* cache unavailable; the next read just refetches */
  }
}

/**
 * `project.json` is optional: a branch or data repo from before it existed still loads, reading as
 * an empty project, and the first edit from Settings creates the file. Only a 404 is forgiven — a
 * network failure or a malformed file still fails the load rather than silently reading as "no
 * target".
 */
async function readProject(read: FileReader, dataDir: string): Promise<ProjectDoc> {
  try {
    return parseProject(await read(projectPath(dataDir)))
  } catch (error) {
    if (error instanceof GitHubError && error.isNotFound) return {}
    throw error
  }
}

/**
 * Shared load sequence: manifest, then every table's schema, then every CSV and the project file.
 *
 * Schemas are fetched at runtime rather than bundled into the JS so that adding a field is a data
 * change, not a deploy.
 */
async function loadWith(read: FileReader, dataDir: string): Promise<{
  schemas: SchemaSet
  tables: Record<string, CsvTable>
  project: ProjectDoc
}> {
  const manifest = JSON.parse(await read(manifestPath(dataDir))) as { tables?: string[] }
  const names = manifest.tables ?? []

  const rawSchemas: Record<string, unknown> = {}
  await Promise.all(
    names.map(async (name) => {
      rawSchemas[name] = JSON.parse(await read(schemaPath(dataDir, name)))
    }),
  )
  const schemas = buildSchemaSet(manifest, rawSchemas)

  const tables: Record<string, CsvTable> = {}
  const [project] = await Promise.all([
    readProject(read, dataDir),
    ...schemas.order.map(async (name) => {
      const schema = schemas.tables[name]
      if (!schema) return
      tables[name] = parseCsv(await read(schema.file))
    }),
  ])

  return { schemas, tables, project }
}

/**
 * Authenticated read, pinned to a single commit.
 *
 * Pinning matters: without it, a sync landing midway through the load would give you `squares.csv`
 * from before and `yarns.csv` from after. Reading everything at one sha is snapshot isolation.
 *
 * It also makes caching trivial. Content at a given sha is immutable, so a cache hit needs no
 * revalidation at all — the sha *is* the version. The branch head is the opposite: the one answer
 * here that changes, and GitHub marks it cacheable for 60 seconds (`max-age=60`). Left to the
 * browser's HTTP cache, a read straight after a sync gets the head from *before* the push, and the
 * app draws the old data — then numbers the next new row from it, reusing an id the push just
 * took. So the head is always revalidated (`no-cache`, not `no-store`: an unchanged head comes back
 * as a 304, which GitHub does not count against the rate limit).
 *
 * `at` skips the head lookup altogether and reads that commit — for the reload after a sync, which
 * already knows the commit it just made and has no reason to ask which one is newest.
 */
export async function readFromApi(
  config: RepoConfig,
  token: string,
  signal?: AbortSignal,
  at?: string,
): Promise<Snapshot> {
  const commit =
    at ??
    (
      await apiJson<{ object: { sha: string } }>(
        `/repos/${config.owner}/${config.repo}/git/ref/heads/${config.branch}`,
        { token, signal, cache: 'no-cache' },
      )
    ).object.sha

  const read: FileReader = async (path) => {
    const cacheKey = `blob:${config.owner}/${config.repo}/${commit}/${path}`
    const cached = await cacheGet(cacheKey)
    if (typeof cached === 'string') return cached

    const text = await apiText(
      `/repos/${config.owner}/${config.repo}/contents/${encodeURI(path)}?ref=${commit}`,
      { token, accept: 'application/vnd.github.raw', signal },
    )
    void cacheSet(cacheKey, text)
    return text
  }

  const { schemas, tables, project } = await loadWith(read, config.dataDir)
  return { commit, schemas, tables, project, source: 'api', fetchedAt: Date.now() }
}

export interface DataBundle {
  generatedAt: string
  commit: string | null
  manifest: unknown
  schemas: Record<string, unknown>
  tables: Record<string, CsvTable>
  /** Optional so a bundle from a build before `project.json` existed still reads. */
  project?: ProjectDoc
}

/**
 * Anonymous read from the build-time snapshot on the same origin.
 *
 * The bundle is a materialised view: the pipeline flattens three CSVs plus four schema files into
 * one already-parsed JSON, so a cold visit is a single request instead of seven plus parsing.
 */
export async function readFromBundle(signal?: AbortSignal): Promise<Snapshot> {
  const url = `${import.meta.env.BASE_URL}data/bundle.json`
  const bundle = JSON.parse(await plainText(url, signal)) as DataBundle
  const schemas = buildSchemaSet(bundle.manifest, bundle.schemas)
  return {
    commit: bundle.commit,
    schemas,
    tables: bundle.tables,
    project: bundle.project ?? {},
    source: 'bundle',
    fetchedAt: Date.now(),
  }
}

/** Last-resort anonymous read straight from the repo. Only works while the repo is public. */
export async function readFromRaw(config: RepoConfig, signal?: AbortSignal): Promise<Snapshot> {
  const read: FileReader = (path) =>
    plainText(
      `https://raw.githubusercontent.com/${config.owner}/${config.repo}/${config.branch}/${encodeURI(path)}`,
      signal,
    )
  const { schemas, tables, project } = await loadWith(read, config.dataDir)
  return { commit: null, schemas, tables, project, source: 'raw', fetchedAt: Date.now() }
}

/**
 * Pick a read path: token wins, then the bundle, then raw.
 *
 * The fallback chain is what makes an unauthenticated visitor see a working read-only gallery, and
 * what keeps the app working on a dev server where no bundle has been generated yet. `at` pins the
 * API path to a known commit (see `readFromApi`); the anonymous paths cannot be pinned and ignore it.
 */
export async function readSnapshot(
  config: RepoConfig,
  token: string | null,
  signal?: AbortSignal,
  at?: string,
): Promise<Snapshot> {
  if (token) return readFromApi(config, token, signal, at)
  try {
    return await readFromBundle(signal)
  } catch {
    return await readFromRaw(config, signal)
  }
}
