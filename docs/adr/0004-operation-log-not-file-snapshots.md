# ADR 0004 — Store pending edits as an operation log, not as file snapshots

**Status:** accepted · 2026-08-17

## Context

Edits are made on a phone, often with poor or no signal, and pushed later. Meanwhile the repo can
change: a laptop syncs, or a CSV is edited directly in the GitHub web UI. The queue must survive a
refresh and must not destroy work done elsewhere.

## Options

**Queue the resulting file.** Store "here is what `squares.csv` should be" and push it. Simple, and
a data-loss bug: the file was read at some earlier point, so pushing it reverts everything that has
happened since. The longer an edit sits queued, the more it destroys — exactly backwards for an
offline-first app.

**Queue whole-row operations.** `{op: 'upsert', rowId: 'S042', values: <every field>}`. Much better:
rows we did not touch survive. But a stale blank `position` in our copy of the row still overwrites
a `position` set on another device.

**Queue field-level operations.** Record only the fields that actually changed. Concurrent edits to
different fields of the same row both survive.

**Commit immediately on every save,** avoiding the queue entirely. No merge question at all, but
requires signal for every edit and produces a commit per field-edit session.

## Decision

Field-level operations in a durable log (IndexedDB), replayed onto freshly fetched data at sync
time.

```ts
interface Change {
  id: string; ts: number
  table: string; op: 'upsert' | 'delete'; rowId: string
  values?: Record<string, string>   // only the fields that changed
}
```

Syncing re-reads the repo, replays the log, writes the result, and retries on a moved branch.

## Consequences

- This is a write-ahead log and log replay — event sourcing at the smallest scale where it pays.
- Field-level last-writer-wins is the simplest useful CRDT register. Different fields of the same
  row merge; the same field resolves deterministically.
- A commit conflict stops being an error state. It is a signal to re-read and replay, so no merge UI
  is needed.
- The same replay function produces both the on-screen read model and the committed bytes, so what
  you saw and what lands cannot diverge.
- `appStore.save` must diff against the current row to compute `values`. Storing the whole row would
  quietly reintroduce the overwrite bug.
- Known gap: two devices editing the *same* field, later sync wins with no warning. Detectable by
  storing the base value in the operation; not built, tracked as a follow-up.
- Rejected auto-sync for v1 — see the sync engine doc. It remains a debounced call to the same
  function whenever it is wanted.
