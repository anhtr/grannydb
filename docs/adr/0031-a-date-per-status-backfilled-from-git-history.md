# ADR 0031 — A date per status, backfilled from git history

**Status:** accepted · 2026-10-18

## Context

A square had one `date`. For a done square that meant "when it was crocheted"; once it was blocked,
nothing recorded when that happened. The owner wants the pace of *blocking* once every square is
crocheted, which needs the second date — and while adding it, a date for every status, with only
the dates that matter required.

## Options — the shape

**A status-history table** (`square_id, status, date` rows). The textbook event log: any number of
transitions, regressions and all. But it is a join to answer the commonest question ("when was S120
done?"), a second file to keep consistent with `squares.csv` on every status change, and much worse
to hand-edit in a spreadsheet, which is a primary use case here. A square has at most four stages
and passes each once.

**Derive the dates from git at read time.** No schema change at all — but it needs the commit
history over the API on every load, can't be corrected when a commit date is wrong, and disappears if
the data ever moves repo.

**One date column per status.** Four columns, one row per square, edited in place like any field.
Chosen. Its cost is that a status reached twice (done → in progress → done again) keeps only the
latest date; for squares that is a feature, not a loss.

## Options — the rules

"At least one date" alone would let a blocked square carry only a planned date and fall out of a
blocking pace. So the rule is the **current status's date is required**, which implies at least one;
dates for later statuses are rejected; the dates present must run in workflow order. They are
declared as schema data (`statusDates`) rather than hard-coded for squares, in keeping with
[ADR 0005](0005-schema-as-data.md), and run in the same `validateDataset` the build uses.

## Backfill

[`scripts/migrate-status-dates.ts`](../../scripts/migrate-status-dates.ts) replayed all 94 committed
versions of `squares.csv`:

- added as blocked → the date is both done and blocked (64 squares);
- added with another status → the date is that status's;
- status changed with the date untouched → the new status gets the commit's day **in the project's
  time zone**. This matters: the largest blocking batch was committed at 00:59 UTC on 1 October,
  which was the evening of 30 September in Chicago;
- status and date changed in the same commit → the edited date goes to the new status;
- date changed alone → a correction to whichever status the column was then recording.

Two things the replay had to get right that a quick reading of history gets wrong. The first five
ids were sample rows deleted the day after the first commit and then reused for real squares, so a
square's history restarts when its id disappears. And the very first version kept `blocked` as a
separate yes/no column.

The result: all 191 finished squares' `done_date` equals their old `date`, so every pace figure is
unchanged; 23 squares have a blocked date from the commit that blocked them.

## Consequences

- **Backfilled blocked dates are "synced by" dates.** A commit records when a change reached GitHub,
  not when it was made; for this history that was within hours, but it is an upper bound.
- **The 64 squares entered as blocked carry no information about blocking** — their blocked date is
  their done date. A blocking pace is only meaningful from mid-September 2026 onwards.
- **This was a rename done in one step**, against the usual two-step in the data model's evolution
  policy, because the schema and every row changed in the same commit, so no reader ever sees one
  without the other. The remaining exposure is a device with *queued* edits to `date` made before
  the change: replaying them would write a stray `date` column back (the writer keeps unknown
  columns). Sync every device before this deploys, or delete that column afterwards.
