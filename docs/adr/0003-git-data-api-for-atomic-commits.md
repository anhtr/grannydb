# ADR 0003 — Git Data API instead of the Contents API

**Status:** accepted · 2026-08-17

## Context

A sync can touch more than one file — a new square that also introduces a new yarn writes both
`squares.csv` and `yarns.csv`. It has to land as one commit, and it must not overwrite work done
elsewhere since the data was read.

## Options

**`PUT /repos/{o}/{r}/contents/{path}`.** One call per file. Takes the blob `sha` for optimistic
locking, which is the right idea. But it is one commit per file, so a two-file sync produces two
commits with an inconsistent state in between — a square referencing a yarn that does not exist
yet — and a history where one logical edit appears as a pair.

**Git Data API.** Build the commit by hand: blobs → tree → commit → move the ref. Five or six calls
instead of one. Atomic across any number of files, full control over the message, and the ref update
is a natural compare-and-swap.

## Decision

Git Data API, in [`commitFiles`](../../src/core/github/commit.ts).

```
GET  /git/ref/heads/{branch}    → confirm the head has not moved
GET  /git/commits/{base}        → its tree
POST /git/blobs      (per file) → content
POST /git/trees                 → layered over base_tree
POST /git/commits               → the commit object
PATCH /git/refs/heads/{branch}  → force:false, fast-forward only
```

## Consequences

- Multi-file writes are atomic. Steps 3–5 create immutable objects nobody can see; only step 6 makes
  anything visible.
- `base_tree` means untouched files carry across untouched, so only changed files are uploaded.
- `force: false` gives optimistic concurrency control for free: GitHub returns 422 on a
  non-fast-forward, surfaced as `StaleHeadError` and handled by re-reading and replaying
  ([ADR 0004](0004-operation-log-not-file-snapshots.md)).
- More code and more round trips than the Contents API. About 120 lines, worth it.
- Binary content is already supported (`string | Uint8Array`), so photos need no change here.
