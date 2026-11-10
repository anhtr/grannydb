import type { CsvTable } from '../csv'
import { findRow } from '../csv'
import { fieldByKey, refDisplayLabel, splitList, titleFor } from '../schema'
import type { FieldDef, ResolveRef, SchemaSet } from '../schema'
import { projectKeyLabel } from '../project'
import type { ProjectDoc } from '../project'
import type { Change } from './queue'

/**
 * A queued change in words, for the Pending changes screen.
 *
 * The queue stores CSV column keys and raw cell values, which is right for replaying and wrong for
 * reading: `design_id: D07` tells you less than "Design: Sunburst → Granny stripe". This turns one
 * operation into labelled before-and-after lines - a **diff view over the operation log**. The
 * "before" is the base snapshot, not the previous operation, because edits to one record collapse
 * into a single pending change (`appendChange`), so the snapshot is exactly what that change will
 * be replayed over if nobody else has touched the row.
 */

export interface ChangeLine {
  label: string
  /** Display text for the value in the repo as last read. Empty means blank. */
  from: string
  /** Display text for the value this change sets. Empty means blank. */
  to: string
}

export interface ChangeSummary {
  kind: 'new' | 'edit' | 'delete' | 'project'
  /** The record's id, or "Project settings". */
  title: string
  /** The record's own title when it says more than the id does (a yarn's name), else empty. */
  name: string
  lines: ChangeLine[]
  link?: string
}

export interface ChangeBase {
  schemas: SchemaSet
  tables: Record<string, CsvTable>
  project: ProjectDoc
}

/** A cell as the screens show it: a `ref` by the title of what it points at, a `reflist` likewise. */
function displayValue(field: FieldDef | undefined, value: string, resolve: ResolveRef): string {
  if (!field || value === '') return value
  if (field.type === 'reflist' && field.refTable) {
    return splitList(value, field.separator ?? ';')
      .map((id) => refDisplayLabel({ type: 'ref', refTable: field.refTable }, id, resolve))
      .join(', ')
  }
  return refDisplayLabel(field, value, resolve)
}

/** `unknown` because the base document is whatever was in the file, hand edits included. */
function projectValueText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return typeof value === 'string' || typeof value === 'number' ? String(value) : JSON.stringify(value)
}

/**
 * `resolve` should look at the *merged* data, so a reference to a record that is itself still in
 * the queue reads by its name; `base` is the snapshot, which is where the old values live.
 */
export function describeChange(change: Change, base: ChangeBase, resolve: ResolveRef): ChangeSummary {
  if (change.op === 'set') {
    return {
      kind: 'project',
      title: 'Project settings',
      name: '',
      lines: Object.entries(change.values).map(([key, value]) => ({
        label: projectKeyLabel(key),
        from: projectValueText(base.project[key]),
        to: projectValueText(value),
      })),
      link: '/settings',
    }
  }

  const schema = base.schemas.tables[change.table]
  const table = base.tables[change.table]
  const baseRow = schema && table ? findRow(table, schema.idField, change.rowId) : undefined
  const baseName = schema && baseRow ? titleFor(schema, baseRow) : ''

  if (change.op === 'delete') {
    return { kind: 'delete', title: change.rowId, name: baseName === change.rowId ? '' : baseName, lines: [] }
  }

  // The flag where there is one; a change queued before it existed falls back to asking the base.
  const isNew = change.create ?? (schema && table ? !baseRow : false)
  const idField = schema?.idField ?? 'id'
  const lines: ChangeLine[] = []
  for (const [key, value] of Object.entries(change.values ?? {})) {
    if (key === idField) continue
    // A new record lists what it has, not every column it leaves empty.
    if (isNew && value === '') continue
    const field = schema ? fieldByKey(schema, key) : undefined
    lines.push({
      label: field?.label ?? key,
      from: isNew ? '' : displayValue(field, baseRow?.[key] ?? '', resolve),
      to: displayValue(field, value, resolve),
    })
  }

  const merged = resolve(change.table)?.rows.get(change.rowId)
  const name = schema && merged ? titleFor(schema, merged) : baseName
  return {
    kind: isNew ? 'new' : 'edit',
    title: change.rowId,
    name: name === change.rowId ? '' : name,
    lines,
    link: `/${change.table}/${change.rowId}`,
  }
}
