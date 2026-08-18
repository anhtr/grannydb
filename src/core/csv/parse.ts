import Papa from 'papaparse'
import type { CsvTable, CsvRow } from './types'

export class CsvParseError extends Error {
  constructor(
    message: string,
    readonly row?: number,
  ) {
    super(message)
    this.name = 'CsvParseError'
  }
}

/**
 * Parse CSV text into a table, preserving the header order.
 *
 * Deliberately uses a real parser rather than `split(',')`: notes fields contain commas, quotes and
 * newlines, and getting that wrong silently corrupts data.
 */
export function parseCsv(text: string): CsvTable {
  const result = Papa.parse<CsvRow>(text, {
    header: true,
    // Pinned, never auto-detected. Auto-detection guesses from character frequency, and
    // `extra_yarns` is a semicolon-delimited list -- a file with enough multi-colour squares can
    // look more semicolon-delimited than comma-delimited and get parsed completely wrong. It also
    // fails outright on a single-column file, which has no delimiter to detect.
    delimiter: ',',
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  })

  // Papa reports recoverable problems (ragged rows, stray quotes) rather than throwing. For a file
  // that is the source of truth we would rather fail loudly than import half a row.
  const fatal = result.errors.filter((e) => e.code !== 'TooFewFields' && e.code !== 'TooManyFields')
  if (fatal.length > 0) {
    const first = fatal[0]
    throw new CsvParseError(`${first.message} (row ${first.row ?? '?'})`, first.row)
  }

  const columns = (result.meta.fields ?? []).filter((c) => c.length > 0)

  // Normalise every row to the full column set so downstream code never sees `undefined`.
  const rows = result.data.map((raw) => {
    const row: CsvRow = {}
    for (const col of columns) row[col] = raw[col] ?? ''
    // Anything Papa put in `__parsed_extra` came from a ragged row; keep it out of the model but
    // do not silently drop the row itself.
    return row
  })

  return { columns, rows }
}
