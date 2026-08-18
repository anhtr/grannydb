# Changelog

What changed and when. One entry per shipped change, newest first.

Update this in the same commit as the change, not afterwards. See [README](README.md#keeping-these-current).

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
