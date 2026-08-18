import type { SchemaSet } from '../schema'
import type { Change } from './queue'

function plural(count: number, singular: string): string {
  return count === 1 ? `1 ${singular}` : `${count} ${singular}s`
}

/**
 * A commit message describing the batch, e.g.
 *   "Update 3 squares, add 1 yarn"
 *
 * Written for someone scrolling the repo history later, not for the app. The per-row detail goes
 * in the body so `git log --oneline` stays readable.
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
    .map((c) => `- ${c.op === 'delete' ? 'delete' : 'save'} ${c.table}/${c.rowId}`)
    .join('\n')

  return `${subject}\n\n${body}\n`
}
