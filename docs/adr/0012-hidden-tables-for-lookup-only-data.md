# ADR 0012 — A `hideFromNav` flag, not a second class of table

**Status:** accepted · 2026-08-18

## Context

`designs.source` was a free-text field, typed out on every design even though the same handful of
books and websites come up over and over. Factoring it into its own `sources` table (`name`, `type`,
`url`, `note`) fixes the retyping, but a `ref` field's target has to be a real entry in
`schemas.order` — [`buildSchemaSet`](../../src/core/schema/load.ts) checks every `refTable` against
the built table map, and `App.tsx` resolves every route generically from that same list. There is no
way to reference a table that is not in the manifest.

The catch: a source is rarely worth a screen of its own. There are a handful of them, they are
mostly picked once and forgotten, and a fourth bottom-nav tab for a table this thin is clutter on a
four-item tab bar that is already `squares` / `yarns` / `designs` / progress / settings.

## Options

**Leave `source` as free text.** No schema change, but the retyping — the actual complaint — is
unsolved, and nothing stops "Attic24" and "attic24" from being two different values that `filter`
treats as unrelated.

**A parallel, non-schema mechanism for lookup tables** — e.g. a second manifest file, or a table
loaded outside `schemas.order` and special-cased in the components that need it. Solves the nav
problem but reintroduces exactly what [ADR 0005](0005-schema-as-data.md) removed: a second code path
that the generic list/detail/form/route machinery does not know about, which has to be kept in step
by hand every time it changes.

**A `hideFromNav` flag on `TableSchema`.** The table is a completely ordinary member of
`schemas.order` — full CRUD, full validation, addressable at `/sources/:id` — except `BottomNav` in
`App.tsx` filters it out of the tab list.

## Decision

`hideFromNav`. Added to `TableSchema` in
[`core/schema/types.ts`](../../src/core/schema/types.ts), parsed in
[`core/schema/load.ts`](../../src/core/schema/load.ts),
[`data/schema/sources.json`](../../data/schema/sources.json) sets it. `BottomNav` filters
`schemas.order` on it before building tab items; nothing else in the routing or CRUD layer changes,
because nothing else needed to.

Reaching a source without a tab meant a source `ref` chip had to become a link rather than inert
text — `RefChip` in [`ui/fields.tsx`](../../src/ui/fields.tsx) now wraps itself in a `Link` to
`/<refTable>/<id>` whenever the target exists. Tapping the source shown on a design's detail screen
opens that source's own record, where its `type`, `url` and `note` can be filled in — at the time
this ADR was written, the `quickCreate` affordance on `designs.source` only ever set the name, same as
`design_id` did before it ([ADR 0010](0010-quick-create-instead-of-folding-designs.md)), so opening
the record was the only way to set the rest. It no longer is:
[ADR 0018](0018-full-inline-quick-create.md) lets `type`/`url`/`note` be set inline, in the
quick-create form itself, but the chip is still a link either way — there is always a real record
behind it, worth opening on its own for anything quick-create did not ask for.

## Consequences

- A `ref` chip is now clickable everywhere, not just for hidden tables — a small, generically useful
  side effect rather than a special case, since every `ref` target already has a working detail
  route.
- A table can be hidden from the tab bar and still be browsed at its plain URL. That is a feature for
  a lookup table and a footgun for anything the owner is meant to see regularly — `hideFromNav` is
  for tables that exist to be pointed at, not tables that exist to be reviewed.
- One more boolean for `buildSchemaSet` to parse and for every future table author to know about, in
  exchange for not inventing a second way to declare a table.
