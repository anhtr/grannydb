# ADR 0024 — A `pattern` field, and speckles as tiled repeating dot layers

**Status:** accepted · 2026-08-22

## Context

[ADR 0021](0021-colourway-as-stripes-clipped-to-its-shape.md) settled on one rule for every
multi-colour yarn: equal parallel stripes, everywhere a colourway is drawn. That is the right
picture for a variegated or self-striping yarn, where the shades genuinely alternate along the
strand. It is the wrong picture for a **speckled** yarn — one base colour with a handful of other
shades appearing as small, irregular flecks, not bands. Drawn as stripes, a speckled colourway reads
as "three roughly-equal colours," which misrepresents a yarn that is mostly one colour with fifty
flecks of two others (issue #3).

Speckled yarn also has a colour that stripes never needed: a *base*. A striped colourway has no
primary — ADR 0021 says so explicitly. A speckled one does: the base is what everything else sits on
top of, so drawing it correctly depends on knowing which of the yarn's colours that is.

## Options considered

**Infer the pattern from colour count**, the way `swatchField` already infers "one colour = solid
fill" for free. Zero new fields, but wrong: a yarn with three roughly-equal shades and a yarn with one
dominant colour and two flecked accents both show up as a `colorlist` of three hexes. Count alone
cannot tell a stripe-worthy colourway from a speckle-worthy one — that is a property of the yarn, not
of how many hexes happen to be on file.

**A `pattern` field on `yarns`, `solid` / `print` / `speckled`.** One more optional column, parsed by
the existing `enum` type — no new field type, no new validation case. `print` names the existing
stripe behaviour explicitly, so leaving `pattern` blank and setting it to `print` mean the same thing;
`solid` exists mainly so single-colour yarns have an honest value on file rather than an empty cell
that happens to render correctly. Chosen.

**Speckles as an SVG overlay, one `<circle>` per fleck.** Would allow genuinely random-looking
placement instead of a tiled repeat, but adds a DOM node per speckle per swatch — expensive across a
list of colourways, and unlike everything else `Swatch`/`ColourGlyph` draw, would need a build step to
generate positions (`Math.random()` inside a render function repaints differently every render). Ruled
out for the same reason ADR 0021 avoided extra elements: no third-party code, minimal DOM (invariant
6).

**Speckles as a single small raster/data-URI texture, tiled with `background-repeat`.** One image
asset per possible fleck colour combination is not a fixed set — any yarn can pick any hexes — so this
would mean generating a texture per yarn at runtime (a `<canvas>` render to a data URL) rather than a
few CSS properties. More moving parts for the same visual result.

## Decision

`pattern`: a new optional `enum` field on `yarns.json` (`solid` / `print` / `speckled`), named by a
new table-level `patternField` (`core/schema/types.ts`), read the same way `swatchField` already is —
`schema.patternField` names the column, and every place that draws `schema.swatchField`'s value now
also reads `schema.patternField`'s alongside it. Blank behaves as `solid` for one colour or `print`
(the pre-existing stripe default) for more than one, so nothing already on file needed to have an
opinion about speckles to keep rendering the same way.

Speckles are `speckleStyle()` (`ui/components.tsx`): the first colour becomes the shape's
`backgroundColor`, and every other colour is its own `radial-gradient(circle, hex 1.1px, transparent
1.5px)` layer, tiled via `background-size`/`background-position` at a tile size and phase that varies
by index (`7 + (i % 3) * 4` px, offsets scaling with `i`). Layering several independently-tiled dot
grids, rather than one shared grid, is what keeps a five-fleck-colour yarn from having every colour's
dots land in the same cells — the visual point of "speckled," without needing true randomness or an
extra DOM node per dot. `colourStyle()` is the new single entry point both `Swatch` and `ColourGlyph`
call instead of using `stripeBackground` directly, choosing speckles, stripes, or a flat fill from a
colour list and a pattern name — one function, so `Swatch`'s chip and `ColourGlyph`'s outer square and
per-wedge extra yarns all speckle the same way, the same reasoning ADR 0021 used for stripes.

Because a speckled yarn's first colour is now load-bearing (the base, not just "whichever one is
first"), `ColorListInput` (`ui/fields.tsx`) gained ▲/▼ buttons per colour row, swapping that row with
its neighbour — so putting the right shade first no longer means deleting and re-adding colours in a
different order.

Reading `pattern` alongside a `colorlist` value needed one structural change: `FieldDisplayProps` and
`FieldInputProps` gained optional `row`/`schema` fields, since the generic per-field `Display`/`Input`
call in `RecordDetail`/`RecordForm` previously passed only the one field's own value — with no way for
`colorlist`'s renderer to look up a sibling column (`pattern`) on the same row. Every other field type
ignores the two new props; only `colorlist` reads them, and only when `schema.swatchField` names that
same field, so a hypothetical second `colorlist` column on some other table would not misapply the
first one's pattern.

## Consequences

- Existing data needed real values, not just a blank-defaults-to-old-behaviour migration: every yarn
  on file with exactly one recorded hex got `pattern: solid`, every yarn with more than one got
  `pattern: print` — an explicit record of what was previously implicit, rather than leaving 140 rows
  relying on a fallback that a future schema change could alter from under them.
- `pattern: solid` on a `colorlist` with more than one hex (a state the schema cannot prevent, only a
  hand-edit could produce) falls back to stripes rather than erroring — `colourStyle()` treats
  anything that is not `speckled` as stripe-worthy, so a malformed cell degrades to the old behaviour
  instead of a blank swatch.
- At the 14px chip size used in ref chips and list rows, only one or two dots per fleck colour are
  visible — narrow, like ADR 0021's stripes at the same size, but the base colour still reads clearly
  underneath, which is the part that actually needs to be legible that small.
- `speckleStyle` is pure CSS — no SVG, no canvas, no extra DOM node per colour or per dot — so it costs
  nothing extra against invariant 6 (no third-party runtime code) and renders identically wherever
  `Swatch`/`ColourGlyph` already do.
