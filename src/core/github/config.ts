/**
 * Where the data lives.
 *
 * This is configuration rather than a constant on purpose. Moving the CSVs into their own
 * (possibly private) repo later should be a settings change, not a rewrite.
 */
export interface RepoConfig {
  owner: string
  repo: string
  branch: string
  /** Directory inside the repo holding the CSVs and `schema/`. */
  dataDir: string
}

export const DEFAULT_CONFIG: RepoConfig = {
  owner: 'anhtr',
  repo: 'grannydb',
  branch: 'main',
  dataDir: 'data',
}

const STORAGE_KEY = 'grannydb.repo-config'

export function loadConfig(): RepoConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CONFIG
    const parsed = JSON.parse(raw) as Partial<RepoConfig>
    return { ...DEFAULT_CONFIG, ...parsed }
  } catch {
    return DEFAULT_CONFIG
  }
}

export function saveConfig(config: RepoConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}

export function resetConfig(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function repoUrl(config: RepoConfig): string {
  return `https://github.com/${config.owner}/${config.repo}`
}

export function commitUrl(config: RepoConfig, sha: string): string {
  return `${repoUrl(config)}/commit/${sha}`
}

export function fileUrl(config: RepoConfig, path: string): string {
  return `${repoUrl(config)}/blob/${config.branch}/${path}`
}
