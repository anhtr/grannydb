/**
 * A parsed CSV file.
 *
 * `columns` is the header row *exactly as it appeared in the file*. Keeping it is what makes the
 * writer round-trip safe: a column added by hand in a spreadsheet, which no schema knows about,
 * still gets written back in its original position.
 */
export interface CsvTable {
  columns: string[]
  rows: CsvRow[]
}

/** Every cell is a string. Typing happens in the schema layer, not here. */
export type CsvRow = Record<string, string>
