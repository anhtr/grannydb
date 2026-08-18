# ADR 0010 — Quick-create on the ref field, not folding designs into squares

**Status:** accepted · 2026-08-18

## Context

Most squares turn out to use a one-off design: a pattern tried once and never repeated. The
`design_id` ref means every one of those still needs a trip to a separate "new design" screen before
the square that uses it can even be created, which is the wrong amount of ceremony for a record whose
only real content is a name.

Some designs genuinely are reused — the same pattern worked more than once, e.g. a "classic granny"
tried across several squares — so the pain is real but not universal.

## Options

**Fold design fields into squares.** Remove the `designs` table; put `name`/`source`/`source_url`/
`notes` directly on each square row. Removes the trip to a second screen entirely, but duplicates that
text across every square sharing a pattern, loses "which squares use this design" as a lookup instead
of a substring scan, and is a real data migration: existing `design_id` references have to be resolved
and inlined, `squares.json` grows four fields, and every doc page describing the three-table model
needs rewriting.

**Leave it as is.** No cost, but the friction stays for the common case.

**Add inline quick-create to the `ref` field.** Keep `designs` as its own table — still the right call
for the squares that do reuse a pattern — but let a square's edit form create a design without
navigating away. Low cost, no migration, and the "which squares share a design" lookup survives for
the rows that actually share one.

## Decision

Quick-create. A `ref` field can now set `"quickCreate": true`
([`data/schema/squares.json`](../../data/schema/squares.json), on `design_id`); `RefSelect` in
[`ui/fields.tsx`](../../src/ui/fields.tsx) then renders a "+ New &lt;thing&gt;" affordance beneath the
`<select>`. Opening it asks for one value — the target table's title field, `name` for designs — and
on submit calls the same `appStore.save` a normal edit uses, then selects the new row. Nothing else
about the design is captured inline; source, a link, notes are still filled in later from the Designs
screen if it turns out to be worth reusing.

## Consequences

- The `designs` table, its schema, and the "which squares use design X" query are unchanged — this is
  additive, not a migration.
- `quickCreate` is a field-level flag rather than a new field *type*, so it needed one parsed key in
  [`core/schema/load.ts`](../../src/core/schema/load.ts) plus the `FieldDef` shape in
  [`core/schema/types.ts`](../../src/core/schema/types.ts), not a new entry in the type registry.
- A quick-created row only has its title set. Good enough to reference immediately; anything else
  about it is deferred, on the assumption that most such rows will in fact stay one-offs and never
  need the rest filled in.
- `ui/fields.tsx` now imports `appStore` to create the row. `RecordForm.tsx` already did, so this is
  not a new dependency direction, just a second caller.
