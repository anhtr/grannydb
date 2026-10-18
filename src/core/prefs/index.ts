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
 * or who can write it (that's `github/auth.ts`) — just how the app itself should behave. Facts about
 * the project (start date, target) are data, in `project.json` (see `core/project`), not here.
 */
export interface Prefs {
  /**
   * Each table list's filters and sort, remembered across sessions on this device so reopening a
   * list does not lose how it was last narrowed down. Never synced to the repo — this is about how
   * *this device* likes to look at the data, not the data itself.
   */
  lists: Record<string, ListPrefs>
}

export const DEFAULT_PREFS: Prefs = { lists: {} }

const STORAGE_KEY = 'grannydb.prefs'

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_PREFS
    const parsed = JSON.parse(raw) as Partial<Prefs>
    // Picks known keys rather than spreading, so the retired `projectStartDate`/`squaresGoal` (now
    // in `project.json`) fall away on the next save instead of lingering in storage forever.
    return { lists: parsed.lists ?? DEFAULT_PREFS.lists }
  } catch {
    return DEFAULT_PREFS
  }
}

export function savePrefs(prefs: Prefs): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
}
