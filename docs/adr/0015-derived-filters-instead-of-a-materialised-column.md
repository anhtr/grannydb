# ADR 0015 — Derived filters hop through a `ref` at read time, not a materialised column

**Status:** accepted · 2026-08-18

## Context

The squares list needed a filter by source ("everything from this book"), but `squares` does not
store a source — it stores `design_id`, and the design stores `source`. Filtering by source means
reading through that chain: square → design → source.

## Options

**Add a `source_id` column to `squares.csv`, copied from the design at save time.** Fast to filter
(`filterFields` already handles a plain column) but it is a second copy of the same fact: change a
design's source and every square that cites that design is now wrong until something re-derives it,
and nothing in the sync engine's field-level merge (see [ADR 0004](0004-operation-log-not-file-snapshots.md))
was built to cascade an edit on one table into rows of another. This is the classic materialised-view
staleness problem, and the write side to keep it correct — a migration on every design edit — is a lot
of machinery for one filter dropdown.

**Compute it at read time by hopping the ref chain**, same as `titleFor` already does one hop for a
`ref` field's display label. No new column, no write-side code, always correct because it reads the
current `design.source` rather than a snapshot of it from whenever the square was saved.

## Decision

A `derivedFilters` array on `TableSchema`: `{ key, label, via, throughField }`, where `via` names a
`ref` field on this table and `throughField` names a field on the table `via` points at.
`squares.json` sets `[{ "key": "source", "label": "Source", "via": "design_id", "throughField":
"source" }]`. `buildSchemaSet` checks both ends exist — `via` is a real `ref` field, `throughField` is
a real field on the table it points at — the same place and the same way the existing `refTable`
check runs, so a typo in either name fails the build instead of silently filtering nothing.

`derivedFilterValue` (`core/schema/search.ts`) reads a row's value for the filter by resolving `via`
then reading `throughField` off the result; `RecordList` builds its options and their (resolved)
labels from that function the same way it already does for a direct `ref` filter.

## Consequences

- Editing a design's source instantly changes what every square built from it filters as — there is
  only one copy of the fact, so there is nothing to go stale.
- The filter is read-only computed state: nothing about deleting or renaming a square, or about the
  change queue's field-level merge, has to know a derived filter exists.
- One hop only. A filter that needed to chase `via` through a second `ref` would need a second
  mechanism — not built, because nothing in this app needs it yet, and the one-hop version stays a
  three-key schema object instead of growing into a small query language.
