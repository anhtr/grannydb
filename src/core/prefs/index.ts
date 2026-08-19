/** One table list's remembered search/filter/sort, keyed by table name in `Prefs.lists`. */
export interface ListPrefs {
  filters: Record<string, string>
  sortKey: string
  sortDir: 'asc' | 'desc'
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
   * Each table list's filters and sort, remembered across sessions on this device so reopening a
   * list does not lose how it was last narrowed down. Never synced to the repo — this is about how
   * *this device* likes to look at the data, not the data itself.
   */
  lists: Record<string, ListPrefs>
}

export const DEFAULT_PREFS: Prefs = { projectStartDate: '', lists: {} }

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
