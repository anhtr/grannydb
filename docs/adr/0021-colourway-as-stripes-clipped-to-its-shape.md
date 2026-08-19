# ADR 0021 — A colourway is always stripes, clipped to whatever shape holds it

**Status:** accepted · 2026-08-19

## Context

[ADR 0019](0019-multiple-colours-per-yarn.md) let a yarn hold several hexes in one `colorlist` cell,
but the two places that draw a yarn each invented their own way to show the extra colours, and neither
matched the other:

- `Swatch` (the chip in lists, ref pickers, the Yarns page) filled the circle with the *first* hex and
  scattered the rest as up to four small dots inside it.
- `ColourGlyph`'s inner circle gave each extra yarn a `conic-gradient` pie wedge and, for a
  multi-colour yarn, subdivided that wedge into narrower wedges — one per colour.

So the same variegated yarn read as a blue circle with dots on the Yarns page, and as a fan of thin
radial slivers on a square. Neither shape says "this is one yarn that shades between these colours",
and the wedge-within-a-wedge version actively fights the glyph's own grammar, where a wedge already
means *a different yarn*. Dots have a second problem: capped at four, and at the 14px swatch size used
in chips they are a few pixels across, so a five-colour colourway silently loses colours at exactly the
size where the swatch does most of its work.

## Options

**Keep the two treatments, tune them.** Bigger dots, thinner sub-wedges. Cheapest, but it leaves the
real defect — one thing drawn two ways, with the sub-wedge still overloading the symbol that means
"another yarn".

**One treatment, radial: wedges everywhere.** Make the `Swatch` a pie too. Consistent, but then a
colourway inside an extra yarn's wedge is still wedges inside a wedge, and a pie of two colours is
just a circle cut in half — which reads as "two yarns", not "one variegated yarn".

**One treatment, linear: equal parallel stripes filling whatever shape holds the colourway.** The
outer square already drew the main yarn this way; extending it means a colourway looks the same
everywhere — flag-like bands, in cell order, no colour dropped — and the *shape* alone carries what the
colours belong to: the whole chip, the whole square, or one wedge of the inner circle. Wedge keeps its
single meaning, "one extra yarn", and stripes keep theirs, "the colours within one yarn".

## Decision

Stripes, clipped to the container. `stripeBackground` (`ui/components.tsx`) is now the one renderer for
a list of colours: `Swatch` fills its whole circle with it (`splitHexList`, no primary, no dots, no cap),
`ColourGlyph`'s outer square fills with it for the main yarn, and each extra yarn gets one `<span>`
covering the inner circle, striped the same way and cut down to its wedge by a `clip-path` polygon.

The clip is what makes this possible at all: a `conic-gradient` can only put more wedges inside a wedge,
whereas a sector-shaped clip lets the wedge hold *any* background — here, a linear one. `sectorClipPath`
emits the centre point plus a coarse arc at a radius that overshoots the box, so only the two straight
radii land inside it; the curved edge is cut by the parent's `rounded-full` and stays exactly circular
however few points the arc uses.

## Consequences

- One rule to hold in your head — *stripes are one yarn's colours, wedges are separate yarns* — instead
  of one convention per component, and one function to change if the striping ever needs to.
- No cap and no primary: a six-colour colourway shows six stripes everywhere it is drawn. At a 14px
  chip that is ~2px a stripe, which is narrow but honest, and better than silently showing four of six.
- `Swatch` no longer treats the first hex as special. Nothing else did either, so `swatchField`'s
  contract is unchanged.
- The stripes are a proportion-free reading: equal widths say *which* colours, never how much of each.
  Actual balance is the stats page's job, not the glyph's.
- `clip-path` on a `<span>` is well supported in every browser this app targets, and needs no SVG, no
  extra element per colour, and no third-party code ([invariant 6](../../CLAUDE.md)).
