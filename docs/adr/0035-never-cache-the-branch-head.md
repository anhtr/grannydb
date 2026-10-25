# ADR 0035 — Never let the browser cache the branch head; reload at the commit a sync made

**Status:** accepted · 2026-10-24

## Context

For about a minute after a sync, the app showed the data from before the push. It looked like it
was waiting for the Pages deploy, but signed-in reads never touch the deployed bundle
([storage layer](../03-storage-layer.md#three-read-paths-and-a-fallback)). The cause was the
browser's HTTP cache. Every read starts by asking GitHub which commit the branch is on, GitHub
answers with `Cache-Control: max-age=60`, and `fetch` honoured it. Everything after that step is
pinned to the sha it returns, so a stale sha meant a stale screen.

It was worse than a stale screen. `nextId` numbers a new row from the rows on screen, which did
not include the one just pushed, so the next new row got that row's id. A new row and an edit are
the same field-level upsert ([ADR 0004](0004-operation-log-not-file-snapshots.md)), so syncing it
would have written the new record's fields over the pushed one. That breaks invariant 7: an id was
reused.

## Options

**Show a "may be out of date" indicator for a minute after a sync.** Treats the symptom, and the
duplicate id is still handed out. Rejected.

**`cache: 'no-store'`.** Always a full request. Correct, but every head check counts against the
rate limit even when nothing changed.

**A cache-busting query string** (`?t=<now>`). Also correct, and also always a full request. It
relies on how GitHub routes an unknown parameter, where a standard request option is available.

**`cache: 'no-cache'`.** The browser keeps its copy but must revalidate it with the ETag every
time. An unchanged head comes back as a 304, which GitHub does not count against the rate limit, so
this costs the same as the cache working as intended and is never stale.

**Reload at the sha the sync just made, with no head lookup.** The commit protocol already returns
it. This is read-your-writes by construction: no cache, proxy or replica lag between the writer and
its next read can matter, because the reader does not ask.

## Decision

Both of the last two. `no-cache` on the head request alone fixes every read, including Refresh and
the fresh read a sync makes before committing, which was otherwise also liable to read a stale head
and fail its fast-forward check. Reading at `result.sha` after a sync additionally removes the one
case where a stale answer is most likely and most costly. The file reads keep their default caching:
they are fetched *at a sha* and never change.

## Consequences

- Data on screen never goes back to a commit older than the one this device just pushed.
- One extra round trip per read when the browser would otherwise have answered the head request
  from its cache, a 304 in the common case.
- Nothing else in the app asks GitHub a mutable question; if something ever does (listing branches,
  say), it needs the same `cache: 'no-cache'`.
- Two devices that are each offline can still both create a row with the same next id. That is a
  separate gap (ids are assigned on the device, not by the repo) and this does not close it.
