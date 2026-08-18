# Changelog

What changed and when. One entry per shipped change, newest first.

Update this in the same commit as the change, not afterwards. See [README](README.md#keeping-these-current).

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
