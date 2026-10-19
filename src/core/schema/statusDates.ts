import type { CsvRow } from '../csv/types'
import { fieldByKey } from './types'
import type { StatusDatesDef, TableSchema } from './types'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

interface Step {
  status: string
  field: string
}

/**
 * The statuses that carry a date, in workflow order — the order of the status field's `options`,
 * not of the `dates` object, so the schema's one list of statuses stays the single source of order.
 */
function steps(schema: TableSchema, def: StatusDatesDef): Step[] {
  const options = fieldByKey(schema, def.field)?.options ?? []
  return options.filter((status) => def.dates[status] !== undefined).map((status) => ({ status, field: def.dates[status] }))
}

function label(schema: TableSchema, key: string): string {
  return fieldByKey(schema, key)?.label ?? key
}

/** The date the row reached its current status, or empty if it has none (or no status dates at all). */
export function statusDate(schema: TableSchema, row: CsvRow): string {
  const def = schema.statusDates
  if (!def) return ''
  const field = def.dates[row[def.field] ?? '']
  return field ? (row[field] ?? '') : ''
}

/**
 * The cross-field rules a `statusDates` table keeps, as per-field messages:
 *
 * - the row's **current** status must have its date — which is also what guarantees every row has at
 *   least one date. Earlier statuses' dates are optional: a square can skip "in progress" entirely;
 * - no status *after* the current one may have a date — a done square with a blocked date is either a
 *   typo or a status that was moved back without clearing it;
 * - the dates that are present run in workflow order (equal is fine: done and blocked the same day).
 *
 * A row whose status is blank or carries no date still needs one date of some kind. Malformed dates
 * are skipped here; `validateValue` already reports them, and comparing them would only add noise.
 */
export function statusDateIssues(schema: TableSchema, row: CsvRow): { field: string; message: string }[] {
  const def = schema.statusDates
  if (!def) return []
  const issues: { field: string; message: string }[] = []
  const all = steps(schema, def)
  const value = (field: string) => (row[field] ?? '').trim()
  const status = (row[def.field] ?? '').trim()
  const current = all.findIndex((s) => s.status === status)

  if (current === -1) {
    if (all.every((s) => value(s.field) === '')) {
      issues.push({ field: def.field, message: `Needs at least one of: ${all.map((s) => label(schema, s.field)).join(', ')}` })
    }
  } else {
    const { field } = all[current]
    if (value(field) === '') issues.push({ field, message: `${label(schema, field)} is required while the status is ${status}` })
    for (const later of all.slice(current + 1)) {
      if (value(later.field) !== '') {
        issues.push({ field: later.field, message: `${label(schema, later.field)} is set but the status is only ${status}` })
      }
    }
  }

  let previous: Step | null = null
  for (const step of all) {
    const v = value(step.field)
    if (!DATE_RE.test(v)) continue
    if (previous && v < value(previous.field)) {
      issues.push({
        field: step.field,
        message: `${label(schema, step.field)} is before ${label(schema, previous.field)} (${value(previous.field)})`,
      })
    }
    previous = step
  }
  return issues
}

/**
 * Fill in the current status's date — and any statuses it `implies` — with `today` where blank.
 * Used for a brand-new row's defaults, so a square entered straight as blocked is done and blocked
 * today.
 */
export function fillStatusDates(schema: TableSchema, row: CsvRow, today: string): CsvRow {
  const def = schema.statusDates
  if (!def) return row
  const status = row[def.field] ?? ''
  const next = { ...row }
  for (const s of [status, ...(def.implies?.[status] ?? [])]) {
    const field = def.dates[s]
    if (field && (next[field] ?? '') === '') next[field] = today
  }
  return next
}

/**
 * A form changing a row's status: the new status's date (and anything it implies) is filled with
 * today if blank, and the dates of every status *after* the new one are cleared — moving a square
 * back from blocked to done means it isn't blocked any more, and a leftover date would fail
 * `statusDateIssues` anyway. Dates already set are left alone, so re-picking a status never
 * overwrites a date someone typed.
 */
export function changeStatus(schema: TableSchema, row: CsvRow, status: string, today: string): CsvRow {
  const def = schema.statusDates
  if (!def) return row
  const next = fillStatusDates(schema, { ...row, [def.field]: status }, today)
  const all = steps(schema, def)
  const at = all.findIndex((s) => s.status === status)
  if (at !== -1) for (const later of all.slice(at + 1)) next[later.field] = ''
  return next
}
