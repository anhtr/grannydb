# ADR 0034 — Every numeric filter is a min–max slider

**Status:** accepted · 2026-10-24

## Context

The one numeric filter, yarn `skeins`, offered "1+", "2+", "3+"… threshold pills, chosen by a
per-field `"filterMode": "min"` in the schema. That answers "at least N" but not "at most N" ("which
colours am I nearly out of?") or "between N and M". The owner asked for every numeric filter to be a
min–max slider from 0 to the highest value in the data, and for the yarn list to filter by its
squares-as-main and squares-as-extra counts too — computed numbers ([ADR 0022](0022-computed-counts-and-a-recordlist-escape-hatch.md))
with no schema field behind them.

## Options — which numbers get a slider

**Add `"filterMode": "range"` next to `"min"`.** Keeps every option open, but leaves three ways to
filter a number where one answers every question the other two can: "N or more" is a range with its
top at the maximum, and an exact count is a range of one. A mode nobody should pick is a schema knob
that only exists to be picked by mistake.

**Make `type: "number"` alone decide it.** One rule, no knob. Costs the exact-value pill row for a
number — not used anywhere, and recoverable as a one-value range.

## Options — the widget

**A custom slider** dragging divs with pointer events. Full control of the look, but keyboard
stepping, touch, and what a screen reader announces would all have to be written and tested by hand.

**Two native `<input type="range">` stacked on one track.** The browser supplies arrow-key steps,
touch, and an announced value per thumb. The cost is CSS: each input's track is made transparent and
blind to the pointer, and only its thumb takes events, so either thumb is reachable through the other
input. Vendor pseudo-elements (`::-webkit-slider-thumb`, `::-moz-range-thumb`) are needed for that,
and the drawn fill has to reproduce how far the native thumb is inset at each end.

## Options — what to save when a thumb is at the end

`ListPrefs.filters` is device-local and outlives the data it was set against. If the top thumb is at
5, today's maximum, and a yarn with 7 skeins is added tomorrow:

**Save `5`.** The filter now silently hides the new yarn — the person asked for "2 or more", not "2
to 5", but the saved value cannot tell the two apart.

**Save an empty upper bound when the thumb is at the maximum.** "At the end" means "unbounded", so
the filter keeps meaning what the person meant as the data grows. Same at the bottom with 0.

## Decision

`type: "number"` with `"filter": true` renders as a `RangeFilterDescriptor` (`ui/RecordList.tsx`),
and `filterMode` is removed from `FieldDef`, the loader and `yarns.json`. A schema still carrying
`"filterMode"` loads; the key is ignored like any other the loader does not know. Pages pass a
computed range through `extraFilters` the same way (`YarnsPage`'s main/extra counts).

Built from two native range inputs (`RangeFilter`, `.range-pair` in `styles.css`). A selection is
saved in the same `string[]` slot a pill filter uses, as `[min, max]`, `''` at either end meaning
unbounded, and nothing at all when the thumbs span the whole range. A one-item `["3"]` — what the old
"3+" pills saved — therefore still reads as "3 or more", so an existing device's saved filter
survives the change.

## Consequences

- "Skeins left: up to 1", "Squares (main): 2–4" and "exactly 0" are now expressible; none were before.
- Adding a numeric field and marking it `"filter": true` gets a slider with no further configuration.
- The slider's maximum is read from the rows each time the list renders, so it moves with the data.
  A saved bound beyond it is clamped for display, not rewritten.
- Steps are whole numbers. A fractional field would still filter correctly (the maximum is rounded
  up), but could not set a bound between two integers. Nothing stores fractions today.
- When every value is 0 there is no range to slide, so the panel says so instead of drawing a slider
  whose two thumbs cannot move.
