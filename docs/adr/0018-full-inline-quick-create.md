# ADR 0018 — Quick-create becomes a full inline form, not title-only

**Status:** accepted · 2026-08-19

## Context

[ADR 0010](0010-quick-create-instead-of-folding-designs.md) gave a `ref` field's picker a "+ New
&lt;thing&gt;" affordance that creates the target row with only its title field set, on the
assumption that the rest — a design's source, a source's type/URL/note — would usually stay
unfilled or get filled in later from that table's own screen. In practice the deferred fields turn
out to matter at the exact moment the quick-create is used: adding a square for a design not yet on
file is also the moment its source and construction type are known, and typing a new source is also
the moment its type and URL are on hand. Deferring them means a second trip through the Designs or
Sources screen for almost every quick-created row, which is the same friction ADR 0010 was written
to remove, one level down.

## Options

**Leave it title-only, add a shortcut to the created row's screen.** Smallest change — surface a
"finish setting up" link after creating — but still a second screen, just one tap closer.

**A separate, purpose-built "quick" form per table**, hand-picking which fields are worth asking for
inline. Could hide genuinely rare fields, but is a second, hand-maintained field list per table to
keep in step with the schema — exactly the duplication [ADR 0005](0005-schema-as-data.md) exists to
avoid.

**Reuse every field on the target schema, rendered with the same `fieldRenderers` the main record
form uses.** No new field list to maintain — the quick-create form is just `RecordForm`'s field loop,
scoped to one `ref` field's target instead of the whole page. A `ref` field inside it (`designs.source`)
gets the same treatment recursively, so the "+ New source" nested inside "+ New design" is not special
cased, it falls out of reusing the same component.

## Decision

Full inline form. `QuickCreate` in [`ui/fields.tsx`](../../src/ui/fields.tsx) now builds a draft over
every field on `refTable`'s schema except its id (assigned on save, same as the main form), renders
each with `rendererFor(field).Input` inside a `FieldShell`, and validates with the same
`validateValue` the main form uses before calling `appStore.save`. Referential checks need each
table's known ids, previously computed inline in [`RecordForm.tsx`](../../src/ui/RecordForm.tsx); that
became `useRefIds()` in [`app/hooks.ts`](../../src/app/hooks.ts) so both callers share it instead of
each recomputing the same map.

Because the `ref` field renderer is reused rather than reimplemented, a `ref` field on the
quick-created row that itself has `quickCreate: true` opens its own nested quick-create the same way
— `designs.source` does this automatically, no code written specifically for it. Nothing stops a
third level if a future table's chain goes that deep; nothing was built to prevent it either, since
the recursion is just the existing component calling itself through the schema.

The affordance still opens collapsed as a single "+ New &lt;thing&gt;" link — the cost this change
removes is the *second screen*, not the initial one-line trigger, so a design or square someone
genuinely wants to leave sparse still can.

## Consequences

- [ADR 0010](0010-quick-create-instead-of-folding-designs.md)'s "only the title is set" is no longer
  true; its Consequences section now points here.
- [ADR 0012](0012-hidden-tables-for-lookup-only-data.md)'s note that a source's `type`/`url`/`note`
  could only be filled in by opening the source itself is similarly out of date — they can now be set
  the moment the source is quick-created, inline.
- `QuickCreate` depends on `useRefIds()`, `validateValue`, and `rendererFor` — the same three things
  `RecordForm` depends on — so the two are now more clearly two callers of one set of primitives
  rather than a full form and a deliberately-thin cousin.
- A quick-created row can now fail validation (a required field left blank, a `ref` pointing nowhere)
  the same way the main form can, surfaced the same way (an error under the field, not a toast) —
  previously the only possible failure was an empty title.
- No schema or storage change: this is entirely a `ui/fields.tsx` behaviour change over the same
  `quickCreate: true` flag `squares.design_id` and `designs.source` already set.
