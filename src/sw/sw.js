/*
 * Service worker: makes the app *open* with no network.
 *
 * It caches the shell — the HTML document and the hashed JS/CSS — and nothing else. It never
 * touches api.github.com, raw.githubusercontent.com, or data/bundle.json. Data offline is a
 * separate mechanism (`core/store/snapshotCache.ts`), and keeping the two apart is deliberate:
 * one cache that answers "does the page load" and one that answers "is there anything to show",
 * rather than two competing stories about how stale your squares are. See ADR 0027.
 *
 * Shipped as plain JS, not bundled. The two placeholders below are substituted at build time by the
 * `grannydb-service-worker` plugin in vite.config.ts, which is the only place the hashed filenames
 * are known.
 */

const VERSION = '__VERSION__'
const CACHE = `grannydb-${VERSION}`
const PRECACHE = __PRECACHE__
const SHELL = PRECACHE[0] // the based index.html, always first

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Asset filenames are content-hashed, so a new build shares nothing with the old cache and
      // the old one is pure dead weight.
      const names = await caches.keys()
      await Promise.all(
        names.filter((name) => name.startsWith('grannydb-') && name !== CACHE).map((name) => caches.delete(name)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Anything not on our own origin — the GitHub API above all — is none of this worker's business.
  // Returning without calling respondWith leaves the request completely untouched, which is what
  // keeps authenticated responses out of any cache on a shared origin (ADR 0006).
  if (url.origin !== self.location.origin) return

  // Hash routing means every route is the same document, so one cached index.html answers all of
  // them and there is no 404.html trick to get wrong (ADR 0007).
  if (request.mode === 'navigate') {
    event.respondWith(caches.match(SHELL).then((cached) => cached || fetch(request)))
    return
  }

  const path = url.pathname
  if (!PRECACHE.includes(path)) return

  // Precached entries are content-hashed and therefore immutable: a cache hit needs no
  // revalidation, and a miss can only mean the cache was evicted.
  event.respondWith(caches.match(path).then((cached) => cached || fetch(request)))
})

// The page asks for this when you accept a waiting update, never on its own: swapping the running
// app out from under someone mid-edit is worse than being one deploy behind.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') void self.skipWaiting()
})
