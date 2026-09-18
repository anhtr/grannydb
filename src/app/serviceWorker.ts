import { appStore } from '../core/store'

/**
 * Registers the worker that makes the app open with no network, and watches for a newer one.
 *
 * Production only. A worker caching the shell on `localhost:5173` would serve yesterday's bundle
 * over the dev server's, which is a confusing afternoon; in dev we actively unregister instead, so
 * a worker installed by `npm run preview` on the same port cannot linger.
 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return

  if (!import.meta.env.PROD) {
    void navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) void registration.unregister()
    })
    return
  }

  const url = `${import.meta.env.BASE_URL}sw.js`
  void navigator.serviceWorker.register(url, { scope: import.meta.env.BASE_URL }).then(
    (registration) => {
      if (registration.waiting && navigator.serviceWorker.controller) appStore.setUpdateReady()

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing
        if (!installing) return
        installing.addEventListener('statechange', () => {
          // `installed` with a controller already present means this is a replacement, not the
          // first install. Without this check every first visit would offer to update itself.
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            appStore.setUpdateReady()
          }
        })
      })
    },
    () => {
      // An unavailable worker costs offline loading, nothing else. The app still works.
    },
  )
}

/**
 * Accept a waiting update: tell it to take over, then reload once it has.
 *
 * Deliberately user-triggered. A precached shell that silently swaps mid-edit is the other way this
 * goes wrong, and the only cost of waiting is being one deploy behind until you tap the bar.
 */
export function applyUpdate(): void {
  if (!('serviceWorker' in navigator)) return
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  })
  void navigator.serviceWorker.getRegistration().then((registration) => {
    registration?.waiting?.postMessage('SKIP_WAITING')
  })
}
