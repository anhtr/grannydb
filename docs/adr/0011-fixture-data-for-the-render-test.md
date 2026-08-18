# ADR 0011 — The render smoke test uses fixture data, not `data/*.csv`

**Status:** accepted · 2026-08-18

## Context

`app.render.test.tsx` built its bundle straight from the real `data/*.csv` files and asserted on
specific seed rows (`S001`, `Classic Granny`, `Cream`, `Dusty Rose`...). That worked as long as the
real data held still.

It stopped holding still: `data/*.csv` is a live tracker, and the demo/seed rows were deliberately
cleared down to headers-only directly on `main`. The test's job — does the app still mount and render
without crashing — has nothing to do with what is currently in the tracker, but the test broke anyway,
and would break again on the next data edit of any kind (a column rename, a cleared table, a renamed
design).

## Options

**Rewrite the assertions to match whatever is in `data/*.csv` today.** Smallest patch. Wrong shape of
fix: it makes the test pass right now and guarantees it breaks again the next time the tracker's real
content changes, which is often — that is what a tracker is for.

**Assert only on structure, not content** (nav labels, headings, "Read-only" text). Stops depending on
row content, but gives up the one thing this smoke test is actually good at catching: that `ref` and
`reflist` fields resolve to another table's row and render correctly. That path is exactly where a
schema change is likely to break something silently.

**A small frozen fixture dataset, used only by this test.** Keeps full coverage, including reference
resolution, and decouples "does the app mount" from "what does the tracker currently contain" — which
were never actually the same question.

## Decision

Fixture data, at
[`src/core/__tests__/fixtures/data/`](../../src/core/__tests__/fixtures/data/): a manifest, three
schema files, and three CSVs with two or three rows each, enough to exercise `ref` and `reflist`
resolution. `buildBundle` in
[`scripts/build-data.ts`](../../scripts/build-data.ts) took a `dataDir` parameter (default `data`, the
real directory used by the build and by `validate-data`) so the test can pass the fixture path instead.

## Consequences

- The render test no longer changes behaviour when the tracker's real data does. Clearing every row,
  renaming a column, adding a table — none of it should touch this test unless the *shape* the app
  depends on (a schema field, a route) actually changed, in which case the fixture schema files need
  the same edit.
- The fixture schema files are a second copy of the field definitions, which can drift from
  `data/schema/*.json` if a field is added to one and not the other. Accepted: the fixture only needs
  to keep pace with structural changes, which are already required to update docs and pass
  `validate-data` — a forgotten fixture update fails this test loudly rather than silently.
- `data/*.csv` stays exactly what its name says: the actual tracker, free to be edited, cleared, or
  reshaped without needing to keep a test suite happy.
