import type { CsvTable } from './types'

/**
 * Minimal, deterministic quoting: quote only when the value would otherwise be ambiguous.
 *
 * Determinism matters more than prettiness here. Every write goes through git, so a writer that
 * quotes inconsistently would turn a one-square edit into a 400-line diff.
 */
function quote(value: string): string {
  if (value === '') return ''
  const needs =
    value.includes(',') ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r') ||
    value !== value.trim()
  if (!needs) return value
  return `"${value.replaceAll('"', '""')}"`
}

/**
 * Natural-order comparison so `S9` sorts before `S10` even if someone hand-edits an unpadded id.
 */
export function compareIds(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

export interface SerializeOptions {
  /** Column key to sort rows by. Omit to preserve the existing row order. */
  sortBy?: string
}

/**
 * Serialize a table back to CSV.
 *
 * Guarantees, all of which exist to keep git diffs small and hand-edits safe:
 *   - columns are written in `table.columns` order, unknown ones included
 *   - rows are sorted by id, so a new square lands in a predictable place
 *   - LF endings and a single trailing newline
 */
export function serializeCsv(table: CsvTable, options: SerializeOptions = {}): string {
  const { columns } = table
  const rows = options.sortBy
    ? [...table.rows].sort((a, b) => compareIds(a[options.sortBy!] ?? '', b[options.sortBy!] ?? ''))
    : table.rows

  const lines: string[] = [columns.map(quote).join(',')]
  for (const row of rows) {
    lines.push(columns.map((col) => quote(row[col] ?? '')).join(','))
  }
  return lines.join('\n') + '\n'
}
