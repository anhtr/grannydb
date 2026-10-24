import { NetworkError } from '../github'
import type { AppState } from './appStore'

/**
 * When the queue pushes itself, and when it must not.
 *
 * Sync used to be a button only (docs/04-sync-engine.md). The three objections to automating it
 * were a commit per keystroke, failures nobody sees, and writes happening while you are not
 * looking; each one is answered by a rule here rather than by a promise in prose. See ADR 0032.
 *
 * Pure policy, no timers and no DOM, so the rules are pinned by tests. `AppStore` owns the timer and
 * the event listeners and asks this module what to do.
 */

/**
 * Quiet time after the last edit before an automatic push.
 *
 * Long enough that entering a square — status, two colours, a note — is one commit rather than
 * four, which is what keeps `git log` legible. Short enough that a phone put down on the arm of the
 * chair has pushed before anyone picks up the laptop. Leaving the app does not wait for it: see the
 * `hidden` trigger.
 */
export const AUTO_SYNC_IDLE_MS = 30_000

/**
 * What prompted an attempt. Only `edit` waits for the idle delay; the rest are moments when either
 * the network has just come back or the app may be about to be frozen, and waiting would miss them.
 */
export type AutoSyncTrigger = 'start' | 'online' | 'visible' | 'hidden' | 'edit' | 'after-sync'

export type AutoSyncBlocker = 'off' | 'no-token' | 'nothing-queued' | 'busy' | 'offline'

/**
 * Why an automatic push should not happen now, or null when it should.
 *
 * `offline` trusts `navigator.onLine` in one direction only. False is reliable (there is no
 * interface), so it saves a request that cannot succeed. True is not (a captive portal is "online"),
 * so it permits an attempt and the attempt decides — which is why a network failure during an
 * automatic push is treated as "still offline" rather than as an error.
 */
export function autoSyncBlocker(
  state: Pick<AppState, 'prefs' | 'token' | 'changes' | 'syncing' | 'online'>,
): AutoSyncBlocker | null {
  if (!state.prefs.autoSync) return 'off'
  if (!state.token) return 'no-token'
  if (state.changes.length === 0) return 'nothing-queued'
  if (state.syncing) return 'busy'
  if (!state.online) return 'offline'
  return null
}

/** Milliseconds to wait before acting on a trigger. */
export function autoSyncDelay(trigger: AutoSyncTrigger): number {
  return trigger === 'edit' || trigger === 'after-sync' ? AUTO_SYNC_IDLE_MS : 0
}

/**
 * Whether a failed automatic push should be reported.
 *
 * Not reaching GitHub is the expected state of an offline-first app on a train, and the queue is
 * already the record of what is waiting; a red banner every thirty seconds would teach you to ignore
 * the banner. Anything else — an expired token, a branch that kept moving, a schema problem — will
 * not fix itself by waiting for signal, so it surfaces exactly as a manual sync's failure would.
 */
export function isWorthReporting(error: unknown): boolean {
  return !(error instanceof NetworkError)
}
