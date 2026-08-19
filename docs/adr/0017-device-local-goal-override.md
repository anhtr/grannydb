# ADR 0017 — The squares goal is a device-local override, not a schema edit

**Status:** accepted · 2026-08-19

## Context

[Issue #1](https://github.com/anhtr/grannydb/issues/1) asked for the blanket's target square count —
`squares.json`'s `"goal": 400` — to be editable from the Settings tab, alongside the project start
date and the data location, both of which already work this way (device-local values in
`localStorage`, overriding a baked-in default; see [ADR 0008](0008-single-repo-with-configurable-data-location.md)
for data location, `core/prefs` for the start date).

## Options

**Make the app write `data/schema/squares.json` back to the repo**, the same commit path
`appStore.sync()` already uses for table data. Changing the goal would then be a real, synced,
shared edit — every device sees the new target immediately after a pull.  This needs a second
write path alongside the existing one (schemas are currently loaded once at startup and never
written to), plus a reason to trust an edit to a *schema* file the same way the app trusts an edit
to a *data* row — schemas are hand-maintained and validated as part of the build, not part of the
sync engine's remit. Disproportionate for one number.

**A device-local override in `Prefs`, read instead of the schema's `goal` when set.** Same shape as
`projectStartDate` and `RepoConfig`: a `localStorage`-backed value with a schema-provided default,
edited in Settings, requiring no new write path and no change to what sync considers safe to touch.

## Decision

`Prefs` (`core/prefs`) gains `squaresGoal: number | null` — `null` means "use the schema's `goal`."
`effectiveGoal(schema, prefs)` resolves it (`prefs.squaresGoal ?? schema.goal ?? 0`); the Progress
header (`SquaresPage.tsx`) and the Stats screen both call it instead of reading `schema.goal`
directly. Settings → Project gains a "Target squares" number field next to "Start date," sharing
one Save button — both fields being dirty enables it, and saving writes both into `Prefs` together.

## Consequences

- No new write path: the goal override never touches the repo, so it carries none of the sync
  engine's concerns (conflicts, commit messages, validation) that a real schema edit would.
- Not shared across devices — each device sets its own override, the same trade-off
  `projectStartDate` already makes. For a single-person tracker this is the right default; a second
  person using the same deployment would need to set it again on their device.
- The schema's `"goal": 400` stays meaningful as the actual default new deployments start with, since
  nothing overwrites it — a fresh clone with no `Prefs.squaresGoal` set sees exactly what the schema
  says.
