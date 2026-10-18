# ADR 0028 — Project start date and target are synced data in `project.json`

**Status:** accepted · 2026-10-17 · supersedes [ADR 0017](0017-device-local-goal-override.md)

## Context

The project start date and the target square count were device-local: values in `localStorage`
(`Prefs.projectStartDate`, `Prefs.squaresGoal`), with the target falling back to `"goal": 400` in
`data/schema/squares.json`. [ADR 0017](0017-device-local-goal-override.md) chose that knowingly, and
named its cost: "not shared across devices."

That cost turned out to be the wrong trade. The start date and the target are facts about the
blanket, not about how one phone likes to look at it. Set them on the phone, open the laptop, and
Progress shows a different pace and a different "X / target" — or none at all. A new browser, a
cleared site-data, or a reinstalled PWA silently loses them. They belong with the rest of the data:
in the repo, the same on every device, and changed through a commit you can see in the history.

The values for this project: started 2026-07-03, aiming at 400 squares.

## Options

**A one-row CSV table (`data/project.csv`) with a schema.** Free reuse of everything: the generic
form, the row queue, CSV validation, unknown-column preservation. But it is a table in shape only —
a header, an id column and one record that must never become two — and it would surface in the
manifest, the nav (or need `hideFromNav`), `nextId`, and every place that iterates tables, each of
which would need to know not to treat it as a collection. Shaping the data to fit the machinery,
rather than the other way round.

**Write `squares.json`'s `goal` back to the repo.** Rejected in ADR 0017 for reasons that still
hold: schemas are hand-maintained structure, not data the sync engine should rewrite. And it only
covers the target — the start date has no schema to live in.

**Keep them device-local.** The status quo, and the problem.

**A small JSON document, `data/project.json`, edited through a second kind of queued operation.**
One object, keys for what the project is. Reads, validation, the bundle and sync each learn about
one more file; the queue learns one more operation shape.

## Decision

`data/project.json` holds `start_date` and `target_squares`. It is:

- **Read** by every read path at the same pinned sha as the CSVs (`Snapshot.project`), carried in
  the build bundle and the offline snapshot cache. Optional: a 404 reads as `{}`, so a branch from
  before the file existed still loads.
- **Edited** through a new `DocChange` — `{ op: 'set', doc: 'project', values }` — that records
  only the keys that changed, as row edits do. `Change` becomes `RowChange | DocChange`, told apart
  by `op`, so queues already in IndexedDB (row operations with no other tag) read unchanged.
- **Merged** by `applyProjectChanges` into `state.project`, the read model Settings and Progress
  render from — the same base-plus-queue rule as `state.data`.
- **Written** by `syncChanges`: replayed onto the freshly read file inside the same retry loop, and
  included in the same single commit when its serialised form differs.
- **Validated** by `validateProject`, called both by the build pipeline and at sync, like
  `validateDataset`.
- **Round-trip safe**: the app keeps the parsed object and only sets the keys it changes, so a key
  added by hand survives — invariant 2, applied to JSON.

`Prefs` loses both fields, and `TableSchema.goal` (and `"goal"` in `squares.json`) is removed, so
there is one source of truth for the target. Settings still shows and edits both values; without a
token they are shown read-only, like every other record.

## Consequences

- One start date and one target, everywhere. Changing either is a commit, visible in `git log` with
  a "Update project settings" subject and the new values in the body.
- Editing them now needs a token and a sync, where before it was instant and local. For values that
  change a handful of times over the project's life, that is the right side of the trade.
- Values set in `localStorage` before this change are not migrated: they are dropped from `Prefs` on
  the next save. The repo's `project.json` starts with the values above.
- The queue now has two operation shapes. Every consumer of `Change` narrows on `op` (`isRowChange`
  for the row-only paths: pending markers, `tablesTouched`, `applyChanges`). A third shape would
  push towards a more general "document" abstraction; two does not justify one yet.
- Concurrent edits to *different* keys merge, and to the same key resolve last-writer-wins, exactly
  as fields on a row do. Pinned by the `project.json` tests in `sync.test.ts`.
