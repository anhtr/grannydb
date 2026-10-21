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
 * Asked before any in-app navigation; returning false cancels it. Set by a screen holding unsaved
 * work (the record form). Only in-app links go through it - the browser's own back gesture cannot be
 * stopped from a hash route, which is why the form also asks on `beforeunload` for a closed tab.
 */
let leaveGuard: (() => boolean) | null = null

/** Install `guard` until the returned cleanup runs. */
export function setLeaveGuard(guard: () => boolean): () => void {
  leaveGuard = guard
  return () => {
    if (leaveGuard === guard) leaveGuard = null
  }
}

function mayLeave(): boolean {
  return leaveGuard === null || leaveGuard()
}

/**
 * What an in-app navigation records on its history entry: the path it was opened from. Kept on the
 * entry itself (`history.state`) rather than in a variable, because it has to survive the browser's
 * own Back and Forward - after a traversal, "the page shown last" and "the entry behind this one" are
 * different pages, and only the entry knows the second.
 */
interface EntryState {
  from: string
}

function entryFrom(): string | null {
  const state = window.history.state as Partial<EntryState> | null
  return typeof state?.from === 'string' ? state.from : null
}

/**
 * Through the History API and a synthetic `hashchange`, not by assigning `location.hash`: assigning
 * it is a fragment navigation, and Chrome scrolls the page to the top for one before the app has even
 * heard about it - wiping the scroll position a list is about to save for when you come back.
 *
 * A pushed entry records the current path as where it came from; a replacing one keeps the entry's
 * existing record, because replacing does not change what is behind it (new record → its saved page).
 */
export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const target = `#${to.startsWith('/') ? to : `/${to}`}`
  if (target === window.location.hash || !mayLeave()) return
  if (options.replace) {
    const from = entryFrom()
    window.history.replaceState(from === null ? null : ({ from } satisfies EntryState), '', target)
  } else {
    window.history.pushState({ from: currentPath() } satisfies EntryState, '', target)
  }
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

/**
 * Go "up" to `to`: by stepping back through history when the entry behind this one is `to`, so
 * list → record → back does not leave a second copy of the list on the history stack; by navigating
 * there otherwise - after opening a record from a shared link, say, where stepping back would leave
 * the app altogether, or on an entry the browser reached by its own Back/Forward from elsewhere.
 */
export function goBack(to: string): void {
  if (entryFrom() === to) {
    if (mayLeave()) window.history.back()
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
