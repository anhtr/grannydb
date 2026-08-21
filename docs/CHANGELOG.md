# Changelog

What changed and when. One entry per shipped change, newest first.

Update this in the same commit as the change, not afterwards. See [README](README.md#keeping-these-current).

## 2026-08-20 — v0.1.14, multi-select filters, a leaner Squares tab, and a reshuffled Progress screen

**App**
- `RecordList`'s filter panel now renders each filter as toggleable pills instead of a `<select>`.
  Plain fields (e.g. Product line) are checkboxes — any number selected at once, OR'd together — since
  "this colour or that one" is a meaningful combination. A `"filterMode": "min"` threshold field (e.g.
  Yarns' Skeins left) stays radios, one at a time, because thresholds already nest and combining two
  wouldn't mean anything beyond the lower one. `ListPrefs.filters` (`core/prefs`) changes shape from
  `Record<string, string>` to `Record<string, string[]>` to hold a selection instead of one value; an
  existing device's saved single-value filters are read once and converted to one-item arrays on load.
- The search box, the Sort button and the Filter button now share one row instead of search sitting on
  its own row above them, so the list starts higher on the screen.
- Squares list: the "Squares finished" progress bar and its construction/imbalance/gap badges are
  gone — that summary already has a dedicated home on the Progress screen, so showing it twice was
  redundant. `squareConstructionInsights` (`core/schema/relations.ts`) now backs only the Progress
  screen.
- Progress screen reordered: "By status" now leads, immediately followed by the four stat tiles
  (Finished/Blocked/Pace/At this rate) that used to sit above it. The colour and design breakdowns
  ("Finished, by main colour", "By colour", "By design") move to the bottom of the page instead of
  sitting in the middle. "Colour imbalance by construction", "Missing main colour" and "Missing design"
  now render only when they have something to show, instead of a card with a "Nothing recorded"/"None
  — nice" placeholder.
- New "By source" card on the Progress screen: for each source, squares made from it and how many of
  its designs have at least one square — two numbers per source rather than one, since a source used
  for one design ten times and a source with ten designs used once would otherwise tally identically.
  Collapsed (its default), it drops the bars and shows just the source name and the two counts.

**Docs**
- [App architecture](05-app-architecture.md) updates the `RecordList` description for the combined
  search/sort/filter row, the pill-based multi/single-select filters, and `squareConstructionInsights`
  now backing only the Progress screen.

## 2026-08-20 — v0.1.13, floated badge rows, construction on lists, and a person-editable multi-key sort

**App**
- New `BadgeStack` (`ui/components.tsx`): rows of badges floated to one side of a list row, so a long
  title or subtitle wraps under them instead of being truncated to make room. Adopted by every list row
  renderer (`YarnsPage`, `SquaresPage`, `DesignsPage`, `RecordList`'s generic `DefaultRow`). `Swatch`
  and `ColourGlyph` gain an optional `className` so they can be floated too.
- Yarns list: a partial skein is now shown as a `◖` on the end of the skein-count badge instead of its
  own separate "Partial" badge, and the skein/partial badge sits on its own row above the main/extra
  usage badges (previously all four badges competed for one row).
- Squares and Designs lists: construction type (`solid`/`holey`) now shows as a badge on its own row,
  under the status badge (Squares) or the square-count badge (Designs) — reads the *effective* value
  for squares, same as everywhere else `construction_type` is inherited from a design. See
  [ADR 0016](adr/0016-field-level-inherited-values.md).
- New `squareConstructionInsights` (`core/schema/relations.ts`): finished-squares-by-construction,
  which main colours are imbalanced across constructions, and which squares are missing a main colour
  or a design — one aggregation pass over `squares`, shared by the Squares list's progress header and
  the Progress screen. The progress header now shows these counts under the finished/goal bar; the
  missing-colour and missing-design counts only appear when they are non-zero.
- Progress screen: "Finished, by main colour", "By colour" and "By design" are now collapsible, and
  start collapsed. Collapsed, the two colour tallies show just a swatch and a count per colour (no
  name), gapped out in a row; the design tally shows only designs with more than one square, as
  `"Name (n)"` comma-separated. `StatsPage` now gets its construction/imbalance/missing-gap numbers
  from `squareConstructionInsights` instead of its own copy of that aggregation.
- `RecordList`'s sort control is now a person-editable, priority-ordered list of sort keys (any number,
  reorderable, each with its own direction) instead of one field plus a direction toggle. `thenBy` still
  seeds the initial list a table's `defaultSort` opens with, but no longer gates a runtime tie-break —
  see [ADR 0023](adr/0023-priority-ordered-multi-key-sort.md), which supersedes that part of
  [ADR 0020](adr/0020-default-sort-secondary-key.md). `ListPrefs.sortKey`/`sortDir` (`core/prefs`)
  become `sorts: SortRule[]`; an existing device's saved single-key sort is read once and converted on
  load, so this does not reset anyone's remembered sort.

**Docs**
- [Data model](02-data-model.md) corrects the `defaultSort`/`thenBy` paragraph to describe seeding a
  person-editable list rather than a gated tie-break. [App architecture](05-app-architecture.md)
  documents the sort panel, `BadgeStack`, and `squareConstructionInsights`. [ADR 0020](adr/0020-default-sort-secondary-key.md)
  is marked superseded on the one point ADR 0023 replaces; its history otherwise stands.

## 2026-08-19 — v0.1.12, active yarn, and squares-used counts for yarns and designs

**App**
- New `core/schema/relations.ts`: `isYarnActive` (a yarn with stash left, or cited by at least one
  square, either signal), `yarnUsageCounts` (squares-as-main / squares-as-extra per yarn), and
  `designSquareCounts` (squares per design) — all computed by scanning `squares` at read time, not
  stored as columns. See [ADR 0022](adr/0022-computed-counts-and-a-recordlist-escape-hatch.md).
- `RecordList` (`ui/RecordList.tsx`) gains `extraSortOptions`/`extraFilters` props, alongside the
  schema-derived sort options and filter dropdowns it already builds, for a value with no field to
  scan. `YarnsPage` now shows and can sort by each yarn's main/extra square counts, and can filter to
  active/inactive yarns. `DesignsPage` is a new file (Designs previously used the generic `RecordList`
  unmodified) that shows and can sort by each design's square count.

**Docs**
- [Data model](02-data-model.md) documents the derived-properties pattern under "Three modelling
  decisions worth explaining." [App architecture](05-app-architecture.md) documents the new
  `RecordList` props and `designs`' addition to `TABLE_LIST_OVERRIDES`.

## 2026-08-19 — v0.1.11, one way to draw a colourway: stripes, clipped to its shape

**App**
- A multi-colour (`colorlist`) yarn is now drawn the same way everywhere: equal parallel stripes, in
  cell order, filling whatever shape holds that yarn. `Swatch` (`ui/components.tsx`) stripes its whole
  circle instead of filling with the first hex and scattering the rest as up to four dots — so no
  colour is dropped from a five-or-more-colour colourway, and none is treated as primary. `ColourGlyph`
  keeps one pie wedge per extra yarn but fills each wedge with that yarn's stripes, via a `clip-path`
  sector (`sectorClipPath`) rather than subdividing the wedge into narrower `conic-gradient` wedges —
  a wedge now means "a separate yarn" and nothing else. `wedgeBackground` is gone; `stripeBackground`
  is the single renderer for a list of colours. See
  [ADR 0021](adr/0021-colourway-as-stripes-clipped-to-its-shape.md).

## 2026-08-19 — v0.1.10, square colour glyph shows every stripe

**App**
- `ColourGlyph` (`ui/components.tsx`) now draws every colour in a multi-colour (`colorlist`) yarn,
  instead of only the first hex. The outer square (main yarn) splits into equal-width linear stripes,
  one per colour. The inner circle keeps its per-extra-yarn `conic-gradient` pie wedge (introduced in
  v0.1.8, one wedge per yarn in `extra_yarns` order) but now subdivides a wedge further, into equal
  radial stripes, when that yarn itself has more than one colour — so a variegated extra yarn's colours
  stay confined to its own wedge rather than merging with its neighbours'. Corrects the "first colour
  only" simplification [ADR 0019](adr/0019-multiple-colours-per-yarn.md) originally chose for this
  glyph, which read as a bug once a variegated yarn showed as a plain solid square or wedge.

## 2026-08-19 — v0.1.9, multi-colour yarns, RGB input, square list colour text, colour+construction sort

**Data**
- `yarns.json`'s `hex` field changes type from `color` to `colorlist` — a yarn can now hold more than
  one hex value (`;`-joined in the one cell, same pattern `extra_yarns` uses for a list of refs), for a
  variegated or self-striping colourway. A single hex value is already a valid one-item `colorlist`, so
  no data migration. See [ADR 0019](adr/0019-multiple-colours-per-yarn.md).
- `squares.json` gains `"defaultSort": { "key": "main_yarn", "thenBy": "construction_type" }` and marks
  `design_id`, `construction_type`, and `main_yarn` `"sortable": true` — the Squares list now offers
  Design, Construction, and Main colour as sort options alongside the existing ID and Date, and opens
  grouped by colour, then by construction within a colour, instead of by id. See
  [ADR 0020](adr/0020-default-sort-secondary-key.md).

**App**
- `core/schema` gains a `colorlist` field type: `validateValue` checks every `;`-separated hex
  individually; `ui/fields.tsx` gets a `ColorListInput` (one colour row per hex, "+" beside the first
  to add another, "−" on every added row to remove it) and a `Display` reusing the updated `Swatch`.
  `Swatch` (`ui/components.tsx`) now splits its `hex` prop on `;`: the first colour fills the swatch,
  up to four more show as small dots inside it — every existing caller (`RefChip`, the ref-picker
  dropdown, `RecordList`'s default row, the Yarns list) picks this up automatically since `swatchField`
  still just names one column. `ColourGlyph` (the square list's colour glyph) takes only a multi-colour
  yarn's first hex, to avoid nesting wedges of dots inside wedges.
- Every colour field — `color` and the new `colorlist` — gains RGB number inputs alongside the native
  picker and hex text box, all views of the same hex value (`ColorPickerRow` in `ui/fields.tsx`):
  editing R/G/B recomputes the hex and writes that back, since hex is still the only thing actually
  stored.
- Squares list row: the first line is now `[id] • [main colour]/[extra colours]` (colour names in a
  smaller, unbolded weight than the id), the same main-then-extras order the colour glyph already draws
  in, next to it.
- `RecordList`'s sort machinery (`compareValues`/`sortRows`) now takes a primary and optional secondary
  `SortSpec` instead of three loose sort parameters, and resolves `effectiveValue()` for a sort field
  with `inheritFrom` instead of its raw stored cell — sorting by Construction previously would have
  sorted every square that inherits it from its design as an empty string. Updates
  [ADR 0016](adr/0016-field-level-inherited-values.md)'s Consequences, which flagged the filter-side
  version of the same gap in the previous entry.

**Tests**
- `schema.test.ts`: `colorlist` validation (every hex in the cell checked, not just the first); a
  `defaultSort.thenBy` naming a sortable field is accepted, one naming a non-sortable field is rejected.
- New `ui/__tests__/RecordList.sort.test.ts`: `sortRows` resolves a `ref` sort field to the referenced
  row's title, resolves an `inheritFrom` field to its effective value rather than the blank stored
  cell, and breaks a primary-sort tie using a secondary `SortSpec`.

## 2026-08-19 — v0.1.8, data-gap stats, full inline quick-create, square colour/status glyphs, sorting

**Data**
- `squares.json`'s `date` field gains `"sortable": true` — squares can now be sorted oldest/newest
  first, not just by id.
- `yarns.json` gains `"defaultSort": { "key": "title" }`, so the Yarns list opens sorted by effective
  display name (own value, or the `{product_id} ({name})` fallback when blank — the existing built-in
  `title` sort every table already gets for free) instead of by id. Sorting by the raw `display_name`
  column was considered and rejected: roughly 100 of the current 130 yarn rows have it blank, and a
  raw-field sort would cluster all of them together, out of alphabetical order, ahead of the ~30 named
  ones — the `title` sort already handles the fallback correctly per row.

**App**
- Stats screen: a new "Missing main colour" / "Missing design" pair of cards at the bottom, listing
  (across every status, not just finished) any square whose `main_yarn` or `design_id` is blank, each
  row linking straight to that square. Both fields are what every colour/construction tally on the
  page keys off, so a square missing one does not show up as a visible zero anywhere — it just quietly
  drops out of every count, which is exactly what made "Colour imbalance by construction" go quiet
  instead of flagging a real gap for square `S007`. This card makes the gap something to click and fix
  instead of a mystery to debug from the other cards' totals.
- `QuickCreate` in `ui/fields.tsx` is no longer title-only: it now opens a full inline form over every
  field on the target table (reusing the same `fieldRenderers` the main record form uses), and a `ref`
  field inside it that is itself `quickCreate` (`designs.source`) gets its own nested "+ New", one
  level deep. Adding a square for a not-yet-filed design, and giving that design a not-yet-filed
  source, is now one form, not three screens. `RecordForm`'s referential-id lookup moved to a shared
  `useRefIds()` in `app/hooks.ts` so both callers validate `ref` fields the same way instead of each
  computing it separately. See [ADR 0018](adr/0018-full-inline-quick-create.md); updates
  [ADR 0010](adr/0010-quick-create-instead-of-folding-designs.md) and
  [ADR 0012](adr/0012-hidden-tables-for-lookup-only-data.md), which described the title-only version.
- `Badge` (`ui/components.tsx`) gains `danger` and `success` tones alongside the existing
  `neutral`/`accent`/`warn`, plus dark-mode colours for all of them (`warn` previously had none). The
  squares list's status badge now uses a distinct tone per status — `planned` orange, `in progress`
  amber, `done` green, `blocked` cyan — rather than collapsing `done`/`blocked` onto the same tone and
  `planned` onto plain grey.
- New `ColourGlyph` component (`ui/components.tsx`): a square's row in the squares list now shows its
  main colour as a filled square with a smaller circle inside for its extra colours, split into
  equal pie wedges (a `conic-gradient`) when there is more than one, rather than a stack of overlapping
  circles. Replaces the `-space-x-1.5` overlapping-`Swatch` layout in `SquareRow`.

## 2026-08-19 — v0.1.7, verbose commit bodies, construction filter, construction stats, goal override

**Data**
- `squares.json`'s `construction_type` gains `"filter": true` — squares can now be filtered by
  construction the same way designs already could.

**App**
- `Prefs` (`core/prefs`) gains `squaresGoal: number | null`, a device-local override for
  `squares.json`'s `"goal": 400`, `null` meaning "use the schema's." New `effectiveGoal(schema,
  prefs)` resolves it; the Progress header (`SquaresPage.tsx`) and Stats screen both call it instead
  of reading `schema.goal` directly. Settings → Project gains a "Target squares" field next to
  "Start date," sharing one Save button. Resolves
  [issue #1](https://github.com/anhtr/grannydb/issues/1). See
  [ADR 0017](adr/0017-device-local-goal-override.md).
- `commitMessage()` (`core/store/message.ts`) now spells out, per row, which fields a `save` line
  actually changed and what they became (`- save squares/S041 — Status: done, Main colour: Y004`),
  using each field's label and its `Change.values` entry (already a diff — see
  [sync-engine](04-sync-engine.md#partial-values-is-load-bearing)), with `(blank)` standing in for an
  empty string. Previously the body only named the row (`- save squares/S041`), which meant `git log`
  alone could not answer "what actually changed" without a diff. `delete` lines are unchanged.
- `RecordList`'s filter descriptors (`ui/RecordList.tsx`) now call `effectiveValue()` for any field
  with `inheritFrom`, so filtering matches what the field *resolves to* rather than its raw stored
  cell — a square that leaves `construction_type` blank and inherits it from its design is now found
  by the Construction filter, not just squares that explicitly override it. This was the one thing
  [ADR 0016](adr/0016-field-level-inherited-values.md) deliberately left undone when `inheritFrom`
  shipped; see its updated "Consequences".
- Stats screen: two new breakdowns, both counting only finished (`done`/`blocked`) squares by their
  *effective* construction type (own value, or the design's when blank — same `effectiveValue()` hop).
  "Finished, by construction" is a tally card like the existing status/colour/design ones. "Colour
  imbalance by construction" lists main colours whose finished-square count differs across
  construction types — e.g. a colour made in 10 solid squares but only 6 holey ones shows "4 short in
  holey" — comparing every construction the schema defines (`squares.json`'s `construction_type`
  options), not just ones seen in the data, so a colour entirely missing from one construction still
  shows the full gap instead of being silently skipped.
- `effectiveValue()` (`core/schema/search.ts`) now trims both the row's own value and the value found
  via `inheritFrom` before returning them. `validateValue`'s enum check already trims before comparing
  to `options`, so a hand-edited cell like `"solid "` passes validation — but without trimming here
  too, that same value fails every exact-match comparison against the clean option string downstream,
  which made a colour with such a cell vanish from "Colour imbalance by construction" entirely (every
  deficit computed to zero) rather than showing the gap it should have.

**Tests**
- `queue.test.ts`: `commitMessage` includes field labels and values in the body, and omits the id
  field (already implied by the `table/rowId` address on the line).

## 2026-08-18 — v0.1.6, construction type with field-level inheritance

**Data**
- `FieldDef` gains `inheritFrom: { via, throughField }` — same via/throughField hop shape
  `derivedFilters` uses, but resolved against the field's own value: blank means "read `throughField`
  off the row `via` points at." `buildSchemaSet` validates both ends exist, the same way it already
  does for `derivedFilters`. See [ADR 0016](adr/0016-field-level-inherited-values.md).
- New `construction_type` field (`solid` / `holey`) on both `designs.json` and `squares.json`.
  `squares.construction_type` sets `"inheritFrom": { "via": "design_id", "throughField":
  "construction_type" }`: a square leaves it blank to use its design's value, or sets it to override
  just that square. Both CSVs gain the column, blank for every existing row — additive, per the schema
  evolution policy.

**App**
- `effectiveValue()` (`core/schema/search.ts`) resolves a field's own value or, when blank, its
  inherited one. `RecordDetail` shows the resolved value with a "(from design)" note when it came from
  the hop; `RecordForm` shows the same resolution live under a blank input, read off the current draft
  so switching designs before saving updates the hint.

**Tests**
- `schema.test.ts`: parsing `inheritFrom` and rejecting a `via` that isn't a `ref` field or a
  `throughField` missing on the target table, mirroring the existing `derivedFilters` cases.
- `search.test.ts`: `effectiveValue` — own value wins when set, falls back through the hop when blank,
  stays blank (not falsely "inherited") when the hop also resolves to blank or `via` itself is empty.

## 2026-08-18 — v0.1.5, yarn stash filters/sort, remembered list state, print colourway

**Data**
- `FieldDef` gains `filterMode` (`"min"` on a `"filter": true` number field offers "N or more"
  thresholds instead of an exact-value dropdown). `TableSchema` gains `defaultSort` (`{ key,
  direction? }`, the sort a list opens with on a device before the person picks their own; `key` must
  be `"id"`, `"title"`, or a field marked `"sortable": true`, checked by `buildSchemaSet` the same way
  `idField`/`titleField` are).
- `yarns.json`: `name` (Colourway) and `skeins` (Skeins left) are now `"sortable": true`; `skeins`
  gains `"filter": true, "filterMode": "min"` so the Yarns list can answer "what do I have at least 2
  of" and "what am I out of" without a dropdown of every exact count on file. `designs.json` sets
  `"defaultSort": { "key": "source" }` — the Designs list now opens grouped by source, since "everything
  from this book" is the more common way to want to see it, instead of by id.
- `yarns.csv` gains the 30 colourways of Hobbii Friends Cotton 8/4 **Print** (a distinct product line
  from the 100 solid Cotton 8/4 shades already on file, with its own, overlapping shade numbering —
  `product_id` "01" exists in both lines). `display_name` is set explicitly for each
  (`"P01 (Summer Sunrise)"`, the `P` distinguishing a print shade number from a solid one) rather than
  left to `titleFallback` as the solid line's rows are, precisely because the two lines' numbers
  collide. `hex` and `skeins` are left blank/zero for the owner to fill in by hand, same reasoning as
  the original seed: no reliable source gives a single representative swatch colour for a
  multi-coloured print, and a guessed one would be actively misleading.

**App**
- `RecordList` (`ui/RecordList.tsx`): filter dropdowns now match through a per-descriptor `matches`
  function instead of bare equality, so a `"min"` field can filter by threshold instead of exact value.
  Sort gains an ascending/descending toggle, and every sort — built-in or field-based — now breaks ties
  by title then id (previously ties fell back to whatever order the rows already happened to be in,
  which was id order; a table sorted by something other than id, like Designs by source, wants its ties
  broken by name, not silently by id). The built-in "sort by title" key changed from `"name"` to
  `"title"`: a table can now mark a field literally named `name` `"sortable"` (`yarns.name`, the
  colourway) without colliding with the built-in title sort. A list opens on its schema's
  `defaultSort`, or id, until the person picks a sort/filter of their own — from then on their choice
  is remembered per table in `Prefs.lists` (new `ListPrefs` in `core/prefs`) and restored next visit,
  device-local like the rest of `core/prefs`. `App.tsx` now mounts the generic list with `key={table}`
  so switching tables always gets a fresh instance — needed for a freshly-opened table to actually pick
  up its own remembered/default state instead of inheriting whatever the previously-viewed table's
  `RecordList` instance still had in memory.
- `RefListInput` (`ui/fields.tsx`): with the search box empty, shows only already-selected chips —
  like a mail client's Bcc field — instead of the whole referenced table. Typing narrows the offered
  chips to matches, same as before; selected chips still stay visible regardless of the query. Needed
  once `extra_yarns` had 130 possible colours to scroll past on a phone before typing a search. See the
  updated [ADR 0014](adr/0014-live-search-combobox-for-every-ref-field.md).
- New `YarnsPage` (`features/yarns/YarnsPage.tsx`), registered in `TABLE_LIST_OVERRIDES`: each row now
  shows a skeins-left badge and a "Partial" badge, which a generic row has no field type to render.

**Tests**
- `schema.test.ts`: parsing and validating `filterMode` (accepted values, rejects anything else) and
  `defaultSort` (accepts `"id"`/`"title"` unconditionally, accepts a `"sortable"` field, rejects one
  that is not).

## 2026-08-18 — v0.1.4, searchable ref pickers, resolved filters, derived filters, sort

**Data**
- `FieldDef` gains `searchFields` (`ref`/`reflist` only: which fields on the *referenced* row a live
  search matches — omit to search every field) and `sortable` (offer this field as a sort option in
  list views). `TableSchema` gains `searchFields` (which of the table's own fields its list search box
  matches — omit to search every field) and `derivedFilters` (filters computed by hopping through a
  `ref` field to a field on the table it points at, for filtering by something the table does not
  store directly). `buildSchemaSet` validates a `derivedFilters` entry's `via`/`throughField` the same
  way it already validates `refTable` — both ends have to exist once every schema is loaded. See
  [ADR 0014](adr/0014-live-search-combobox-for-every-ref-field.md) and
  [ADR 0015](adr/0015-derived-filters-instead-of-a-materialised-column.md).
- `designs.json` sets `"searchFields": ["name"]` (the Designs list search matches the design name, not
  the source it resolves through) and marks `source` `"sortable": true`. `squares.json`'s `design_id`
  sets `"searchFields": ["name", "source"]` (picking a design searches by book as well as by name) and
  the table gains a `derivedFilters` entry filtering squares by source, hopping `design_id` to the
  design's `source`.

**App**
- Every `ref`/`reflist` field is now a live-search combobox instead of a bare `<select>`/chip grid —
  practical once a table has more than a handful of rows, e.g. one design per square.
  `RefSelect`/`RefListInput` (`ui/fields.tsx`) become `RefSearchSelect` and a search-augmented
  `RefListInput`, both built on `matchesSearch`/`searchText` (new `core/schema/search.ts`):
  case-insensitive, matches any part of the text, `*`/`?` wildcards. `RefListInput` keeps already-
  selected chips visible regardless of the current search text.
- `RecordList` (`ui/RecordList.tsx`) resolves `ref`/`reflist` cells to their titles for search, filter
  option labels and sort, instead of matching/showing the raw stored id — a filter dropdown now reads
  "Granny Stripe" rather than "D03", and searching "granny stripe" finds a square by its design's name.
  Filter dropdowns are built from fields marked `"filter": true` plus the schema's `derivedFilters`.
  `DefaultRow`'s subtitle resolves the same way, so the Designs list now shows the source's name
  instead of its id.
- `RecordList` gains a sort control: id and title are always offered, plus any field marked
  `"sortable": true`, sorted by the field's resolved (title, for a `ref`) text.
- Progress screen's "Squares finished" count (`SquaresPage.tsx`) now counts `blocked` alongside `done`,
  matching the Progress screen's own "Finished" stat — it had regressed to `done`-only when `blocked`
  became a `status` value. The "in progress, by main colour" tally is now "Finished, by main colour":
  it counts `done`/`blocked` squares instead of `in progress` ones, consistent with `status`'s default
  of `done` and with every other "finished" number on the screen.

**Tests**
- `core/__tests__/search.test.ts`: `matchesSearch` (substring, case-insensitivity, wildcards, regex-
  unsafe input), `searchText` (ref resolution, key restriction, dangling references),
  `refDisplayLabel`, `derivedFilterField`/`derivedFilterValue`.
- `schema.test.ts`: parsing `searchFields`/`sortable`, and `buildSchemaSet` accepting a valid
  `derivedFilters` entry and rejecting a `via` that is not a `ref` field or a `throughField` that does
  not exist on the target table.

## 2026-08-18 — v0.1.3, sources table, yarn display names, blocked as a status

**Data**
- New `sources` table (`data/sources.csv`, `data/schema/sources.json`): `name`, `type`
  (`book`/`website`), `url`, `note`. `designs.source` is now a `ref` to it (with `quickCreate`)
  instead of retyped free text; the old `designs.source_url` is gone, since a source's URL now lives
  on the source once instead of per design. `sources` sets `"hideFromNav": true` — no tab of its own,
  reached by tapping the source chip on a design. See
  [ADR 0012](adr/0012-hidden-tables-for-lookup-only-data.md).
- `squares.status` gains `blocked` (the stage after `done`) and drops `frogged` (never actually used —
  a frogged square is deleted, not tracked). The old standalone `blocked` boolean field is removed;
  blocking is a status now, not an independent flag that could combine with any other status.
- `yarns.csv` gains `display_name` (the new `titleField` — your own nickname, shown as "colour"
  everywhere a yarn is referenced) and `partial_skein` (bool: at least one skein on hand is started).
  `yarns.json` sets `"titleFallback": "{product_id} ({name})"` so a blank `display_name` shows
  something legible rather than a bare id. See
  [ADR 0013](adr/0013-title-fallback-template.md).
- `yarns.csv` seeded with the 100 colourways of Hobbii Friends Cotton 8/4 (`product_id` = Hobbii's own
  shade number), `skeins: 0`, `hex` and `display_name` left blank for the owner to fill in by hand —
  no reliable public source gave per-shade hex values, and a guessed swatch colour would be actively
  misleading.

**App**
- New `core/prefs/` module: a device-local "project start date" (`YYYY-MM-DD`), same load/save-to-
  `localStorage` shape as `core/github/config.ts`. Set from a new "Project" section in Settings.
- Progress screen: the "Pace" window shrinks to however long the project has actually been running
  when that is less than the usual 4 weeks, instead of always dividing by 4 — otherwise a project in
  its second week reads as a quarter of its real pace. Falls back to the old fixed 4-week window when
  no start date is set. "Finished"/"Blocked" now read off `status` instead of the removed `blocked`
  field.
- `titleFor(schema, row)` (`core/schema/types.ts`) centralises "what to show for this row": `titleField`,
  else `titleFallback` with its `{key}`s filled in, else the row id. Every place that used to read
  `row[schema.titleField] || id` directly (`ui/fields.tsx`, `ui/RecordList.tsx`, `StatsPage.tsx`) now
  calls it, so `display_name`'s fallback is consistent everywhere instead of only where someone
  remembered to add it.
- `RefChip` (`ui/fields.tsx`) is now a link to the referenced record's detail page — the only way to
  reach a `hideFromNav` table's row short of typing the URL.

## 2026-08-18 — v0.1.2, quick-create designs from the square form

**Data**
- `ref` fields can set `"quickCreate": true` (`core/schema/types.ts`, parsed in `core/schema/load.ts`).
  `squares.design_id` now uses it, since most squares turn out to be a one-off design and a separate
  "new design" screen for each one was pure friction. See
  [ADR 0010](adr/0010-quick-create-instead-of-folding-designs.md).

**App**
- `RefSelect` (`ui/fields.tsx`) renders a "+ New &lt;thing&gt;" affordance under a `quickCreate` ref
  field. It creates a row in the target table with only its title set, via the same `appStore.save`
  a normal edit uses, then selects it — no navigation away from the form in progress.

**Fixed**
- Dev server: the `data/bundle.json` middleware in `vite.config.ts` matched the request path without
  the configured `base` (`/grannydb/`), so it never matched, `readFromBundle` silently fell through to
  fetching the *live* GitHub repo, and a local CSV/schema edit had no effect until pushed — despite
  the comment above the plugin claiming otherwise. Now matches `${base}data/bundle.json`.

**Data**
- `data/*.csv` cleared of the original demo/seed rows (already done on `main` in a prior commit;
  reconciled here rather than reintroduced).

**Tests**
- `app.render.test.tsx` now mounts against a small frozen fixture dataset
  (`src/core/__tests__/fixtures/data/`) instead of the real `data/*.csv`, which had started breaking
  the test purely by having its seed rows cleared — a change with nothing to do with whether the app
  still renders. `buildBundle` takes an optional `dataDir` so the test can point it at the fixture.
  See [ADR 0011](adr/0011-fixture-data-for-the-render-test.md).

## 2026-08-17 — v0.1.1, yarn product line and in-progress colour breakdown

**Data**
- `yarns.csv`: `brand` renamed to `product_line` (better matches what was actually being recorded,
  e.g. "Scheepjes Chunky Monkey"), and a new `product_id` column for the manufacturer's shade code.
  Schema and CSV renamed together since the data has not been deployed/synced by any client yet, so
  the usual [two-step rename](02-data-model.md#schema-evolution-policy) was not needed.

**App**
- Progress screen: new breakdown of squares currently `in progress`, tallied by main colour only
  (extra colours excluded), to answer "what am I holding right now" separately from the existing
  all-status, main-plus-extra colour reach tally.

## 2026-08-17 — v0.1.0, first build

The initial working app.

**Data**
- Three CSV tables in `data/`: `squares`, `yarns`, `designs`, with seed rows.
- Schemas in `data/schema/`, loaded at runtime and driving forms, lists, filters and validation.

**Core**
- Round-trip-safe CSV layer: real parser, deterministic minimal quoting, stable ordering, and
  preservation of columns and rows the app does not know about.
- Schema layer: loader with cross-table checks, field validation including referential integrity.
- GitHub storage: reads pinned to a commit sha, content-addressed blob cache, atomic multi-file
  commits via the Git Data API with fast-forward-only ref updates.
- Sync engine: durable field-level operation log in IndexedDB, replayed onto freshly fetched data,
  retrying on a moved branch.

**App**
- Squares list with search, filters, colour swatches and progress toward 400.
- Schema-driven detail and edit views for every table.
- Yarns and designs CRUD from the same generic components.
- Progress screen: counts, pace, breakdowns by status, colour and design.
- Settings: token entry with a permissions probe, data-location config, status.
- Sync screen: pending changes, one-tap push, per-change discard.
- Mobile-first shell: bottom nav, safe-area insets, 44px targets, dark mode.

**Pipeline**
- `scripts/build-data.ts` emits `data/bundle.json` and fails the build on invalid data.
- GitHub Actions: typecheck, test, validate, build, deploy to Pages on every push to `main`.

**Tests** (77)
- CSV round-tripping, unknown-column preservation, quoting, id generation.
- Queue collapsing rules, replay ordering, field-level merge.
- Schema loading and whole-dataset validation.
- The full commit protocol against a fake GitHub that enforces fast-forward-only ref updates,
  including replay after the branch moves mid-sync.
- One end-to-end mount of the app against the real data files.

**Fixed during the first verification pass**
- CSV delimiter is now pinned to `,` rather than auto-detected. Auto-detection guesses from
  character frequency, and `extra_yarns` is a semicolon-delimited list, so a file with enough
  multi-colour squares could have been parsed completely wrong. It also failed outright on a
  single-column file.
- `idb-keyval` touches `indexedDB` synchronously, so it throws before returning a promise when
  storage is unavailable and a trailing `.catch()` never attached. Both the blob cache and the
  change queue would have crashed the app at startup in private browsing. Now wrapped, and a failed
  queue write sets `queueDurable` false and warns on the sync screen instead of silently pretending
  edits are safe.

**Docs**
- `docs/` with six pages, nine ADRs, and this changelog.
