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

That is a row operation. The queue holds a second kind, for the one piece of data that is not a CSV
row — [`project.json`](../data/project.json) (start date, target squares, time zone):

```ts
interface DocChange {
  id: string
  ts: number
  op: 'set'
  doc: 'project'
  values: Record<string, string | number | null>   // ONLY the keys that changed; null removes one
}

type Change = RowChange | DocChange   // told apart by `op`
```

Same rule, same reasons: it records the keys you changed, not the document you were looking at, so a
start-date edit on the phone and a target edit on the laptop both survive. `op` is the discriminator
because queues already sitting in IndexedDB hold row operations with no other tag, and they must
still read correctly. See [ADR 0028](adr/0028-project-settings-as-a-synced-json-document.md).

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
changes. `state.project` is the same thing for `project.json`, via `applyProjectChanges` — the
Settings and Progress screens read the start date and target from it, so a saved but unsynced
target is already the one the Progress bar is drawn to.

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

**The reload reads the commit just made.** After a successful push, `appStore.sync` reloads at
`result.sha` instead of asking GitHub for the branch head again, so the screen can never show data
from before the push (see [storage](03-storage-layer.md#the-cache-is-content-addressed)).

**Only sent changes are dropped.** After a successful commit the queue is filtered by the ids we
actually sent, not cleared. An edit made while the request was in flight stays queued instead of
being silently discarded.

**A new record whose id is taken is renumbered, not merged.** A new record and an edit are both
field-level upserts, so on their own they cannot be told apart at replay: a new `S120` from this
device would be written over an `S120` another device pushed first, field by field, and one square
would silently become the other. So `AppStore.save` marks the change for a record that does not
exist yet with `create: true` (later edits collapse into it and keep the flag), and before each
attempt's replay `resolveIdClashes` ([`renumber.ts`](../src/core/store/renumber.ts)) checks every
flagged change against the fresh read. An id the repo already holds moves to the next id free in
both the repo and the queue, and every queued `ref`/`reflist` value pointing at it moves too — a
square queued with a quick-created design follows the design. Edits made while the push was in
flight are rewritten the same way afterwards (`renumberChanges`). The result lists what moved
(`SyncResult.renumbered`, kept in `LastSync`), and the Sync screen says so until the next sync.

Two things keep this from misfiring. Only a flagged change is ever renumbered: an edit is *meant*
to land on the row that holds its id. And a flagged change whose every field already reads the same
in the repo is taken to be this device's own record, pushed by a sync that was killed before it
could trim the queue — so replaying it commits nothing, as replaying anything already committed
must. This is a **compare-and-set on identity**, the same move as the fast-forward check on the
branch: the device proposes an id, the repo's current state decides whether it stands.

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
- **project `set` then project `set`** → merge `values` into the last pending one. There is no
  delete to order against, so this is always safe.

Pinned by tests in [`queue.test.ts`](../src/core/__tests__/queue.test.ts).

## Failure modes

| What happens | Behaviour |
|---|---|
| Offline | The app still opens and renders the last snapshot saved on the device, with the queue replayed on top; edits queue as usual; an automatic push stands down silently, a manual Sync reports the connection; nothing changes |
| Back online | The app re-reads if it was showing the device's copy, and pushes the queue straight away |
| Automatic push fails for another reason | Reported like a manual failure: `syncError` on the sync screen, and the header badge turns amber |
| App frozen or killed mid-push | Safe: the ref only moves on the final fast-forward, the queue is only trimmed after a success, and replaying already-committed operations commits nothing |
| Browser clears storage | Asked against on the first edit of a session with `navigator.storage.persist()`; Settings shows whether it was granted |
| Token expired | 401 surfaces on the sync screen; queue is untouched |
| Branch moved | Re-read, replay, retry — up to 3 times, then reports it |
| Edited in the GitHub web UI meanwhile | Preserved: we replay onto the version that includes it |
| Same square edited on two devices | Both survive if different fields; same field is last-writer-wins |
| Same square, same field, two devices | Later sync wins. Not detected. See below. |
| Two devices add a record with the same new id | The later sync renumbers its record to the next free id, with its queued references, and the Sync screen lists the move |
| Schema drops a table with queued edits | Those operations are skipped, stay queued, and are listed on the sync screen |
| Browser storage unavailable | Queue works in memory only; a banner warns that edits will not survive a refresh |

### The known gap

Two devices editing the *same field* of the same square: the later sync wins and the earlier value
is gone with no warning. Detecting it would mean storing the base value in the operation and
comparing at replay time — cheap to add, and worth doing if it ever actually bites. For a
single-person blanket tracker it has not been worth the UI it would need. Tracked as a follow-up
issue.

## Automatic sync

v1 made syncing a button and argued against automating it: a commit per burst of edits, background
failures you might not notice, and the app writing to your repo while you are not looking. Because
the queue is durable and the read model hides the distinction, deferring cost almost nothing; the
one risk was forgetting. Once the app installed and opened offline, forgetting became the normal
case — the edits made on the train are exactly the ones nobody remembers to push — so the queue now
pushes itself. See [ADR 0032](adr/0032-sync-automatically-when-there-is-a-connection.md).

It is the same `appStore.sync`, called by a policy in
[`autoSync.ts`](../src/core/store/autoSync.ts) instead of a button. Nothing about the engine
changed, which is what the v1 design promised: "a debounced call to the same `syncChanges`".

**When.** 30 seconds after the last queued edit (each edit resets the timer); immediately when
`online` fires, when the app is hidden, when it is shown again, and at start-up if a queue is
waiting. The debounce is the **group commit** pattern: many small writes, one durable flush, so
entering a square's four fields is one commit rather than four. The no-delay triggers are the
moments a phone gives you — leaving the app is the last chance before the OS freezes it, and a
frozen app misses `online`, which is why coming back to it counts as a trigger too.

**What it reports.** Not reaching GitHub is the expected state offline, so an automatic attempt that
fails with a `NetworkError` leaves no error behind — the queue already says what is waiting, and the
next trigger tries again. Every other failure (expired token, branch that kept moving) will not fix
itself by waiting, so it surfaces exactly as a manual failure would and turns the header badge
amber. A manual Sync always reports, offline included: you asked, so you get an answer.

**Why trying again whenever is safe.** Replay is **idempotent**. If a push is cut off after the ref
moved but before the page heard, the queue is still there; the next sync replays the same
field-level operations onto a repo that already has them, the tables serialise to the same bytes,
and nothing is committed. The page then drops the queue as synced.

**Opting out.** Settings → This device → Sync automatically, per device. A laptop you hand-edit CSVs
from, or `npm run dev` pointed at the real repo, may well want it off; then the Sync button is the
only path, as in v1.

When the device comes back the app also **re-reads** — guarded to the case where the snapshot on
screen came from the device's cache, since that is the one the network was actually blocking.
(`navigator.onLine` reports whether there is an interface, not whether GitHub is reachable — true on
a captive portal — so `true` permits an attempt, never a conclusion. `false` is trusted, and skips
an attempt that cannot succeed.)

### Keeping the queue on the device

IndexedDB is best-effort by default: a browser may evict it under storage pressure, and Safari clears
it for a site not visited in seven days unless it is installed. For the snapshot that costs a reload;
for the queue it loses edits that exist nowhere else. So the first edit of a session asks for
**persistent storage** ([`persistence.ts`](../src/core/store/persistence.ts)). Firefox may show a
prompt; Chrome and Safari decide silently and grant it to installed apps. Settings → This device →
Storage shows the answer.
