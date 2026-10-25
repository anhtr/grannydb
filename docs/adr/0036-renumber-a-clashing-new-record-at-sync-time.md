# ADR 0036 — A new record whose id is taken is renumbered at sync time

**Status:** accepted · 2026-10-24

## Context

Ids are assigned on the device: `nextId` takes the highest id in the data the device last read,
plus one. Nothing checked that id against the repo. Two devices offline at once could both create
`S120`, and so could one device reading a stale copy. That second case actually happened, through
the cached branch head fixed in [ADR 0035](0035-never-cache-the-branch-head.md).

A new record and an edit are queued identically, as field-level upserts
([ADR 0004](0004-operation-log-not-file-snapshots.md)). So the second `S120` did not appear as a
duplicate. Its fields were written over the first square's, and one square silently became the
other. The owner noticed and repaired it by hand, but the overwritten values were lost.

ADR 0035 removed the cause that bit. The gap underneath it remains: an id handed out on a device is
a guess about the repo.

## Options

**A UUID as the real key, with the readable id as a label.** The standard surrogate-key pattern,
and it does make "same record" and "two records with one label" distinguishable. But the links
between tables are readable ids (`design_id` is `D03`). If they stay readable, the UUID detects a
clash without resolving which `S120` a link means, so the links still need rewriting. If links move
to UUIDs, hand-editing the CSVs in a spreadsheet becomes impractical, and that is a primary use case.
Either way every table gains a column for one rare event.

**Let CI find and fix duplicates after the fact.** Too late in two ways. Under upsert semantics the
repo never holds two `S120` rows to find, only one row already overwritten. And fixing it after the
push renumbers an id that has been published: it may be in the commit history, in notes, or on a
sticky note. Ids are permanent once used. A bot committing to `main` would also race the devices it
was cleaning up after.

**Per-device id ranges or prefixes** (`S120a`, or each device numbering from its own block). Avoids
the clash entirely. But ids stop being one readable sequence, which is most of what makes them
useful on paper.

**Mark new records, and settle the id at sync time.** The queued change for a record that does not
exist yet carries `create: true`. The sync already reads the repo fresh before every attempt. At that
point a flagged id the repo already holds is moved to the next free one, along with every queued
reference to it, before anything is published. This needs no new column or CSV change, and the
readable sequence is kept.

## Decision

The flag. `AppStore.save` sets it when the record does not exist yet, and edits that collapse into
the change keep it. `resolveIdClashes` (`core/store/renumber.ts`) runs inside the sync loop against
each attempt's fresh read, so a retry after the branch moved re-checks against the newer data. It
renumbers to the next id free in both the repo and the queue, and rewrites `ref`/`reflist` values in
queued changes. Rows already in the repo are never touched: a reference there to the id meant the
record that genuinely holds it. `renumberChanges` applies the same rewrite to edits queued while the
push was in flight. What moved is kept in `LastSync.renumbered` and shown on the Sync screen.

Replay must stay idempotent. A sync can land its commit and be killed before trimming the queue, and
the next sync then finds "its" id already in the repo. That case is recognised by content: if every
field the create sets already reads the same in the repo, it is this device's own record and nothing
is renumbered.

## Consequences

- A new record can no longer overwrite an existing one, whichever device or stale read handed out
  its id.
- The id shown on a device before syncing is provisional. It can change at the push, and the Sync
  screen says when it has. An id written on a sticky note before syncing could end up meaning
  another record; the note on the Sync screen says so.
- The idempotency check is a judgement by content. If another device's record had exactly the same
  values in every field this one sets, it would be taken as this device's own, and the two would
  merge into one row. That needs the same id, from two devices, with identical contents, in the same
  window. The alternative, a persisted in-flight marker cleared after the queue is trimmed, is more
  machinery than that case justifies.
- Changes queued before this version have no flag and sync exactly as before.
- A reference to the old id typed into a free-text field (notes) is not rewritten. Only `ref` and
  `reflist` fields are structured enough to rewrite safely.
