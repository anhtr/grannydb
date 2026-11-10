/**
 * The app's version, read from the changelog rather than kept as a second number somewhere.
 *
 * `docs/CHANGELOG.md` already gets a new `vX.Y.Z` heading with every change that ships, so its
 * newest heading *is* the version; a field in `package.json` would be a copy that someone has to
 * remember to bump (and it has said `0.1.0` since the first build). See ADR 0043 for why the commit
 * sha is not used instead.
 */
export interface Release {
  /** `0.1.61`, without the `v`. */
  version: string
  /** The entry's date, `YYYY-MM-DD`. */
  date: string
}

/**
 * The newest entry's version and date, or null when no heading has the expected shape. Entries are
 * newest first, so that is the first match. The separator after the date is skipped rather than
 * matched: older headings use an em dash where newer ones use a hyphen.
 */
export function latestRelease(changelog: string): Release | null {
  const match = /^## (\d{4}-\d{2}-\d{2}) \S+ v(\d+\.\d+\.\d+)/m.exec(changelog)
  return match ? { date: match[1], version: match[2] } : null
}
