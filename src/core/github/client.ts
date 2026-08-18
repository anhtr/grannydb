const API_ROOT = 'https://api.github.com'

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
    readonly body?: unknown,
  ) {
    super(message)
    this.name = 'GitHubError'
  }

  /** The token is missing, expired, or revoked. */
  get isAuth(): boolean {
    return this.status === 401
  }

  /** The token is valid but lacks the permission, or we are rate limited. */
  get isForbidden(): boolean {
    return this.status === 403
  }

  /**
   * Someone else moved the branch while we were building our commit.
   * GitHub answers a non-fast-forward ref update with 422.
   */
  get isConflict(): boolean {
    return this.status === 409 || this.status === 422
  }

  get isNotFound(): boolean {
    return this.status === 404
  }
}

export interface RequestOptions {
  token?: string | undefined
  method?: string
  body?: unknown
  /** Override the Accept header, e.g. to ask for a file's raw bytes. */
  accept?: string
  signal?: AbortSignal
}

async function request(path: string, options: RequestOptions = {}): Promise<Response> {
  const url = path.startsWith('http') ? path : `${API_ROOT}${path}`
  const headers: Record<string, string> = {
    Accept: options.accept ?? 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (options.token) headers.Authorization = `Bearer ${options.token}`
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  })

  if (!response.ok) {
    let body: unknown
    let message = `${response.status} ${response.statusText}`
    try {
      body = await response.json()
      const m = (body as { message?: string } | null)?.message
      if (m) message = m
    } catch {
      /* non-JSON error body; the status line is all we get */
    }
    if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
      const reset = response.headers.get('x-ratelimit-reset')
      const at = reset ? new Date(Number(reset) * 1000).toLocaleTimeString() : 'shortly'
      message = `GitHub rate limit reached. Resets at ${at}.`
    }
    throw new GitHubError(message, response.status, url, body)
  }

  return response
}

export async function apiJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await request(path, options)
  return (await response.json()) as T
}

export async function apiText(path: string, options: RequestOptions = {}): Promise<string> {
  const response = await request(path, options)
  return await response.text()
}

/** Plain fetch for same-origin or raw.githubusercontent URLs, with the same error shape. */
export async function plainText(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, { signal })
  if (!response.ok) {
    throw new GitHubError(`${response.status} ${response.statusText}`, response.status, url)
  }
  return await response.text()
}
