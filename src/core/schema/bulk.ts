import type { CsvRow } from '../csv/types'
import { changeStatus, statusDateIssues } from './statusDates'
import { fieldByKey } from './types'
import type { FieldDef, TableSchema } from './types'
import { validateValue } from './validate'

/** One row's share of a bulk edit: only the fields that would actually change. */
export interface BulkWrite {
  id: string
  values: CsvRow
}

export interface BulkSkip {
  id: string
  reason: string
}

/**
 * What setting one field to one value on many rows would do, worked out before anything is queued.
 *
 * `error` is a problem with the value itself, the same for every row, so nothing is planned at all.
 * Otherwise each row lands in exactly one of the three lists.
 */
export interface BulkEditPlan {
  error: string | null
  writes: BulkWrite[]
  /** Rows that already hold the value: nothing to write, and nothing wrong. */
  unchanged: string[]
  /** Rows the edit would leave breaking a rule, with the rule. They are not written. */
  skipped: BulkSkip[]
}

/** Every field but the id: an id is assigned once and is what the edit is addressed by. */
export function bulkEditableFields(schema: TableSchema): FieldDef[] {
  return schema.fields.filter((f) => f.type !== 'id' && f.key !== schema.idField)
}

/**
 * Whether setting `fieldKey` to `value` also writes a date - true for a status that carries one, or
 * that implies a status that does (blocked implies done). That is when the edit needs to know *which
 * day*, and when the day is worth asking for: blocking is done to a batch on one evening and often
 * entered a few days later.
 */
export function bulkEditNeedsDate(schema: TableSchema, fieldKey: string, value: string): boolean {
  const def = schema.statusDates
  if (!def || def.field !== fieldKey) return false
  return [value, ...(def.implies?.[value] ?? [])].some((status) => def.dates[status] !== undefined)
}

const DATE_FIELD: FieldDef = { key: 'date', label: 'Date', type: 'date' }

/**
 * Plan a bulk edit as a set of **field-level** writes - one per row, holding only what differs - so
 * that queued and replayed they merge with another device's edits to the same rows exactly as edits
 * made one at a time would (invariant 3). A pure function of its arguments: the screen shows the
 * plan as a preview and then queues the very same object.
 *
 * It keeps the rules a form keeps for one row. The value is validated once, as the form would
 * validate it. A change of status goes through `changeStatus`, so the status's date is filled with
 * `options.date` where blank (never overwriting a date already there) and later statuses' dates are
 * cleared. And a row the edit would leave failing `statusDateIssues` - blocked on a day before it
 * was finished - is skipped with the reason, as the form would refuse to save it, rather than
 * written and left for the data check to reject at sync.
 *
 * Rules are only checked on rows the edit touches them on: a row with an old status-date problem can
 * still have its notes set in bulk, since that neither causes the problem nor hides it.
 */
export function planBulkEdit(
  schema: TableSchema,
  rows: readonly CsvRow[],
  fieldKey: string,
  value: string,
  options: { date?: string; refIds?: ReadonlySet<string> } = {},
): BulkEditPlan {
  const plan: BulkEditPlan = { error: null, writes: [], unchanged: [], skipped: [] }
  const field = fieldByKey(schema, fieldKey)
  if (!field || !bulkEditableFields(schema).includes(field)) {
    return { ...plan, error: `${field?.label ?? fieldKey} cannot be changed in bulk` }
  }
  const invalid = validateValue(field, value, options.refIds)
  if (invalid) return { ...plan, error: invalid }

  const def = schema.statusDates
  const isStatus = def !== undefined && def.field === fieldKey
  const date = (options.date ?? '').trim()
  if (bulkEditNeedsDate(schema, fieldKey, value)) {
    const badDate = date === '' ? 'Date is required' : validateValue(DATE_FIELD, date)
    if (badDate) return { ...plan, error: badDate }
  }

  const statusKeys = def ? [def.field, ...Object.values(def.dates)] : []
  const touchesStatusRules = statusKeys.includes(fieldKey)
  const keys = isStatus ? statusKeys : [fieldKey]

  for (const row of rows) {
    const id = row[schema.idField] ?? ''
    const next = isStatus ? changeStatus(schema, row, value, date) : { ...row, [fieldKey]: value }
    const values: CsvRow = {}
    for (const key of keys) {
      if ((next[key] ?? '') !== (row[key] ?? '')) values[key] = next[key] ?? ''
    }
    if (Object.keys(values).length === 0) {
      plan.unchanged.push(id)
      continue
    }
    const issue = touchesStatusRules ? statusDateIssues(schema, next)[0] : undefined
    if (issue) plan.skipped.push({ id, reason: issue.message })
    else plan.writes.push({ id, values })
  }
  return plan
}
