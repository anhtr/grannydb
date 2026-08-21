import type { TableSchema } from '../schema'

/** One sort key and direction, and its priority in a list's `sorts` array (earlier wins ties). */
export interface SortRule {
  key: string
  dir: 'asc' | 'desc'
}

/** One table list's remembered search/filter/sort, keyed by table name in `Prefs.lists`. Each
 * filter's value is a set of selected options (OR'd together) rather than one — see `FilterPanel`
 * in `ui/RecordList.tsx` for which filters allow more than one selection. */
export interface ListPrefs {
  filters: Record<string, string[]>
  /** Applied in order — later rules only break ties left by earlier ones. */
  sorts: SortRule[]
}

/**
 * Device-local app preferences that are not about where the data lives (that's `github/config.ts`)
 * or who can write it (that's `github/auth.ts`) — just how the app itself should behave.
 */
export interface Prefs {
  /**
   * `YYYY-MM-DD`, or empty if unset. Lets pace calculations on the stats screen size their window
   * to how long the project has actually been running, instead of assuming a fixed number of weeks
   * has always elapsed.
   */
  projectStartDate: string
  /**
   * Overrides the squares table schema's `goal` (the "target 400" baked into `squares.json`), or
   * `null` to use the schema's own value. A device-local override rather than a schema edit because
   * changing it should not require touching `data/schema/squares.json` (and does not need to be
   * consistent across devices the way the underlying square data does).
   */
  squaresGoal: number | null
  /**
   * Each table list's filters and sort, remembered across sessions on this device so reopening a
   * list does not lose how it was last narrowed down. Never synced to the repo — this is about how
   * *this device* likes to look at the data, not the data itself.
   */
  lists: Record<string, ListPrefs>
}

export const DEFAULT_PREFS: Prefs = { projectStartDate: '', squaresGoal: null, lists: {} }

const STORAGE_KEY = 'grannydb.prefs'

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_PREFS
    const parsed = JSON.parse(raw) as Partial<Prefs>
    return { ...DEFAULT_PREFS, ...parsed }
  } catch {
    return DEFAULT_PREFS
  }
}

export function savePrefs(prefs: Prefs): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
}

/** The squares goal to actually use: the device's override if it set one, else the schema's own. */
export function effectiveGoal(schema: TableSchema, prefs: Prefs): number {
  return prefs.squaresGoal ?? schema.goal ?? 0
}
