import type { AppState } from './appStore'

/**
 * When the app re-reads the repo without being asked.
 *
 * A read used to happen at start-up, after a sync, and when the network came back to a device
 * showing its saved copy - never merely because time had passed. So a tab left open on the laptop
 * kept showing this morning's squares after an evening of adding them on the phone, until someone
 * thought to press Reload from GitHub. Coming back to the foreground is the moment that staleness is
 * about to be looked at, which makes it the moment to check. See ADR 0037.
 *
 * Pure policy, like `autoSync.ts` and for the same reason: `AppStore` owns the event listener and
 * asks this module what to do, so the rules are pinned by tests instead of by a browser.
 */

/**
 * How old the data on screen may be before returning to the app re-reads it.
 *
 * A read is a handful of requests, and flicking to a pattern in another app and back is something
 * that happens every minute or two while crocheting; re-reading on every one of those would spend
 * requests to learn nothing. A minute is short enough that putting the phone down and walking to
 * the laptop always crosses it.
 */
export const FOREGROUND_REFRESH_AFTER_MS = 60_000

export type RefreshBlocker = 'busy' | 'offline' | 'fresh'

/**
 * Why returning to the foreground should not re-read now, or null when it should.
 *
 * `busy` covers a push as well as a read: a sync ends by reading the commit it just made, so a
 * second read racing it could only be older. The saved copy (`source: 'cache'`) is never `fresh`,
 * however recently it was saved - it is on screen because the network failed, and being back in the
 * foreground with a connection is the first chance to do better.
 */
export function foregroundRefreshBlocker(
  state: Pick<AppState, 'phase' | 'snapshot' | 'syncing' | 'online'>,
  now: number,
): RefreshBlocker | null {
  if (state.phase === 'loading' || state.syncing) return 'busy'
  if (!state.online) return 'offline'
  const { snapshot } = state
  if (snapshot && snapshot.source !== 'cache' && now - snapshot.fetchedAt < FOREGROUND_REFRESH_AFTER_MS) return 'fresh'
  return null
}
