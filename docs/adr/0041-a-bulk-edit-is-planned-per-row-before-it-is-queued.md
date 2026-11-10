# ADR 0041 - A bulk edit is planned per row before it is queued

**Status:** accepted · 2026-11-10

## Context

Squares are finished one at a time and blocked a dozen at a time: pinned out together on one
evening, entered into the tracker whenever that is remembered. Until now that was twelve visits to
twelve forms, each setting the same status and the same date.

A list can now have rows ticked and one field set on all of them. That raises two questions the
single-record form never had to answer. What goes in the change queue for "set status to blocked on
these twelve"? And what happens when the edit is fine for ten of them and breaks a rule on two - a
square whose done date is *after* the day being entered for blocking?

The status field is the hard case, and the common one. Changing a status is not one write: it fills
the new status's date where blank, fills the dates of statuses it implies, and clears the dates of
later ones (`changeStatus`). So the same instruction produces different writes on different rows.

## Options

**One operation that carries the intent**: a new queue entry, `{ op: 'bulk', rowIds, field, value,
date }`, expanded into row writes when the queue is replayed. It is small, it reads well in the
Pending changes screen, and replaying against fresh data means its rules run on what the rows hold
*at sync*, not what they held when the button was pressed. But it puts rule evaluation inside
replay. Replay today is a dumb fold of field writes over CSV rows, which is why the same few lines
serve the screen, the sync and the tests; an operation whose effect depends on schema rules would
have to be understood identically by all of them for ever, including by any later version reading a
queue an older version wrote. And nobody would have seen what it finally did: the preview would be a
guess about a future state. Rejected.

**Whole rows**: compute each row's new contents and queue those. Simple, and exactly the whole-row
write that [ADR 0004](0004-operation-log-not-file-snapshots.md) exists to prevent - a bulk status
change would silently revert another device's edit to the notes of every row in the batch.
Rejected.

**All or nothing**: if any row would break a rule, refuse the whole batch. Easy to explain, and it
makes the feature useless at the moment it is wanted: one odd square out of forty blocks the other
thirty-nine, and the way round it is to hunt for the odd one by hand. Rejected.

**Write everything and let validation catch it**: queue the edit for all rows and leave the two bad
ones to fail the data check at sync or deploy. The form already refuses to save a row in that state;
a bulk edit that could would be a way round the form. Rejected.

**Plan per row, at the moment of the edit; queue only the rows that pass.**

## Decision

`planBulkEdit` (`core/schema/bulk.ts`) is a pure function from (schema, rows, field, value, date) to
a plan: `writes` (one entry per row, holding only the fields that differ), `unchanged` (already
there) and `skipped` (would break a rule, with the rule's message), or a single `error` when the
value itself is invalid. It reuses what the form uses - `validateValue`, `changeStatus`,
`statusDateIssues` - so a row is treated the same whether it is edited alone or in a batch.

The dialog shows that plan as a live preview and Apply hands `plan.writes` to `appStore.saveMany`,
which folds one ordinary field-level upsert per row into the queue (`queueRowEdits`) and persists
the queue once. Skipped rows stay ticked in the list afterwards.

For a status that writes a date the dialog asks **which day**, defaulting to today, and passes it
where the form passes today.

## Consequences

- Nothing new exists downstream of the dialog. The queue, replay, the Pending changes screen, the
  commit message and CI all see ordinary edits to individual rows, and they merge with another
  device's edits field by field like any others.
- What was previewed is what is queued, to the field.
- The plan is made against the data on this device at that moment. If another device changes one of
  the rows before the sync, the two sets of field writes merge; the rules are not re-run, exactly as
  they are not for two single edits. That is the existing known gap, not a new one.
- A batch is as many queue entries as rows, so Pending changes lists forty lines for forty squares.
  Honest, if long.
- The queue is written once per batch, so the batch is in the queue whole or not at all. It is not
  one *commit* by construction - a sync that starts between two batches pushes them separately - but
  a single batch always travels together.
- One field per pass, and no bulk delete. Both would multiply what one mistaken tap can do; a second
  pass through the dialog is cheap.
