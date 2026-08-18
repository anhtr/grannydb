# ADR 0013 — A `titleFallback` template, not table-specific display logic

**Status:** accepted · 2026-08-18

## Context

`yarns.name` ("Colourway") was doubling as both the manufacturer's shade name and the label shown
everywhere a yarn is referenced — the swatch title on a square, the option text in a `ref` `<select>`,
the row title on the Yarns list. That is fine until you own more than a couple of yarns from the same
line: fifty rows of "Sunflower", "Cranberry", "Sage" resolved through `main_yarn` do not tell you
which skein is which on a phone screen, and the name you would actually recognise it by (your own
nickname, or the thing written on the label you dyed it against) has nowhere to live.

The fix is a new `display_name` field the owner fills in by hand, used as `titleField` instead of
`name`. But most of the 100 seed rows from a bulk colour import (see the 2026-08-18 changelog entry)
will sit with `display_name` blank for a while — nobody hand-names fifty skeins in one sitting — and
falling back to the row id (`Y037`) the way every other `ref` already does is actively worse than what
existed before: at least `name` was a real colour name.

## Options

**Fall back to the row id, same as everything else.** Zero new code, but a blank `display_name`
regresses every yarn reference to `Y037` until the owner manually names it — worse than doing nothing.

**Hardcode a yarn-specific fallback** (`` `${row.product_id} (${row.name})` ``) in the two or three
places a yarn's label is resolved: `useRefInfo` in `ui/fields.tsx`, `DefaultRow` in
`ui/RecordList.tsx`, the colour tallies in `StatsPage.tsx`. Works, but is exactly the kind of
table-specific branch [ADR 0005](0005-schema-as-data.md) exists to avoid, and it would have to be
found and updated again the next time a new screen resolves a yarn reference.

**A `titleFallback` template on `TableSchema`**, interpolated from other fields on the same row when
`titleField` is blank. Generic — any table can use it, not just yarns — and lives in one function next
to `titleField` itself instead of being re-decided at every call site.

## Decision

`titleFallback`. `data/schema/yarns.json` sets `"titleField": "display_name"` and
`"titleFallback": "{product_id} ({name})"`. `titleFor(schema, row)` in
[`core/schema/types.ts`](../../src/core/schema/types.ts) is the one place that resolves it: use
`titleField` if non-blank, else render `titleFallback` if the fields it references are not *all*
blank, else the row id. Every place that used to read `row[schema.titleField] || id` directly —
`useRefInfo`, `RefListInput` and `RefSelect` in `ui/fields.tsx`, `DefaultRow` in `ui/RecordList.tsx`,
the yarn tallies in `StatsPage.tsx` — now calls `titleFor` instead.

## Consequences

- A blank `display_name` shows e.g. "13 (Ochre)" instead of "Y10" — legible immediately, no manual
  naming pass required after a bulk import.
- The mechanism is generic: any table can set `titleFallback` later without touching `ui/fields.tsx`
  again, which is the whole point of keeping the schema as data.
- One more thing a schema author can get subtly wrong — a `{key}` that does not match a field just
  renders as an empty gap rather than failing to load, since `buildSchemaSet` does not (and cannot,
  being a plain string) validate the template's placeholders against the field list.
