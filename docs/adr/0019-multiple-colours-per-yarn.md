# ADR 0019 — Multiple colours per yarn, one `;`-joined cell not a second field

**Status:** accepted · 2026-08-19

## Context

`yarns.hex` was a single `color` field: one hex value, drawn as the swatch everywhere a yarn is shown.
Some yarns are not one colour — a variegated or self-striping colourway shades between two or more
hexes along the same strand — and for those, one swatch showing only the first shade misrepresents the
yarn.

## Options

**A second field, `extra_hex`**, mirroring how `squares` splits `main_yarn`/`extra_yarns`. Consistent
with an existing pattern in the app, but it is the wrong pattern here: `main_yarn`/`extra_yarns` are
different colours used *together in one square*, independently orderable and each individually
meaningful. A variegated yarn's shades are not independent picks, they are one product — closer to
`extra_yarns`' own single-cell list-of-refs than to a second top-level field.

**A single cell holding a `;`-joined list of hex values**, the same shape `extra_yarns` already uses
for a list of refs in one cell — just a new field *type*, `colorlist`, rather than a new field. The
first value is the primary colour, read by everything that already treats `hex` as one colour (a
single hex is trivially a valid one-item list, so no data migration). The rest are additional shades,
shown as small dots inside the swatch rather than a second swatch.

**Leave it as a single colour, note the limitation.** No change, but a real yarn stash for anyone who
buys variegated or gradient yarn (not unusual for granny squares specifically) has no honest way to
record it.

## Decision

`colorlist`, a new field type alongside `color` — [`core/schema/types.ts`](../../src/core/schema/types.ts)'s
`FieldType`, parsed the same way `reflist` is in [`core/schema/load.ts`](../../src/core/schema/load.ts).
`yarns.json`'s `hex` field changes `"type"` from `color` to `colorlist`; `swatchField` still just names
that column, so every existing caller of `Swatch` (`RefChip`, the ref-picker dropdown, `RecordList`'s
default row, the Yarns list itself) needed no change — `Swatch` (`ui/components.tsx`) now splits its
`hex` prop on `;`, fills the swatch with the first colour, and draws up to four more as small dots
inside it. `ColourGlyph` (the square list's main-colour-as-a-square glyph, see the colour-imbalance
stats work) originally took only a multi-colour yarn's *first* hex, to avoid drawing wedges of dots
inside wedges — later revised (see the CHANGELOG) once a stash with variegated yarn made "first colour
only" read as a bug rather than a simplification. It now draws every colour: as equal-width linear
stripes across the outer square for the main yarn, and as further radial stripes *within* an extra
yarn's own pie wedge, so a variegated extra yarn's colours stay legible without merging into a
neighbouring yarn's wedge.

The edit form gets a new `ColorListInput` (`ui/fields.tsx`): one colour row per hex value, "+" beside
the first to add another, "−" on every row after it to remove that one. Each row is a
`ColorPickerRow` — the same native picker, hex text box, and (new, see the R/G/B boxes below) RGB
number boxes that a plain `color` field now also gets, so entering a colour by RGB works whether the
field holds one value or several.

## Consequences

- `color` stays a real, working single-value type — nothing currently uses it (only `yarns.hex` ever
  did, and it just moved to `colorlist`), but it is not dead code; a future single-colour field can
  still use it, RGB entry included.
- `validateValue`'s new `colorlist` case validates every `;`-separated hex individually, reusing the
  same `HEX_RE` the `color` case already had.
- No migration: every existing `hex` cell is already a valid one-item `colorlist` value.
- `Swatch`'s contract widens from "one hex" to "one or more, `;`-joined" for every caller at once,
  rather than each call site learning about multi-colour yarns separately.
