# 5. App architecture

## Module boundaries

```
src/
  core/            no React. Pure TypeScript, testable without a DOM.
    csv/           parse, serialize, row operations
    schema/        types, loader, validation, search/filter/sort resolution, cross-table counts
    github/        config, HTTP client, snapshot reads, commits, auth
    prefs/         device-local app preferences (project start date, per-table list filters/sort)
    store/         change queue, merge, sync, the app store
  ui/              shared React: primitives, field renderers, generic list/detail/form
  features/        one folder per screen that is more than "a table"
  app/             router, hooks, shell
scripts/           the data pipeline (runs in Node)
```

**The rule that matters: `core/` imports no React.** Two reasons, both practical.

First, [`scripts/build-data.ts`](../scripts/build-data.ts) imports `core/csv` and `core/schema`
directly and runs them in Node during the build. The rules CI enforces and the rules the app
believes are literally the same code, so they cannot drift.

Second, everything interesting — CSV round-tripping, queue collapsing, replay semantics, the whole
commit protocol — is testable by calling functions. All but one of the test files run in a plain
Node environment with no DOM. That is why the tests are fast and why they are about behaviour
rather than markup.

The one deliberate deviation from the original plan: field types were going to live entirely in
`core/schema/fieldTypes.tsx`. They ended up split — validation in
[`core/schema/validate.ts`](../src/core/schema/validate.ts), rendering in
[`ui/fields.tsx`](../src/ui/fields.tsx) — precisely to keep `core/` React-free. Adding a field type
touches both halves.

## Extension points

Four places designed to be extended. Adding a feature should mean touching one of them, not
threading a change through the app.

### 1. Add a field → edit JSON

Add a column to the CSV and an entry to `data/schema/<table>.json`. Form control, list column,
filter and validation all appear. No code, no deploy.

### 2. Add a table → add a schema file

Create `data/schema/things.json`, add `"things"` to `tables.json`, create `data/things.csv`. You get
a nav tab, a list with search and filters, a detail view, an editor, and validation. `App.tsx`
resolves table routes generically from `schemas.order` — it has no idea which tables exist. Set
`"hideFromNav": true` in the schema to skip the tab for a table that exists mainly as a lookup for
other tables' `ref` fields — it stays fully routable at `/things`, just off the tab bar. See
[ADR 0012](adr/0012-hidden-tables-for-lookup-only-data.md).

### 3. Add a field type → two entries

A `parse`/`validate` case in [`core/schema/validate.ts`](../src/core/schema/validate.ts), and an
`Input`/`Display` pair in [`ui/fields.tsx`](../src/ui/fields.tsx). This is the path for `image`,
`rating`, `multi-enum`, `duration`.

### 4. Add a custom screen → `FIXED_ROUTES`

Non-table screens (Progress, Settings, Sync) are entries in `FIXED_ROUTES` in
[`App.tsx`](../src/app/App.tsx). A table that wants a custom list registers a renderer in
`TABLE_LIST_OVERRIDES` and inherits everything else: `squares` does, for the colour swatches; `yarns`
does, for the skeins-left/partial-skein badges and the active/usage information below; and `designs`
does, for its squares-used count — none of which a generic row has a field type to show, because none
of them are schema fields (see [ADR 0022](adr/0022-computed-counts-and-a-recordlist-escape-hatch.md)).

`App.tsx` mounts the generic `<RecordList>` with `key={table}`, so switching tables (Designs → Yarns
in the bottom nav) always gets a fresh component instance instead of one React reuses in place —
otherwise the previous table's search text and in-memory filter state would leak into the next
table's list until something else happened to remount it.

## State

One store, [`appStore`](../src/core/store/appStore.ts), read by React through
`useSyncExternalStore`. No state library.

That is a real choice, not laziness. The app has exactly one dataset, one queue and one sync
operation. A store framework would add indirection around logic that is more valuable as plain
functions — and `core/store` staying framework-free is what lets the sync engine be unit-tested and
lets the same merge function serve both the screen and the commit.

```
appStore.state = {
  snapshot     // base data + schemas, pinned to a commit sha
  changes      // the pending operation log
  data         // snapshot + changes, recomputed on either change  ← screens read this
  queueDurable // false once a queue write has failed; drives the storage warning
  token, config, prefs, phase, syncing, lastSync, error, syncError
}
```

`data` is recomputed inside `set()` whenever `snapshot` or `changes` changes, so it can never be
stale relative to its inputs. Hooks in [`app/hooks.ts`](../src/app/hooks.ts) expose slices:
`useTable`, `useRow`, `useLookup`, `usePendingCount`, `useCanEdit`.

`reload()` guards against out-of-order responses with a ticket counter — a slow load kicked off
before a config change must not overwrite a fast one kicked off after it.

## Routing

Hash-based, ~50 lines in [`app/router.ts`](../src/app/router.ts), no dependency.

GitHub Pages serves this from `/grannydb/` and has no server to rewrite deep links. With History API
routing, opening `/grannydb/squares/S001` directly asks the server for a file that does not exist —
the usual workaround being a `404.html` that re-serves the app. With a hash the browser never sends
the path at all. Deep links work, refresh works, the back button works, and there is no deploy trick
to remember. See [ADR 0007](adr/0007-stack-and-hash-routing.md).

Routes, matched most-specific first:

```
/                      → redirect to /squares
/stats /settings /sync → FIXED_ROUTES
/:table/new            → RecordForm
/:table/:id/edit       → RecordForm
/:table/:id            → RecordDetail
/:table                → RecordList (or an override)
```

Fixed routes are checked before `/:table` so `/settings` is not read as a table named "settings".

## The generic CRUD components

Three components in `ui/` serve every table:

