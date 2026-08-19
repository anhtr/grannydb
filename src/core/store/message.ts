import type { SchemaSet } from '../schema'
import type { Change } from './queue'

function plural(count: number, singular: string): string {
  return count === 1 ? `1 ${singular}` : `${count} ${singular}s`
}

function fieldLabel(schemas: SchemaSet, table: string, key: string): string {
  return schemas.tables[table]?.fields.find((f) => f.key === key)?.label ?? key
}

/** How a stored value reads in the body — blank is a real value here (clearing a field), not nothing. */
function formatValue(value: string): string {
  return value === '' ? '(blank)' : value
}

/**
 * One change, expanded to the fields it actually touched, e.g.
 *   "save squares/S010 — Status: done, Main colour: Y004"
 *
 * `values` is already the diff (`AppStore.save` only queues fields whose value changed), so this
 * is exactly what changed, not the row's full contents. `id` is dropped from the list since it is
 * already the thing the row is addressed by in the line itself.
 */
function describeChange(change: Change, schemas: SchemaSet): string {
  if (change.op === 'delete') return `- delete ${change.table}/${change.rowId}`

  const schema = schemas.tables[change.table]
  const fields = Object.entries(change.values ?? {})
    .filter(([key]) => key !== (schema?.idField ?? 'id'))
    .map(([key, value]) => `${fieldLabel(schemas, change.table, key)}: ${formatValue(value)}`)

  const detail = fields.length > 0 ? ` — ${fields.join(', ')}` : ''
  return `- save ${change.table}/${change.rowId}${detail}`
}

/**
 * A commit message describing the batch, e.g.
 *   "Update 3 squares, add 1 yarn"
 *
 * Written for someone scrolling the repo history later, not for the app. The subject line is what
 * `git log --oneline` shows; the body spells out exactly which fields changed and what they became,
 * so `git log` alone (no diff needed) answers "what actually happened to S010" months later.
 */
export function commitMessage(changes: readonly Change[], schemas: SchemaSet): string {
  const parts: string[] = []

  for (const table of [...new Set(changes.map((c) => c.table))]) {
    const schema = schemas.tables[table]
    const noun = (schema?.labelSingular ?? table).toLowerCase()
    const forTable = changes.filter((c) => c.table === table)
    const deletes = forTable.filter((c) => c.op === 'delete').length
    const upserts = forTable.length - deletes
    if (upserts > 0) parts.push(`update ${plural(upserts, noun)}`)
    if (deletes > 0) parts.push(`remove ${plural(deletes, noun)}`)
  }

  const summary = parts.length > 0 ? parts.join(', ') : 'sync data'
  const subject = summary.charAt(0).toUpperCase() + summary.slice(1)

  const body = changes
    .slice()
    .sort((a, b) => a.ts - b.ts)
    .map((c) => describeChange(c, schemas))
    .join('\n')

  return `${subject}\n\n${body}\n`
}
