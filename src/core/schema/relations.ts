import type { CsvRow, CsvTable } from '../csv'
import { effectiveValue } from './search'
import type { ResolveRef } from './search'
import { fieldByKey } from './types'
import type { TableSchema } from './types'
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

/** One set of colours that has been worked together, and the squares that use it. */
export interface YarnCombination {
  /** The square's main colour. Blank when the square has none on file. */
  main: string
  /** The square's other extra colours — never the yarn being asked about — deduplicated and sorted, so order in the cell does not split a combination in two. */
  extras: string[]
  squareIds: string[]
}

export interface YarnCombinations {
  /** Squares with this yarn as main colour, grouped by which extras went with it. */
  asMain: YarnCombination[]
  /** Squares with this yarn among the extras, grouped by main colour and the remaining extras. */
  asExtra: YarnCombination[]
}

/**
 * Which colour combinations a yarn has been used in, split by the role it played. Read time, not
 * materialised, for the same reason as `yarnUsageCounts` — a combination is nothing but the yarn
 * columns of the squares that already exist. Extras are treated as a set (`Y2;Y3` and `Y3;Y2` are
 * one combination) since the cell's order is just the order someone typed them in; main stays
 * distinct because main-versus-extra is the very split being shown. Most-used first.
 */
export function yarnCombinations(squares: CsvTable, yarnId: string): YarnCombinations {
  const asMain = new Map<string, YarnCombination>()
  const asExtra = new Map<string, YarnCombination>()
  const add = (groups: Map<string, YarnCombination>, main: string, extras: string[], squareId: string) => {
    const key = `${main}|${extras.join(';')}`
    const entry = groups.get(key) ?? { main, extras, squareIds: [] }
    entry.squareIds.push(squareId)
    groups.set(key, entry)
  }
  for (const row of squares.rows) {
    const main = row.main_yarn ?? ''
    const extras = [...new Set(splitList(row.extra_yarns ?? ''))]
    const others = extras.filter((id) => id !== yarnId).sort()
    if (main === yarnId) add(asMain, main, others, row.id ?? '')
    // A yarn listed as both main and extra on one square is counted under main only; the extra cell
    // is then a typo, not a second role.
    else if (extras.includes(yarnId)) add(asExtra, main, others, row.id ?? '')
  }
  const ordered = (groups: Map<string, YarnCombination>) =>
    [...groups.values()].sort(
      (a, b) =>
        b.squareIds.length - a.squareIds.length ||
        a.main.localeCompare(b.main) ||
        a.extras.join(';').localeCompare(b.extras.join(';')),
    )
  return { asMain: ordered(asMain), asExtra: ordered(asExtra) }
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

export interface ConstructionCount {
  construction: string
  count: number
}

export interface ColourConstructionImbalance {
  yarnId: string
  /** How many more finished squares of this colour each short construction would need, to match the fullest one. */
  deficits: ConstructionCount[]
}

export interface SquareConstructionInsights {
  /** Finished squares (done or blocked), tallied by effective construction type, busiest first. */
  byConstructionFinished: ConstructionCount[]
  /** Colours where finished squares favour one construction over another. */
  imbalancedColours: ColourConstructionImbalance[]
  /** Every-status squares missing a main colour, or a design. */
  missingMainYarn: CsvRow[]
  missingDesign: CsvRow[]
}

/**
 * Construction-type tallies and gaps computed from `squares` at read time, same "read time, not
 * materialised" rule as `yarnUsageCounts` above and for the same reason (ADR 0015) — a square's
 * status or design changes far more often than a summary column would keep up with. One aggregation
 * pass backs both the squares list's progress header (just the counts) and the stats page (the full
 * breakdowns), instead of each screen re-walking `squares.rows` its own way.
 */
export function squareConstructionInsights(
  schema: TableSchema,
  squares: CsvTable,
  resolve: ResolveRef,
): SquareConstructionInsights {
  // A square's own `construction_type` cell is usually blank and means "same as its design" (see
  // ADR 0016), so every tally below reads the *effective* value, not the raw column.
  const constructionField = fieldByKey(schema, 'construction_type')
  const constructionOf = (row: CsvRow): string =>
    constructionField ? effectiveValue(schema, constructionField, row, resolve).value : ''

  const byConstructionFinished = new Map<string, number>()
  // Finished squares' main colour, tallied per construction type, so a colour's counts can be
  // compared across constructions to spot ones that are lopsided.
  const byYarnConstructionFinished = new Map<string, Map<string, number>>()
  const missingMainYarn: CsvRow[] = []
  const missingDesign: CsvRow[] = []

  for (const row of squares.rows) {
    if (!row.main_yarn) missingMainYarn.push(row)
    if (!row.design_id) missingDesign.push(row)
    if (row.status !== 'done' && row.status !== 'blocked') continue
    const construction = constructionOf(row)
    if (!construction) continue
    byConstructionFinished.set(construction, (byConstructionFinished.get(construction) ?? 0) + 1)
    if (row.main_yarn) {
      const byConstruction = byYarnConstructionFinished.get(row.main_yarn) ?? new Map<string, number>()
      byConstruction.set(construction, (byConstruction.get(construction) ?? 0) + 1)
      byYarnConstructionFinished.set(row.main_yarn, byConstruction)
    }
  }

  // A colour is "imbalanced" when it has more finished squares in one construction than another —
  // the gap is a deficit relative to whichever construction that colour is furthest along in. Only
  // compares constructions the schema actually defines, not just ones seen in the data, so a colour
  // with zero squares of a construction still shows the full gap rather than being skipped.
  const constructionTypes = constructionField?.options ?? []
  const imbalancedColours: ColourConstructionImbalance[] = []
  for (const [yarnId, counts] of byYarnConstructionFinished) {
    const max = Math.max(...constructionTypes.map((c) => counts.get(c) ?? 0))
    const deficits = constructionTypes
      .map((construction) => ({ construction, count: max - (counts.get(construction) ?? 0) }))
      .filter((d) => d.count > 0)
    if (deficits.length > 0) imbalancedColours.push({ yarnId, deficits })
  }

  return {
    byConstructionFinished: [...byConstructionFinished.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([construction, count]) => ({ construction, count })),
    imbalancedColours,
    missingMainYarn,
    missingDesign,
  }
}
