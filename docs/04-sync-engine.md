# 4. Sync engine

The most consequential design decision in the app, and the one with the most transferable idea in
it. Code: [`src/core/store/`](../src/core/store/).

## The decision: log the operations, not the result

When you edit a square on your phone, the app could store either:

**(a) the resulting file** — "here is what `squares.csv` should look like", or
**(b) the operation** — "set `notes` on `S042` to this".

(a) is simpler and it is a data-loss bug. The file you hold was read at some earlier point. Push it
and you silently revert anything that happened since: an edit from your laptop, a fix made in the
GitHub web editor, a row someone added. The longer an edit sits queued, the more it destroys — which
is exactly backwards from what you want in an offline-first app.

(b) has no such window. The operation says what you *meant*. At sync time it can be applied to
whatever the repo says now.

```ts
interface Change {
  id: string
  ts: number
  table: string
  op: 'upsert' | 'delete'
  rowId: string
  values?: Record<string, string>   // ONLY the fields that changed
}
```

This is a **write-ahead log**, and syncing is **log replay onto a new base**. If you have met event
sourcing, this is that, at the smallest scale where it still earns its keep. See
[ADR 0004](adr/0004-operation-log-not-file-snapshots.md).

### Partial `values` is load-bearing

`values` holds only fields whose value actually changed — the diff is computed in `appStore.save`
against the current merged row.

Storing the whole row would still lose data, just less obviously. Suppose your phone has a queued
`notes` edit on `S042`, and meanwhile your laptop sets `position` on the same square and syncs. A
whole-row operation would carry your phone's stale blank `position` and wipe it. A field-level
operation touches `notes` and leaves `position` alone.

Field-level last-writer-wins is the simplest useful **CRDT register**. It is not full CRDT
machinery — no vector clocks, no causality tracking — but it gives the property that matters:
concurrent edits to *different fields* of the same record both survive, and concurrent edits to the
*same field* resolve deterministically rather than corrupting.

## Durability

The queue lives in IndexedDB, written synchronously with every edit. It survives a refresh, a closed
tab, a killed browser, a dead battery. An hour of squares entered on a train must not depend on the
tab staying open.

`localStorage` would have worked for text, but IndexedDB stores structured data without
`JSON.stringify` round-trips and has room for photo blobs later.

One sharp edge, found by testing: `idb-keyval` touches `indexedDB` **synchronously**, so when
storage is unavailable — private browsing, blocked site data — it throws before returning a promise
and a trailing `.catch()` never attaches. Every call therefore goes through a `try`/`catch` helper.
When a queue write fails the app keeps working in memory for the session but sets `queueDurable`
to false and says so on the sync screen. Silently downgrading would break the one promise
local-first makes: that edits survive a refresh.

## The read model

Screens never render the raw repo data. They render `state.data`, which is:

```
base snapshot  +  pending queue replayed on top  =  what you see
```

computed by `applyChanges` ([`merge.ts`](../src/core/store/merge.ts)) whenever either input
changes.

This is **CQRS** in miniature: the write model is a log of operations, the read model is the
materialised result, and they are different shapes. Concretely it means an unsynced edit is
indistinguishable from a synced one while you use the app — no "pending" ghost state, no screen
showing the old value, no way for an edit to look like it vanished. The only place the distinction
surfaces is the deliberate "unsynced" badge.

The same function produces the bytes we commit. Not a similar function — the same one, applied to
freshly fetched data. So what you saw on screen and what lands in the repo cannot diverge.

## Syncing

[`syncChanges`](../src/core/store/sync.ts), up to three attempts:

```
  ┌─► 1. read the repo FRESH, pinned to a commit sha
  │   2. replay the whole queue onto that data
  │   3. serialise only the tables whose bytes actually changed
  │   4. commit, refusing to move the branch if it shifted
  │        │
  │        ├── success ──► drop the sent changes, reload
  └────────┴── StaleHeadError ──► loop
```

