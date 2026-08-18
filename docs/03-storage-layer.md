# 3. Storage layer — GitHub as a database

The repo is the database. Git supplies durability, history, and — usefully — a concurrency
primitive. This page covers how data comes out and how it goes back in.

Code: [`src/core/github/`](../src/core/github/).

## Reads

### Pinning to a commit: snapshot isolation

Loading is not "fetch three CSVs". It is:

1. `GET /repos/{owner}/{repo}/git/ref/heads/{branch}` → the head commit sha
2. fetch every file **at that sha**

Without step 1 you get a torn read: `squares.csv` from before a sync landed and `yarns.csv` from
after, producing a square referencing a yarn that does not appear to exist. Pinning gives a
consistent view of the whole dataset at one point in time — **snapshot isolation**, the same reason
a database gives a long-running query a consistent view rather than whatever each page holds when
it is touched.

It is also what makes the write path safe: the sha we read at becomes the parent we write against.
See "Writes" below.

### The cache is content-addressed

Content at a given sha is **immutable**. That makes caching trivial: key blobs on
`{owner}/{repo}/{sha}/{path}` in IndexedDB and a hit needs no revalidation at all. No ETags, no
`If-None-Match`, no staleness window. The sha *is* the version.

Only the ref lookup is uncached — one request to learn whether anything changed, then zero requests
if nothing did. This is the same idea as a content-addressed store: identity is derived from
content, so equal keys mean equal bytes, so cache invalidation is not a problem you have.

### Three read paths

One interface, chosen at runtime in `readSnapshot` ([`read.ts`](../src/core/github/read.ts)):

| Path | When | Notes |
|---|---|---|
| **API** | a token is saved | Pinned to a sha. The only path that works on a private repo. |
| **Bundle** | no token | `data/bundle.json` on the same origin: one request, pre-parsed. |
| **Raw** | no token, no bundle | `raw.githubusercontent.com`. Fallback, e.g. on a dev server. |

The bundle is a **materialised view**: the build pipeline flattens four schema files and three CSVs
into one already-parsed JSON, so an anonymous cold visit is a single request with no CSV parsing.
Like any materialised view it is derived, rebuilt by the pipeline, and never authoritative — the
CSVs are.

Signed-in users deliberately do *not* read the bundle. It is only as fresh as the last deploy
(~1 minute behind), and you should never wait on a CI run to see an edit you just made.

## Writes

### Why not `PUT /contents/{path}`

The obvious API. It takes a path, base64 content, and the blob's `sha` for optimistic locking. It is
also one file per call, which means:

- a sync touching `squares.csv` and `yarns.csv` lands as **two commits**
- between them the repo is inconsistent — a square referencing a yarn that does not exist yet
- the history fills with paired commits that are really one edit

So we build the commit by hand instead. See
[ADR 0003](adr/0003-git-data-api-for-atomic-commits.md).

### The commit protocol

[`commitFiles`](../src/core/github/commit.ts), six steps:

```
1. GET  /git/ref/heads/{branch}       → head sha; abort if it moved since we read
2. GET  /git/commits/{baseCommit}     → its tree sha
3. POST /git/blobs         (per file) → blob shas        [content]
4. POST /git/trees                    → new tree, layered over base_tree
5. POST /git/commits                  → commit object, parent = baseCommit
6. PATCH /git/refs/heads/{branch}     → move the branch  [compare-and-swap]
```

Steps 3–5 are pure object creation: they write nothing anyone can see. Git objects are immutable
and content-addressed, so creating them is idempotent and safe to retry. Nothing is visible until
step 6 moves the ref. **The commit is atomic because a ref update is atomic.**

`base_tree` in step 4 matters: the new tree is a layer over the old one, so every file we did not
touch carries across untouched. We only ever send the files that changed.

### Optimistic concurrency control

Step 6 sends `force: false`, making it fast-forward-only. If the branch moved since `baseCommit`,
GitHub rejects it with 422 and we raise `StaleHeadError`.

This is textbook **optimistic concurrency control**: no locks, no coordination, just a version check
at commit time — "I read version X, only apply this if you are still at X". Cheap, correct, and
right for a workload with almost no real contention. Step 1 is a courtesy check that fails fast
before uploading blobs; step 6 is the one that actually enforces it, because it is the only check
that cannot race.

What happens next is the interesting part, and it lives in the [sync engine](04-sync-engine.md): a
conflict is not an error, it is a signal to re-read and replay.

### Binary is already supported

`FileChange.content` accepts `string | Uint8Array`, and `toBase64` handles both. Photos need no
change to this layer — only a new field type and an image-resizing step.

## Errors worth distinguishing

`GitHubError` ([`client.ts`](../src/core/github/client.ts)) exposes the status plus a few named
cases, because they need different responses:

| Case | Status | Meaning | Response |
|---|---|---|---|
| `isAuth` | 401 | token expired or revoked | ask for a new token |
| `isForbidden` | 403 | missing permission, or rate limited | show which; the client rewrites rate-limit messages with the reset time |
| `isNotFound` | 404 | wrong repo name, or token cannot see it | check settings |
| `isConflict` | 409/422 | branch moved | re-read and replay — **not** an error to show |

Rate limits are a non-issue in practice: 5,000 requests/hour authenticated, and a full load is about
eight, most of which get cached forever by sha.

## What this is not

Worth being honest about the limits of "GitHub as a database":

- **No partial reads.** Every load fetches whole files. Fine at 400 rows (~50 KB); it would not be
  at 400,000.
- **No transactions across a read.** A commit is atomic, but read-modify-write is not — that gap is
  exactly what the compare-and-swap covers.
- **No indexes.** Every query is a linear scan in memory. At this scale, faster than maintaining one.
- **No server-side validation.** Anyone with push access can commit a broken CSV. CI catches it
  after the fact rather than refusing the write; see [operations](06-operations.md).
