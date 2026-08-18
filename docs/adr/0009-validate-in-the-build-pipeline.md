# ADR 0009 — Validate data in the build pipeline, advise in the app

**Status:** accepted · 2026-08-17

## Context

CSV is schema-on-read: nothing stops a hand-edit introducing a duplicate id, a status that is not in
the schema, or a `main_yarn` pointing at a yarn that does not exist. Git accepts all of it. The app
is also expected to keep working when data is edited outside it, which is a stated requirement
rather than an edge case.

## Options

**Validate only in the app, on save.** Catches mistakes made through the UI, and nothing else —
which is exactly the class of edit most likely to be wrong, since hand-edits get no help.

**Validate in the app and block invalid saves.** Stricter, and wrong for this app: refusing to save
a square because a reference looks odd loses work in the situation where speed matters most.

**Validate in the build pipeline, failing CI.** Catches every route into the data, including the
GitHub web editor and a spreadsheet. Feedback arrives after the commit rather than before.

**Both, with one shared implementation.**

## Decision

Both, from one function. `validateDataset` runs:

- in [`scripts/build-data.ts`](../../scripts/build-data.ts) during the build, where issues **fail
  CI** and nothing deploys
- in `syncChanges` before a commit, where issues are **reported on the sync screen** but do not
  block

## Consequences

- This is a data contract test at the boundary where data enters the system, giving schema-on-write
  enforcement over a schema-on-read format.
- Sharing one implementation is the point. A reimplementation in the pipeline would drift, and the
  app would start believing things CI rejects.
- It forces `core/schema` and `core/csv` to stay free of React so they can run in Node. That
  constraint is why the interesting logic is unit-testable at all.
- Validation runs on every push, including data commits — which is the main reason data commits are
  not excluded from the workflow.
- Feedback on a bad hand-edit is a red CI run a minute later, not a rejected write. Acceptable: the
  fix is another commit, and the previous deploy stays live.
- `npm run validate-data` runs the check alone in seconds, for use before pushing.
