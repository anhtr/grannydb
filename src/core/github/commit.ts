import { apiJson } from './client'
import { GitHubError } from './client'
import { toBase64 } from './base64'
import type { RepoConfig } from './config'

/**
 * One file in a commit. `content` accepts bytes as well as text so that adding photos later needs
 * no change here.
 */
export interface FileChange {
  path: string
  content: string | Uint8Array
}

export interface CommitResult {
  sha: string
  /** Files actually written. Empty when nothing differed from the base commit. */
  paths: string[]
}

/**
 * The branch moved under us between reading and writing.
 *
 * Recoverable: the caller re-reads, replays its pending operations onto the new head, and retries.
 */
export class StaleHeadError extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`Branch moved from ${expected.slice(0, 7)} to ${actual.slice(0, 7)} while syncing`)
    this.name = 'StaleHeadError'
  }
}

export async function getHeadSha(
  config: RepoConfig,
  token: string,
  signal?: AbortSignal,
): Promise<string> {
  const ref = await apiJson<{ object: { sha: string } }>(
    `/repos/${config.owner}/${config.repo}/git/ref/heads/${config.branch}`,
    { token, signal },
  )
  return ref.object.sha
}

/**
 * Write several files as a single commit, using the Git Data API.
 *
 * `PUT /contents/{path}` would be shorter, but it commits one file at a time. A sync that touches
 * squares.csv and yarns.csv would then land as two commits, with a window where the repo holds a
 * square referencing a yarn that does not exist yet. Building the tree by hand keeps the write
 * atomic — the repo goes from one consistent state to the next, or nowhere at all.
 *
 *   ref -> commit -> blobs -> tree -> commit -> ref
 *
 * The final ref update is a compare-and-swap: GitHub rejects a non-fast-forward with 422, which is
 * exactly the optimistic-concurrency check we want.
 */
export async function commitFiles(
  config: RepoConfig,
  token: string,
  files: readonly FileChange[],
  message: string,
  baseCommit: string,
  signal?: AbortSignal,
): Promise<CommitResult> {
  if (files.length === 0) return { sha: baseCommit, paths: [] }

  const base = `/repos/${config.owner}/${config.repo}`

  // 1. Confirm nothing moved since the snapshot these files were built from.
  const head = await getHeadSha(config, token, signal)
  if (head !== baseCommit) throw new StaleHeadError(baseCommit, head)

  // 2. The commit we are branching from, for its tree.
  const baseCommitObj = await apiJson<{ tree: { sha: string } }>(
    `${base}/git/commits/${baseCommit}`,
    { token, signal },
  )

  // 3. Upload contents as blobs.
  const blobs = await Promise.all(
    files.map(async (file) => {
      const blob = await apiJson<{ sha: string }>(`${base}/git/blobs`, {
        token,
        signal,
        method: 'POST',
        body: { content: toBase64(file.content), encoding: 'base64' },
      })
      return { path: file.path, sha: blob.sha }
    }),
  )

  // 4. A new tree layered over the base tree, so untouched files carry across untouched.
  const tree = await apiJson<{ sha: string }>(`${base}/git/trees`, {
    token,
    signal,
    method: 'POST',
    body: {
      base_tree: baseCommitObj.tree.sha,
      tree: blobs.map((b) => ({ path: b.path, mode: '100644', type: 'blob', sha: b.sha })),
    },
  })

  // 5. The commit object.
  const commit = await apiJson<{ sha: string }>(`${base}/git/commits`, {
    token,
    signal,
    method: 'POST',
    body: { message, tree: tree.sha, parents: [baseCommit] },
  })

  // 6. Move the branch. `force: false` keeps this a fast-forward-only compare-and-swap.
  try {
    await apiJson(`${base}/git/refs/heads/${config.branch}`, {
      token,
      signal,
      method: 'PATCH',
      body: { sha: commit.sha, force: false },
    })
  } catch (error) {
    if (error instanceof GitHubError && error.isConflict) {
      const actual = await getHeadSha(config, token, signal).catch(() => 'unknown')
      throw new StaleHeadError(baseCommit, actual)
    }
    throw error
  }

  return { sha: commit.sha, paths: files.map((f) => f.path) }
}