- **[`RecordList`](../src/ui/RecordList.tsx)** — search across cells (restricted to the table's
  `searchFields` if it sets any, otherwise every field), filter dropdowns built from fields marked
  `"filter": true` (numeric ones can set `"filterMode": "min"` for "N or more" thresholds instead of
  an exact-match dropdown) plus the schema's `derivedFilters`, a sort panel, unsynced badges. Accepts a
  `renderRow` override. The sort panel offers id, title and any field marked `"sortable": true` as a
  priority-ordered list the person builds themselves — add a key, toggle its direction, reorder or
  remove it — not a single field-plus-direction pair; every rule breaks ties left by the ones before
  it, then title, then id, so the result order is always fully determined. See
  [ADR 0023](adr/0023-priority-ordered-multi-key-sort.md). The list opens on the schema's `defaultSort`
  (plus `defaultSort.thenBy`, or id if it sets neither) the first time it is visited on a device; after
  that, whatever filters and sort rules the person builds are saved to `Prefs.lists[table]`
  (`core/prefs`) and restored next time — device-local, not synced.
  A page can also pass `extraSortOptions`/`extraFilters` — the same shapes `sortableFields`/
  `filterFields` build from the schema, but supplied by the caller for a value that has no field to
  scan, e.g. a cross-table count. `YarnsPage` and `DesignsPage` both use this for counts computed by
  [`core/schema/relations.ts`](../src/core/schema/relations.ts); see
  [ADR 0022](adr/0022-computed-counts-and-a-recordlist-escape-hatch.md). The same module's
  `squareConstructionInsights` (construction-type tallies, colour imbalance, and squares missing a
  main colour or design) backs both the Squares list's progress header and the Progress screen's
  matching cards, one aggregation pass shared instead of two.
  List rows generally float their badges to one side (`BadgeStack` in `ui/components.tsx`) so a long
  title or subtitle wraps under them instead of being truncated to make room.
- **[`RecordDetail`](../src/ui/RecordDetail.tsx)** — every field via its `Display`, edit and delete,
  a link to the underlying CSV on github.com.
- **[`RecordForm`](../src/ui/RecordForm.tsx)** — every field via its `Input`, validation on save
  including referential integrity, sticky save bar.

Search, filter options and sort all read a `ref`/`reflist` field by its *resolved* value — a design's
name, not its `D03` id — via `searchText`/`refDisplayLabel` in
[`core/schema/search.ts`](../src/core/schema/search.ts), so a search for "granny stripe" finds a
square by design name and a filter dropdown lists design names instead of ids. The same module backs
the live-search combobox `ref`/`reflist` fields use in the form (see
[ADR 0014](adr/0014-live-search-combobox-for-every-ref-field.md)) and the cross-table hop a
`derivedFilters` entry reads through (see
[ADR 0015](adr/0015-derived-filters-instead-of-a-materialised-column.md)).

Search is still a linear scan over every cell on each keystroke, resolving any `ref`/`reflist` cell it
touches along the way. At 400 rows that is imperceptible, and an index would have to be kept in step
with the pending queue — complexity buying nothing.

## Mobile conventions

Used mostly one-handed, on a phone, sometimes standing up:

- **Bottom tab bar**, not top — thumb reach. `pb-safe` for the home indicator.
- **44px minimum touch targets** via the `tap-target` utility.
- **16px minimum font size on inputs**, otherwise iOS zooms the viewport on focus.
- **Sticky search** with `enterKeyHint="search"` and `inputMode` hints for the right keyboard.
- **Sticky save bar** so Save is reachable on a long form without scrolling.
- **Tap-to-toggle chips** for multi-select instead of a `<select multiple>`, which is close to
  unusable on a phone. Selection order is shown, because for a square the order colours were worked
  in is real information.
- **Colour swatches everywhere** — the fastest way to recognise a square on a small screen. One
  yarn's colours are always equal stripes filling its shape; a wedge always means a separate yarn
  ([ADR 0021](adr/0021-colourway-as-stripes-clipped-to-its-shape.md)).
- **No hover-dependent affordances.**
- **Dark mode** via `prefers-color-scheme`, both palettes defined explicitly in
  [`styles.css`](../src/styles.css).

## Testing

[`src/core/__tests__/`](../src/core/__tests__/), run with vitest in a Node environment.

Coverage is deliberately concentrated where a bug loses data rather than annoys you:

| File | Covers |
|---|---|
| `csv.test.ts` | quoting, round-trip safety, unknown-column preservation, partial upsert, id generation |
| `queue.test.ts` | collapsing rules, replay ordering, field-level merge against remotely-changed data |
| `schema.test.ts` | field validation, schema loading errors, whole-dataset integrity |
| `sync.test.ts` | the full commit protocol against a fake GitHub, including conflict replay |
| `router.test.ts` | route matching and specificity ordering |
| `app.render.test.tsx` | one end-to-end mount against a frozen fixture dataset (`src/core/__tests__/fixtures/data/`), not `data/*.csv` — real tracker data changes shape and content on its own schedule and has nothing to do with whether the app mounts |

`sync.test.ts` is the important one. It stands up a fake GitHub that enforces fast-forward-only ref
updates, then moves the branch in the window between our read and our write. That is the design's
central claim — a conflict is recoverable by replaying, not a lost edit — and it is worth testing
rather than trusting the prose.

`app.render.test.tsx` is a single smoke test, not a component suite. Typechecking cannot catch a
crash at mount (a hook called conditionally, a value read before it loads), and finding that out on
a phone is a bad way to find out. It mounts the whole app against a small fixture dataset — not the
real CSVs, which are live tracker data with no reason to stay shaped a certain way for a test's sake
— and asserts a few things rendered. There is deliberately no per-component coverage: rendering is
the least risky part of this app and the most churn-prone.
