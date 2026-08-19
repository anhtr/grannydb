# Changelog

What changed and when. One entry per shipped change, newest first.

Update this in the same commit as the change, not afterwards. See [README](README.md#keeping-these-current).

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
