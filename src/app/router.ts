import { useCallback, useSyncExternalStore } from 'react'

/**
 * A ~50-line hash router.
 *
 * Hash routing rather than the History API because GitHub Pages serves this app from the
 * `/grannydb/` subpath and has no server to rewrite deep links back to index.html. With a hash the
 * browser never asks the server for `/squares/S001` in the first place, so there is no 404.html
 * trick to maintain and the app works identically from a file:// preview.
 */

function currentPath(): string {
  const hash = window.location.hash.replace(/^#/, '')
  return hash === '' ? '/' : hash
}

function subscribe(callback: () => void): () => void {
  window.addEventListener('hashchange', callback)
  return () => window.removeEventListener('hashchange', callback)
}

export function useRoute(): string {
  return useSyncExternalStore(subscribe, currentPath, () => '/')
}

/**
 * Through the History API and a synthetic `hashchange`, not by assigning `location.hash`: assigning
 * it is a fragment navigation, and Chrome scrolls the page to the top for one before the app has even
 * heard about it — wiping the scroll position a list is about to save for when you come back.
 */
export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const target = `#${to.startsWith('/') ? to : `/${to}`}`
  if (target === window.location.hash) return
  if (options.replace) {
    window.history.replaceState(null, '', target)
  } else {
    window.history.pushState(null, '', target)
  }
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

/**
 * The path shown before the current one, so a "back" link can tell whether the page it points to is
 * the one actually behind it in history. Tracked here rather than read from `history`, which does not
 * expose its entries.
 */
let shownPath = typeof window === 'undefined' ? '/' : currentPath()
let previousPath: string | null = null
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    previousPath = shownPath
    shownPath = currentPath()
  })
}

/**
 * Go "up" to `to`: by stepping back through history when that is where the last navigation came
 * from, so list → record → back does not leave a second copy of the list on the history stack (and the
 * browser restores where the list was scrolled to); by navigating there otherwise, e.g. after opening
 * a record from a shared link, where stepping back would leave the app altogether.
 */
export function goBack(to: string): void {
  if (previousPath === to && window.history.length > 1) {
    window.history.back()
  } else {
    navigate(to)
  }
}

export function useNavigate(): (to: string, options?: { replace?: boolean }) => void {
  return useCallback(navigate, [])
}

export type RouteParams = Record<string, string>

/**
 * Match `/squares/:id` against `/squares/S001`.
 * Returns the captured params, or null when the shapes differ.
 */
export function matchRoute(pattern: string, path: string): RouteParams | null {
  const patternParts = pattern.split('/').filter(Boolean)
  const pathParts = path.split('/').filter(Boolean)
  if (patternParts.length !== pathParts.length) return null

  const params: RouteParams = {}
  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i]
    const v = pathParts[i]
    if (p.startsWith(':')) {
      params[p.slice(1)] = decodeURIComponent(v)
    } else if (p !== v) {
      return null
    }
  }
  return params
}

/** First matching route wins, so list patterns before their `:id` variants. */
export function resolveRoute<T>(
  routes: readonly { pattern: string; value: T }[],
  path: string,
): { value: T; params: RouteParams } | null {
  for (const route of routes) {
    const params = matchRoute(route.pattern, path)
    if (params) return { value: route.value, params }
  }
  return null
}

/** The top-level section of a path, used to highlight the active nav tab. */
export function routeSection(path: string): string {
  return path.split('/').filter(Boolean)[0] ?? ''
}
