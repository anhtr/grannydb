import { apiJson, GitHubError } from './client'
import type { RepoConfig } from './config'

const TOKEN_KEY = 'grannydb.token'

/**
 * The token lives in localStorage, not sessionStorage, so it survives closing the tab — the whole
 * point is pasting it once per device.
 *
 * Caveat worth knowing: every project page under `<user>.github.io` shares one origin, so this
 * value is readable by any script running on any of them. Mitigations are structural: bundle all
 * dependencies (no runtime CDN), keep the CSP tight, and scope the token to this repo with
 * Contents-only permission so the worst case is edits to a granny square list.
 */
export function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token.trim())
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export interface ConnectionCheck {
  ok: boolean
  message: string
  login?: string
  canWrite?: boolean
  private?: boolean
}

/**
 * Probe the token against the configured repo and report what it can actually do.
 *
 * Reports the *effective* permission rather than what you meant to grant. A fine-grained token
 * missing "Contents: read and write" reads fine and then fails at the first sync, which is a
 * miserable way to find out.
 */
export async function checkConnection(
  config: RepoConfig,
  token: string,
): Promise<ConnectionCheck> {
  try {
    const repo = await apiJson<{
      full_name: string
      private: boolean
      permissions?: { push?: boolean; admin?: boolean }
    }>(`/repos/${config.owner}/${config.repo}`, { token })

    const canWrite = repo.permissions?.push === true || repo.permissions?.admin === true

    let login: string | undefined
    try {
      const user = await apiJson<{ login: string }>('/user', { token })
      login = user.login
    } catch {
      // Fine-grained tokens without the profile permission cannot read /user. Not a problem.
    }

    return {
      ok: true,
      canWrite,
      private: repo.private,
      login,
      message: canWrite
        ? `Connected to ${repo.full_name} with write access.`
        : `Connected to ${repo.full_name}, but this token cannot write. Grant "Contents: read and write".`,
    }
  } catch (error) {
    if (error instanceof GitHubError) {
      if (error.isAuth) return { ok: false, message: 'Token rejected. It may be expired or revoked.' }
      if (error.isNotFound) {
        return {
          ok: false,
          message: `Cannot see ${config.owner}/${config.repo}. Check the name, and that the token covers this repo.`,
        }
      }
      return { ok: false, message: error.message }
    }
    return { ok: false, message: error instanceof Error ? error.message : 'Connection failed.' }
  }
}
