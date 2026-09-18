# ADR 0026 — Keep a last-known-good snapshot on the device for offline reads

**Status:** accepted · 2026-09-17

## Context

The app is used on a phone, and one of its stated operating conditions is "sometimes with no signal"
— on a train, in a chair by a window with bad reception, on a plane. The write half was built for
that from the start: the queue is a durable operation log
([ADR 0004](0004-operation-log-not-file-snapshots.md)).

The read half was not. All three read paths in `readSnapshot` need the network, and the
authenticated one needs it twice: `readFromApi` begins with a ref lookup, and the content-addressed
blob cache is keyed by the commit sha that lookup returns. So with no signal there is no sha, hence
no cache key, hence nothing to read. `AppStore.reload` set `phase: 'error'` with no `snapshot`, and
since every screen renders from `snapshot.schemas`, the whole app collapsed to one error line —
including the pending edits, which were safe on disk but had nothing to render them.

## Options

**Cache API responses in the service worker.** The worker already exists for the app shell, so this
is nearly free. But it means authenticated `api.github.com` responses sitting in a cache on an
origin shared with every other project page under the same github.io user — exactly the exposure
[ADR 0006](0006-public-data-and-anonymous-reads.md) and the security posture are careful about. It
also only covers the API path, leaving anonymous visitors with a different offline story.

**Precache `data/bundle.json`.** Covers the anonymous path with one line. Gives signed-in users a
second, competing source of staleness — the bundle is as old as the last deploy, the cache as old
as the last visit — and it still leaves the API path with nothing.

**Rely on the existing blob cache.** Already content-addressed and already there. Unreachable
without a ref lookup, which is the one request that cannot be served from it.

**Persist the whole `Snapshot` after every successful read.** One mechanism, identical for all three
read paths, keyed by the data location rather than by a sha.

## Decision

After every successful read, write the `Snapshot` to IndexedDB under
`grannydb.snapshot:{owner}/{repo}/{branch}/{dataDir}`. When a read fails and a saved snapshot
exists, load it, mark it `source: 'cache'`, and carry on as `phase: 'ready'`.

Two caches now, doing different jobs, and the difference is the point:

| Cache | Keyed by | Property | Answers |
|---|---|---|---|
| Blob cache | commit sha | immutable, never stale, needs a ref lookup | "have I already fetched this exact file?" |
| Snapshot cache | data location | possibly stale, always available | "what did this dataset last look like?" |

`fetchedAt`, already captured on every snapshot and until now read by nothing, becomes the "showing
the copy saved 3 hours ago" line.

## Consequences

- The app opens and works with no network on every read path, signed in or not, with the queue
  replayed on top as usual: an offline edit still looks no different from a synced one.
- Rendering a stale base is safe because it is only ever a *base*. `syncChanges` re-reads the repo
  fresh inside its retry loop, so nothing derived from these bytes reaches GitHub.
- Staleness has to be visible, or the app is quietly lying about the repo. Hence `SourceKind`
  gaining `'cache'`, the bar above the nav, and the "Data as of" row in Settings.
- Keyed by config, so pointing Settings at a scratch branch cannot serve you `main`'s cached rows.
- What comes out of IndexedDB was written by some earlier version of the app, so it is validated on
  the way in (`isStoredSnapshot`) rather than trusted.
- A device that has never loaded the data has nothing to fall back to, and still shows the error.
  That is the honest answer: there is no copy.
- The cached snapshot is the *last read*, not the last commit. Two devices can hold different
  snapshots. Neither can clobber the other, because neither is ever committed.
