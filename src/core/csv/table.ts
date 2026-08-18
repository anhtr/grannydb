import type { CsvRow, CsvTable } from './types'
import { compareIds } from './serialize'

/** Add any missing columns to the end, leaving existing order untouched. */
export function ensureColumns(table: CsvTable, keys: readonly string[]): CsvTable {
  const missing = keys.filter((k) => !table.columns.includes(k))
  if (missing.length === 0) return table
  const columns = [...table.columns, ...missing]
  return {
    columns,
    rows: table.rows.map((row) => {
      const next: CsvRow = { ...row }
      for (const k of missing) next[k] ??= ''
      return next
    }),
  }
}

export function findRow(table: CsvTable, idField: string, id: string): CsvRow | undefined {
  return table.rows.find((r) => r[idField] === id)
}

/**
 * Insert or update a row by id, merging only the supplied keys.
 *
 * Partial merge is the whole point: an edit that touched `notes` must not overwrite a `position`
 * that was set on another device between the two syncs.
 */
export function applyUpsert(
  table: CsvTable,
  idField: string,
  id: string,
  values: Readonly<CsvRow>,
): CsvTable {
  const withCols = ensureColumns(table, [idField, ...Object.keys(values)])
  const index = withCols.rows.findIndex((r) => r[idField] === id)

  if (index === -1) {
    const row: CsvRow = {}
    for (const col of withCols.columns) row[col] = ''
    row[idField] = id
    Object.assign(row, values)
    return { columns: withCols.columns, rows: [...withCols.rows, row] }
  }

  const rows = withCols.rows.slice()
  rows[index] = { ...rows[index], ...values, [idField]: id }
  return { columns: withCols.columns, rows }
}

export function applyDelete(table: CsvTable, idField: string, id: string): CsvTable {
  return { columns: table.columns, rows: table.rows.filter((r) => r[idField] !== id) }
}

/**
 * Next free id in a `PREFIX + zero-padded number` sequence, e.g. S001 -> S002.
 *
 * Scans every existing id rather than counting rows, so deleting S003 does not cause the next
 * square to reuse its id. Ids are permanent labels; reuse would make old notes point at the
 * wrong square.
 */
export function nextId(
  table: CsvTable,
  idField: string,
  prefix: string,
  padding: number,
): string {
  let max = 0
  for (const row of table.rows) {
    const id = row[idField] ?? ''
    if (!id.startsWith(prefix)) continue
    const n = Number.parseInt(id.slice(prefix.length), 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return prefix + String(max + 1).padStart(padding, '0')
}

/** Stable id-ordered copy, used for display. */
export function sortedRows(table: CsvTable, idField: string): CsvRow[] {
  return [...table.rows].sort((a, b) => compareIds(a[idField] ?? '', b[idField] ?? ''))
}
