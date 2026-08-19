# ADR 0016 — A blank field inherits through a `ref` hop at read time, not a copied default

**Status:** accepted · 2026-08-18

## Context

A square needed a `construction_type` (`solid` / `holey`), and so did its design. The common case is
that every square made from a given design shares the design's construction type; the rare case is a
square that deviates and needs its own. That is an override-with-a-default problem: most rows want to
say nothing and mean "same as the thing I'm linked to," and a few rows want to say something specific
and mean "no, this one."

## Options

**Copy the design's value onto the square when it is created or the design is picked**, the way a
scaffolding tool might pre-fill a field. The square's own cell is never really blank — it is filled in
once and then just another stored value. Cheap to read (`filterFields`/`Display` already handle a
plain column), but it is the same materialised-view staleness problem [ADR 0015](0015-derived-filters-instead-of-a-materialised-column.md)
already rejected for the `source` filter: edit a design's construction type later and every square
made from it is now silently wrong until something re-copies it, and nothing in the sync engine's
field-level merge ([ADR 0004](0004-operation-log-not-file-snapshots.md)) was built to cascade an edit
on one table into rows of another.

**Leave the square's field genuinely blank and resolve it at read time by hopping the `ref` chain**,
the same mechanism `derivedFilters` already uses for the `source` filter — just applied to the field's
own value instead of a separate filter key. No copy, no write-side code, always correct because it
reads the design's current value rather than a snapshot of it from whenever the square was saved.

## Decision

`FieldDef` gains `inheritFrom?: { via, throughField }` — `via` names a `ref` field on the same table,
`throughField` names a field on the table it points at. Structurally identical to `DerivedFilterDef`
minus the standalone `key`/`label` a filter needs (the field already has both). `buildSchemaSet` checks
both ends the same way it checks `derivedFilters`: `via` must be a real `ref` field, `throughField`
must be a real field on the table it points at, checked once every schema is loaded so a typo in
either name fails the build instead of silently inheriting nothing.

`effectiveValue(schema, field, row, resolve)` (`core/schema/search.ts`) returns the row's own value,
or — only when that is blank *and* the hop actually finds something — the inherited value plus
`inherited: true`. A square pointing at a design that is itself blank still reads as "not set," not as
"inherited nothing," so the UI never claims an override exists when it doesn't.

Both places a field's value is shown call it: `RecordDetail` shows the resolved value with a small
"(from design)" note when it came from the hop, and `RecordForm` shows a live hint under a blank input
— read off the current draft, so picking a different design updates what blank would resolve to before
the form is even saved.

Blank values already pass `enum` validation when the field is not `required` (see the schema evolution
policy in [data model](../02-data-model.md#schema-evolution-policy)), so `inheritFrom` needed no
change to `validateValue` — leaving a field blank was already legal, this only makes it *mean*
something instead of meaning "unset."

## Consequences

- Editing a design's `construction_type` instantly changes what every square built from it — that
  hasn't overridden it — resolves to. One copy of the fact, nothing to go stale.
- Purely read-side computed state: nothing about saving, deleting, or the change queue's field-level
  merge has to know inheritance exists. A square's own stored value is still exactly what the CSV cell
  says; only the *display* and *form hint* resolve further.
- One hop only, same restriction `derivedFilters` accepted for the same reason: a field that needed to
  inherit through a chain of two `ref` hops would need a second mechanism, not built because nothing
  here needs it.
- Not built: filtering squares by *effective* construction type. `filterFields` matches a row's raw
  stored value, which would only ever match squares that explicitly override — filtering by whatever a
  square resolves to would need the filter machinery to call `effectiveValue` too, which is a real
  extension but not one this change needed.
