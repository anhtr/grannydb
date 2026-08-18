# Changelog

What changed and when. One entry per shipped change, newest first.

Update this in the same commit as the change, not afterwards. See [README](README.md#keeping-these-current).

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
