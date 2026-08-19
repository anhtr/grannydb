import type { CsvRow, CsvTable } from '../csv'
import { parseBool, splitList } from './validate'

/**
 * Cross-table counts and derived flags, computed from `squares` at read time rather than stored on
 * `yarns`/`designs`. Same "read time, not materialised" rule `derivedFilterValue` follows for the
 * same reason (see ADR 0015): a square's yarn or design reference changes far more often than
 * anything would remember to keep a count column in sync with.
 */

export interface YarnUsage {
  /** Squares that use this yarn as their main colour. */
  main: number
  /** Squares that use this yarn as one of their extra colours. */
  extra: number
}

/** How many squares use each yarn as main colour and as an extra colour. */
export function yarnUsageCounts(squares: CsvTable): Map<string, YarnUsage> {
  const counts = new Map<string, YarnUsage>()
  const bump = (id: string, key: keyof YarnUsage) => {
    if (!id) return
    const entry = counts.get(id) ?? { main: 0, extra: 0 }
    entry[key] += 1
    counts.set(id, entry)
  }
  for (const row of squares.rows) {
    bump(row.main_yarn ?? '', 'main')
    for (const id of splitList(row.extra_yarns ?? '')) bump(id, 'extra')
  }
  return counts
}

/**
 * A yarn is "active" once it is still in play here: some skein of it (partial or not) is on hand, or
 * some square already uses it. Not a schema field — whether a yarn counts depends on both its own row
 * and every square's, so it can only be answered at read time. The point is to let old stash that has
 * been fully worked through, and nothing on file uses, drop out of a filtered view without deleting
 * the yarn's own history.
 */
export function isYarnActive(yarnRow: CsvRow, usage: YarnUsage | undefined): boolean {
  const skeins = Number(yarnRow.skeins) || 0
  if (skeins > 0 || parseBool(yarnRow.partial_skein ?? '')) return true
  return Boolean(usage && usage.main + usage.extra > 0)
}

/** How many squares cite each design. */
export function designSquareCounts(squares: CsvTable): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of squares.rows) {
    const id = row.design_id ?? ''
    if (!id) continue
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}
