import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useAppState } from '../app/hooks'
import { currentToast, dismissToast, holdToast, notify, releaseToast, subscribeToasts, syncMessage } from './toast'
import type { SyncGlimpse } from './toast'

/**
 * Where `notify` messages appear - see `toast.ts`. Mounted once, by `App`.
 *
 * The outer element is a **live region** and is always in the document, empty or not: a screen
 * reader announces text that *changes inside* a region it already knows about, and one that is
 * created together with its first message is often not announced at all.
 *
 * It floats above the footer and above the bars that float on the footer themselves (a form's Save
 * bar, the list's New button), so a message never covers the control that was just pressed.
 */
export function Toaster() {
  const toast = useSyncExternalStore(subscribeToasts, currentToast, currentToast)
  useSyncToasts()

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--footer-height,4rem)+4.75rem)] z-40 flex justify-center px-4"
    >
      {toast ? (
        <div
          // Keyed by id so a new message is a new element, which is what gets it read out again.
          key={toast.id}
          className={`pointer-events-auto flex max-w-full items-center gap-1 rounded-xl py-1 pl-4 pr-1 text-sm shadow-lg shadow-black/20 ${
            toast.tone === 'warn'
              ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
              : // Ink on paper, swapped: dark on a light page and light on a dark one, without a second palette.
                'bg-ink text-paper'
          }`}
          onMouseEnter={holdToast}
          onMouseLeave={releaseToast}
          onFocus={holdToast}
          onBlur={releaseToast}
        >
          <span className="min-w-0 py-2">{toast.message}</span>
          {toast.action ? (
            <button
              type="button"
              className="tap-target shrink-0 rounded-lg px-3 font-semibold underline underline-offset-2"
              onClick={() => {
                const { action } = toast
                dismissToast(toast.id)
                void action?.run()
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Dismiss"
            className="tap-target shrink-0 rounded-lg px-2 opacity-70"
            onClick={() => dismissToast(toast.id)}
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  )
}

/** Announces each sync as it ends, whoever or whatever started it - see `syncMessage`. */
function useSyncToasts() {
  const { syncing, syncError, lastSync } = useAppState()
  const glimpse: SyncGlimpse = {
    syncing,
    syncError,
    lastSyncAt: lastSync?.at,
    lastSyncCount: lastSync?.changeCount ?? 0,
  }
  const previous = useRef(glimpse)
  useEffect(() => {
    const said = syncMessage(previous.current, glimpse)
    previous.current = glimpse
    if (said) notify(said.message, { tone: said.tone })
    // `glimpse` is rebuilt every render; its four parts are the real dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glimpse.syncing, glimpse.syncError, glimpse.lastSyncAt, glimpse.lastSyncCount])
}
