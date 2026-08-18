# 1. Overview

## The problem

Track ~400 granny squares for a blanket. For each one: colours used, which pattern, how it was
customised, when it was made, whether it has been blocked, where it eventually sits in the layout,
and notes. Search and aggregate across all of them. Plan squares that do not exist yet.

Three requirements shape everything else:

1. **The data must stay human-readable and hand-editable**, in the repo, viewable and editable on
   github.com or in a spreadsheet. The app is a convenience over the data, never a gatekeeper.
2. **No server.** The whole thing is a static site on GitHub Pages.
3. **The schema will change.** This dataset will grow fields for years. Absorbing that must not mean
   rewriting the app each time.

Plus one operational requirement: it is used mostly from a phone, often standing up, sometimes with
no signal.

## Why this is possible at all

`api.github.com` sends CORS headers and accepts a bearer token from a browser. That single fact is
what makes a serverless GitHub-backed app work: a static page can read *and write* repository
contents with no backend in between.

Everything else follows from consequences of that.

## The hard constraints

**No OAuth.** GitHub's token-exchange endpoints (`github.com/login/oauth/access_token`) do not send
CORS headers — including for device flow. A browser cannot complete the handshake. Every serverless
GitHub-backed app either proxies through a function or uses a personal access token. We use a
fine-grained PAT, scoped to this repo, `Contents: read and write`, pasted once per device and kept
in `localStorage`. See [ADR 0002](adr/0002-personal-access-token-auth.md).

**A static site has no secrets.** Anything the page can use to read data is visible to anyone who
views source. So "the repo is private but strangers can still browse the data" is not a thing that
can exist. Data readable by anonymous visitors is public data, full stop. See
[ADR 0006](adr/0006-public-data-and-anonymous-reads.md).

**Shared origin.** Every project page under `anhtr.github.io` is the *same browser origin*, so the
token in `localStorage` is reachable by script on any of them. Mitigations are structural: bundle
every dependency, no runtime CDN, a tight CSP, and a token scoped narrowly enough that the worst
case is edits to a list of granny squares. See [operations](06-operations.md).

**One writer, several devices.** Not a concurrency problem in the datacentre sense, but real: a
phone with queued offline edits, a laptop, and the GitHub web editor can all touch the same file.
Whatever the write path is, it must not let a stale copy clobber someone else's work.

## The shape of the answer

```
  phone / laptop browser
  ┌───────────────────────────────────────────┐
  │  React app (static, on GitHub Pages)      │
  │                                           │
  │  screens ── read model ──┬── base data ◄──┼── read: pinned to a commit sha
  │                          └── change queue │           (api / bundle / raw)
  │                                (IndexedDB)│
  │                               │           │
  └───────────────────────────────┼───────────┘
                                  │ Sync: replay queue onto fresh data,
                                  │       write as ONE atomic commit
                                  ▼
  ┌───────────────────────────────────────────┐
  │  github.com/anhtr/grannydb                │
  │    data/*.csv        ← source of truth    │
  │    data/schema/*.json ← drives the UI     │
  └───────────────────────────────────────────┘
                 │  push
                 ▼
  ┌───────────────────────────────────────────┐
  │  GitHub Actions: validate → build → Pages │
  │    emits data/bundle.json (public read)   │
  └───────────────────────────────────────────┘
```

Three ideas carry the design, each with its own page:

- **The data is CSV, and the schema is data too.** Adding a field is editing a JSON file and a CSV
  column, with no code change and no deploy. → [data model](02-data-model.md)
- **Edits are stored as operations, not files.** A local write-ahead log replayed onto fresh data at
  sync time, which is why concurrent edits merge instead of clobbering.
  → [sync engine](04-sync-engine.md)
- **Reads are pinned, writes are atomic and compare-and-swap.** Snapshot isolation on the way in,
  optimistic concurrency control on the way out. → [storage layer](03-storage-layer.md)

## Decisions at a glance

| Decision | Choice | ADR |
|---|---|---|
| Data format | CSV, one file per table | [0001](adr/0001-csv-as-the-storage-format.md) |
| Auth | Fine-grained PAT in `localStorage` | [0002](adr/0002-personal-access-token-auth.md) |
| Write API | Git Data API, atomic multi-file commits | [0003](adr/0003-git-data-api-for-atomic-commits.md) |
| Write model | Local-first operation log, explicit Sync | [0004](adr/0004-operation-log-not-file-snapshots.md) |
| Schema | JSON in the repo, loaded at runtime | [0005](adr/0005-schema-as-data.md) |
| Visibility | Public data, anonymous read-only | [0006](adr/0006-public-data-and-anonymous-reads.md) |
| Stack | React + TS + Vite + Tailwind, hash routing | [0007](adr/0007-stack-and-hash-routing.md) |
| Repo layout | One public repo; data location is config | [0008](adr/0008-single-repo-with-configurable-data-location.md) |

## What v1 does not do

Photos, the blanket layout designer, offline install (PWA), bulk edit, yarn usage estimation. The
architecture has seams for all of them — the commit layer already takes binary blobs, the field
registry already takes new types — but none are built. See the issue list in the repo.
