# ADR 0014 — A live-search combobox for every `ref`/`reflist` field, not just the big tables

**Status:** accepted · 2026-08-18

## Context

`RefSelect` rendered every `ref` field as a plain `<select>`, and `RefListInput` rendered every
`reflist` field as a grid of tap-to-toggle chips. Both read fine for `yarns` (a fixed stash, tens of
rows) and for `sources` (a handful). Neither reads fine for `designs.source` picked from `squares`:
the owner is meant to add one design per square, so the practical shape of that table is "as many
rows as there are squares" — a `<select>` with hundreds of options is a wall of text to scroll on a
phone, and the chip grid has the same problem for a colour stash of a hundred yarns once you are
choosing extra colours rather than admiring the whole shelf.

## Options

**Keep `<select>`/chips, add search only past some row-count threshold.** Reads reasonable at first —
why pay for a search box on a three-row table — but it means two code paths per field type, a magic
threshold to tune, and a control that changes shape as the owner's own data grows, which is exactly
the kind of behaviour change nobody notices until a `<select>` that used to be fine suddenly is not.

**A `searchable` flag on the field**, defaulting to the old `<select>`/chips. Explicit, but it is the
schema author guessing ahead of time which tables will grow past comfortable-`<select>` size. Getting
it wrong for one field is a one-line schema fix, but it is one more knob to get wrong, for a benefit
(a marginally faster tap on a three-row table) that a search box does not actually cost much to give
up.

**Every `ref`/`reflist` field gets the search combobox, unconditionally.** No threshold, no flag. A
search-as-you-type box on a three-row table costs one extra tap to open it — same as a `<select>` —
and reads as one consistent control everywhere a reference is picked, rather than the control's shape
depending on how big the target table happens to be today.

## Decision

Every `ref`/`reflist` field. `RefSelect` and `RefListInput` (`ui/fields.tsx`) are now
`RefSearchSelect` and a search-augmented `RefListInput`: type to filter, results narrow live,
matching case-insensitively and via `*`/`?` wildcards (`core/schema/search.ts`'s `matchesSearch`).

What gets searched is still a per-field knob — `FieldDef.searchFields` — because *that* genuinely
varies: `squares.design_id` searches the design's `name` and `source` (picking a design by the book
it came from is as common as picking it by name), `squares.main_yarn`/`extra_yarns` search every
field on the yarn row (`display_name`, `product_line`, `product_id`, …) since any of them might be
what the owner remembers about a colour. Omitting `searchFields` searches every field on the
referenced row — the honest default when a table has not said otherwise.

`RefListInput` always shows already-selected chips regardless of the current search text, so typing
to find one more colour never hides the ones already picked.

## Consequences

- One control shape for every reference, on a three-row table and a four-hundred-row one alike — no
  threshold to tune, no flag to remember to set.
- `searchFields` is optional and additive: a table with nothing set still gets a working search (every
  field), so the feature does not require touching every existing schema file to keep working.
- A `<select>`'s native scrollable list and typeahead are gone in favour of a custom dropdown, which
  costs some built-in a11y semantics `<select>` gets for free — acceptable here since the whole app
  already accepts custom controls (the chip grid this replaces was one) in exchange for phone-sized
  touch targets.
