/**
 * The data pipeline.
 *
 * Reads the CSVs and schema files, validates them, and emits a single JSON bundle for the published
 * site to read. It runs at build time, which gives two things at once:
 *
 *   1. A materialised view. Anonymous visitors fetch one already-parsed file instead of seven raw
 *      ones plus a CSV parse.
 *   2. A data contract test. CSV is a schema-on-read format with no way to reject a bad row at
 *      write time, so this is where schema-on-write enforcement happens. A hand-edit that breaks
 *      referential integrity or misspells a status fails the build before it can reach a phone.
 *
 * Deliberately imports the *same* modules the browser uses, so the rules cannot drift between what
 * CI enforces and what the app believes.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsv } from '../src/core/csv/parse'
import type { CsvTable } from '../src/core/csv/types'
import { buildSchemaSet } from '../src/core/schema/load'
import { validateDataset } from '../src/core/schema/validate'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = 'data'

export interface DataBundle {
  generatedAt: string
  commit: string | null
  manifest: unknown
  schemas: Record<string, unknown>
  tables: Record<string, CsvTable>
}

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8')
}

export function buildBundle(): { bundle: DataBundle; issueCount: number } {
  const manifest = JSON.parse(readRepoFile(`${DATA_DIR}/schema/tables.json`)) as { tables?: string[] }
  const names = manifest.tables ?? []

  const schemas: Record<string, unknown> = {}
  for (const name of names) {
    schemas[name] = JSON.parse(readRepoFile(`${DATA_DIR}/schema/${name}.json`))
  }

  const schemaSet = buildSchemaSet(manifest, schemas)

  const tables: Record<string, CsvTable> = {}
  for (const name of schemaSet.order) {
    const schema = schemaSet.tables[name]
    if (!schema) continue
    tables[name] = parseCsv(readRepoFile(schema.file))
  }

  const issues = validateDataset(schemaSet, tables)
  for (const issue of issues) {
    const where = issue.field ? `${issue.table}.${issue.field}` : issue.table
    console.error(`  ${where} [${issue.rowId}]: ${issue.message}`)
  }

  const bundle: DataBundle = {
    generatedAt: new Date().toISOString(),
    // GitHub Actions exposes the commit being built. Locally there is none, which is fine.
    commit: process.env.GITHUB_SHA ?? null,
    manifest,
    schemas,
    tables,
  }

  return { bundle, issueCount: issues.length }
}

export function writeBundle(outDir: string): DataBundle {
  const { bundle, issueCount } = buildBundle()
  if (issueCount > 0) {
    throw new Error(`Data validation failed with ${issueCount} issue(s). See above.`)
  }
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'bundle.json'), JSON.stringify(bundle), 'utf8')

  const rowCount = Object.values(bundle.tables).reduce((n, t) => n + t.rows.length, 0)
  console.log(
    `data bundle: ${Object.keys(bundle.tables).length} tables, ${rowCount} rows -> ${join(outDir, 'bundle.json')}`,
  )
  return bundle
}

// `tsx scripts/build-data.ts --check` validates without writing, for a fast CI gate.
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (invokedDirectly) {
  const checkOnly = process.argv.includes('--check')
  try {
    if (checkOnly) {
      const { bundle, issueCount } = buildBundle()
      if (issueCount > 0) {
        console.error(`\nData validation failed with ${issueCount} issue(s).`)
        process.exit(1)
      }
      const rowCount = Object.values(bundle.tables).reduce((n, t) => n + t.rows.length, 0)
      console.log(`data ok: ${Object.keys(bundle.tables).length} tables, ${rowCount} rows`)
    } else {
      writeBundle(join(repoRoot, 'public', 'data'))
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
