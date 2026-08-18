import { get as idbGet, set as idbSet } from 'idb-keyval'
import { parseCsv } from '../csv'
import type { CsvTable } from '../csv'
import { buildSchemaSet, manifestPath, schemaPath } from '../schema'
import type { SchemaSet } from '../schema'
import { apiJson, apiText, plainText } from './client'
import type { RepoConfig } from './config'

export type SourceKind = 'api' | 'bundle' | 'raw'

export interface Snapshot {
  /** Commit the data was read at. Null for the build-time bundle, which is pinned by deploy. */
  commit: string | null
  schemas: SchemaSet
  tables: Record<string, CsvTable>
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
 * Shared load sequence: manifest, then every table's schema, then every CSV.
 *
 * Schemas are fetched at runtime rather than bundled into the JS so that adding a field is a data
 * change, not a deploy.
 */
async function loadWith(read: FileReader, dataDir: string): Promise<{
  schemas: SchemaSet
  tables: Record<string, CsvTable>
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
  await Promise.all(
    schemas.order.map(async (name) => {
      const schema = schemas.tables[name]
      if (!schema) return
      tables[name] = parseCsv(await read(schema.file))
    }),
  )

  return { schemas, tables }
}

/**
 * Authenticated read, pinned to a single commit.
 *
 * Pinning matters: without it, a sync landing midway through the load would give you `squares.csv`
 * from before and `yarns.csv` from after. Reading everything at one sha is snapshot isolation.
 *
 * It also makes caching trivial. Content at a given sha is immutable, so a cache hit needs no
 * revalidation at all — the sha *is* the version.
 */
export async function readFromApi(
  config: RepoConfig,
  token: string,
  signal?: AbortSignal,
): Promise<Snapshot> {
  const ref = await apiJson<{ object: { sha: string } }>(
    `/repos/${config.owner}/${config.repo}/git/ref/heads/${config.branch}`,
    { token, signal },
  )
  const commit = ref.object.sha

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

  const { schemas, tables } = await loadWith(read, config.dataDir)
  return { commit, schemas, tables, source: 'api', fetchedAt: Date.now() }
}

export interface DataBundle {
  generatedAt: string
  commit: string | null
  manifest: unknown
  schemas: Record<string, unknown>
  tables: Record<string, CsvTable>
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
  const { schemas, tables } = await loadWith(read, config.dataDir)
  return { commit: null, schemas, tables, source: 'raw', fetchedAt: Date.now() }
}

/**
 * Pick a read path: token wins, then the bundle, then raw.
 *
 * The fallback chain is what makes an unauthenticated visitor see a working read-only gallery, and
 * what keeps the app working on a dev server where no bundle has been generated yet.
 */
export async function readSnapshot(
  config: RepoConfig,
  token: string | null,
  signal?: AbortSignal,
): Promise<Snapshot> {
  if (token) return readFromApi(config, token, signal)
  try {
    return await readFromBundle(signal)
  } catch {
    return await readFromRaw(config, signal)
  }
}