Reading fresh *inside* the loop is the point. A conflict is not an error needing a merge UI — it is
a signal that our base was stale, and the fix is mechanically to rebase onto the newer base and try
again. Since operations are field-level, that rebase almost always succeeds silently.

Three details that matter:

**Only changed tables are written.** Each table is serialised before and after the replay and
compared. Identical bytes means it is left out of the commit, so a no-op edit produces no commit and
untouched tables are never reformatted.

**Only sent changes are dropped.** After a successful commit the queue is filtered by the ids we
actually sent, not cleared. An edit made while the request was in flight stays queued instead of
being silently discarded.

**Validation is advisory here.** `validateDataset` runs against the merged result and any issues are
reported on the sync screen, but they do not block the commit. Refusing to save your work because a
`design_id` points somewhere odd would be the wrong trade in an app whose whole point is capturing
squares quickly. CI is the enforcement point; see [operations](06-operations.md).

## Commit messages

Generated from the batch ([`message.ts`](../src/core/store/message.ts)):

```
Update 3 squares, remove 1 yarn

- save squares/S041 — Status: done, Main colour: Y004
- save squares/S042 — Notes: (blank)
- save squares/S043 — Position: row 3, col 2
- delete yarns/Y07
```

Subject line for `git log --oneline`, field-level detail in the body: each `save` line lists the
fields that row's `Change.values` actually touched (already a diff — see "Partial `values` is
load-bearing" above) with their field label and new value, `(blank)` standing in for an empty
string so a deliberate clear reads as one rather than looking like the line was cut off. `id` is
dropped from the list since it is already the row the line is addressing. Written for whoever reads
the history later, which is you: `git log` alone answers "what actually happened to S041", no diff
needed.

## Queue collapsing

`appendChange` folds a new operation into the last pending one for the same row where it can, so
editing a square five times before syncing leaves one operation rather than five. Rules:

- **upsert then upsert (same row)** → merge `values`, take the later timestamp
- **anything then delete** → the delete supersedes; earlier operations for that row are dropped
- **delete then upsert** → kept as two operations. Delete-then-recreate is a real sequence and
  collapsing it would change the meaning.
- **different rows, or same id in different tables** → never merged

Pinned by tests in [`queue.test.ts`](../src/core/__tests__/queue.test.ts).

## Failure modes

| What happens | Behaviour |
|---|---|
| Offline | Edits queue; Sync fails with a network error; nothing is lost |
| Token expired | 401 surfaces on the sync screen; queue is untouched |
| Branch moved | Re-read, replay, retry — up to 3 times, then reports it |
| Edited in the GitHub web UI meanwhile | Preserved: we replay onto the version that includes it |
| Same square edited on two devices | Both survive if different fields; same field is last-writer-wins |
| Same square, same field, two devices | Later sync wins. Not detected. See below. |
| Schema drops a table with queued edits | Those operations are skipped, stay queued, and are listed on the sync screen |
| Browser storage unavailable | Queue works in memory only; a banner warns that edits will not survive a refresh |

### The known gap

Two devices editing the *same field* of the same square: the later sync wins and the earlier value
is gone with no warning. Detecting it would mean storing the base value in the operation and
comparing at replay time — cheap to add, and worth doing if it ever actually bites. For a
single-person blanket tracker it has not been worth the UI it would need. Tracked as a follow-up
issue.

## Why not auto-sync

Considered, and rejected for v1. Auto-sync means a commit per burst of edits, background failures
you might not notice, and the app writing to your repo while you are not looking. Explicit Sync
keeps the git history legible and puts the "this is now permanent" moment where you can see it.

Because the queue is durable and the read model hides the distinction, the cost of deferring — the
usual argument for auto-sync — is close to zero. The one real risk is forgetting, which the
persistent unsynced badge in the header addresses.

Auto-sync remains easy to add later: it is a debounced call to the same `syncChanges`. Nothing about
the design would need to change.
