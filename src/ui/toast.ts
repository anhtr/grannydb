/**
 * The one-line message that says an action took: saved, deleted, synced.
 *
 * Before this, nothing in the app confirmed anything. A save navigated away, a delete navigated
 * away, a sync changed a number in the header - each a thing to infer, and with a screen reader not
 * even that. This is the **transient notification** pattern (a "toast" or "snackbar"): a message that
 * arrives by itself, says what happened, optionally offers the one way to take it back, and leaves
 * by itself.
 *
 * Module-level state with a subscribe function, the same shape as `appStore`, so anything in `ui/`,
 * `features/` or `app/` can call `notify` without a context provider being threaded to it. It is not
 * *in* the store because none of it is application state: it is not saved, not synced, and nothing
 * else reads it.
 *
 * One message at a time, the newest replacing the last. A stack would be more complete and, on a
 * phone, would cover the list being worked on; the cost is that an Undo is lost when a second
 * message arrives inside its few seconds.
 */
export interface ToastAction {
  label: string
  run: () => void | Promise<void>
}

export interface Toast {
  /** Unique per message, so the same words twice in a row are still announced twice. */
  id: number
  message: string
  tone: 'ok' | 'warn'
  action?: ToastAction
}

/** Long enough to read a short line; a message with a button on it stays long enough to reach it. */
export const TOAST_MS = 4000
export const TOAST_WITH_ACTION_MS = 8000

type Listener = () => void

let current: Toast | null = null
let nextId = 1
let timer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<Listener>()

function set(next: Toast | null): void {
  current = next
  for (const listener of listeners) listener()
}

function startTimer(toast: Toast): void {
  clearTimeout(timer)
  timer = setTimeout(() => dismissToast(toast.id), toast.action ? TOAST_WITH_ACTION_MS : TOAST_MS)
}

export function notify(message: string, options: { tone?: Toast['tone']; action?: ToastAction } = {}): void {
  const toast: Toast = { id: nextId++, message, tone: options.tone ?? 'ok', action: options.action }
  set(toast)
  startTimer(toast)
}

/** With an id, only if that message is still the one showing - a stale timer must not close its successor. */
export function dismissToast(id?: number): void {
  if (!current || (id !== undefined && current.id !== id)) return
  clearTimeout(timer)
  timer = undefined
  set(null)
}

/** Stop the clock while the message is under a pointer or holds focus; nobody should race a timer to a button. */
export function holdToast(): void {
  clearTimeout(timer)
  timer = undefined
}

export function releaseToast(): void {
  if (current) startTimer(current)
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function currentToast(): Toast | null {
  return current
}

/** The parts of the store's state a finished sync is read from. */
export interface SyncGlimpse {
  syncing: boolean
  syncError: string | null
  /** `lastSync.at`, and how many changes that sync pushed. */
  lastSyncAt: number | undefined
  lastSyncCount: number
}

/**
 * What to say when a sync ends, or null when there is nothing to say.
 *
 * Read off two consecutive store states rather than called by whoever started the sync, because most
 * syncs are started by nobody: the store pushes by itself half a minute after an edit (`autoSync`),
 * and `core/` cannot import this file to announce it. A sync that failed quietly - offline, to be
 * retried - leaves `syncError` null on purpose and so says nothing here either.
 */
export function syncMessage(before: SyncGlimpse, after: SyncGlimpse): { message: string; tone: Toast['tone'] } | null {
  if (!before.syncing || after.syncing) return null
  if (after.lastSyncAt !== undefined && after.lastSyncAt !== before.lastSyncAt) {
    const n = after.lastSyncCount
    return { message: n > 0 ? `Synced ${n} change${n === 1 ? '' : 's'}` : 'Nothing needed syncing', tone: 'ok' }
  }
  if (after.syncError) return { message: 'Sync failed - see Pending changes', tone: 'warn' }
  return null
}
