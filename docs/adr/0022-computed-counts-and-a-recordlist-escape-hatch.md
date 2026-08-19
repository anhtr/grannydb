# ADR 0022 — Computed counts and flags stay unmaterialised; `RecordList` gets a computed-value escape hatch

**Status:** accepted · 2026-08-19

## Context

Three related asks: show each yarn's "active" status (in stash or in use, not just a stale row from a
finished project), show each yarn's squares-as-main and squares-as-extra counts, and show each
design's squares count — all sortable, and "active" also filterable. None of these are stored
anywhere; each is a property of the *relationship* between a `yarns`/`designs` row and every `squares`
row, not of the row itself.

## Options — where the values come from

**Materialise columns** (`active`, `square_count_main`, `square_count_extra` on `yarns.csv`; a count
column on `designs.csv`), updated whenever a square's yarn or design reference changes. Same
staleness problem [ADR 0015](0015-derived-filters-instead-of-a-materialised-column.md) already
rejected for the same reason: nothing in the sync engine's field-level merge
([ADR 0004](0004-operation-log-not-file-snapshots.md)) cascades an edit on one table into a computed
column on another, so a write-side migration would be new machinery for what is, underneath, a join.

**Compute at read time**, scanning `squares` once per render. `StatsPage.tsx` already does the same
shape of scan inline (`byDesign`, `byYarn` maps) for the Progress screen's tallies, so the pattern was
already proven at this data size (a few hundred rows) to be free.

## Decision

Read-time computation, in a new module: `core/schema/relations.ts` (`yarnUsageCounts`,
`isYarnActive`, `designSquareCounts`). Pulled out as `core/`, not left inline in the two feature
components the way `StatsPage` does its own version, because it needs to run inside `RecordList`'s
sort comparator on every keystroke of a search box — a plain, unit-tested function is the only shape
that fits both a component and a comparator. `StatsPage` was left as it was: its inline maps answer
different questions (yarn *reach* combining main+extra, finished-only tallies) and refactoring it to
share `relations.ts` was not needed to ship this.

`isYarnActive` treats "active" as *either* signal — stash or usage — not their conjunction: a yarn
with nothing left in stash but still cited by an old square is exactly the case worth keeping visible
(it explains a finished square's colour), and a yarn with fresh stash but no square yet is exactly the
case worth keeping visible too (it is queued to be used). Only a yarn that is neither drops out of an
"active" filter.

## Options — how the list surfaces it

Every existing sort key and filter dropdown in `RecordList` is schema-derived: `sortableFields()`
scans `schema.fields`, `filterFields()` does the same. A computed value has no field to scan.

**Special-case `YarnsPage`/`DesignsPage` with a second, bespoke sort/filter UI outside `RecordList`.**
Works, but throws away search, the other schema-derived filters, unsynced badges, and the
persisted-per-device sort/filter prefs ([`core/prefs`](../../src/core/prefs)) that `RecordList`
already provides — a parallel control bar next to the one `RecordList` renders internally.

**Teach `RecordList` a value-getter type it composes with the schema-derived options**, the same shape
[ADR 0020](0020-default-sort-secondary-key.md) chose for `thenBy`: extend the existing mechanism with
a minimal new surface rather than hard-code the one table that currently needs it or build a second,
general "sort by anything" system nobody else has asked for yet.

## Decision

`ComputedSortOption` (`{ key, label, value: (row) => number }`) and the existing internal
`FilterDescriptor` shape, now exported, both become optional `RecordListProps`: `extraSortOptions`,
`extraFilters`. `SortSpec` gains an optional `computed` alongside `field`; `compareValues` checks it
before falling through to the field/id comparison. The dropdown appends `extraSortOptions` after the
schema-derived ones and `extraFilters` after the schema-derived filter descriptors — one control bar,
one persisted-prefs mechanism, search and unsynced badges unchanged. `YarnsPage` passes two computed
sort options (main count, extra count) and one computed filter (active/inactive); `DesignsPage` — a
new file, since Designs previously used the generic `RecordList` unmodified — passes one computed sort
option (square count) and a `renderRow` that adds the count badge, mirroring how `YarnsPage` already
adds its skeins/partial badges.

Numeric-only by design: every current computed sort is a count. A computed value that sorts by label
rather than magnitude would need a different comparison shape and is not built until something
actually needs it — the same "generalise once two tables need it, not before" restraint ADR 0020
already applied to `thenBy`.

## Consequences

- Editing a square's yarn or design reference instantly changes what every affected count and the
  active flag reads as everywhere — one copy of the fact, same as ADR 0015/0016.
- `relations.ts` is unit-tested in isolation (`core/__tests__/relations.test.ts`), same pattern as
  `search.ts`/`search.test.ts`.
- `RecordList`'s sort/filter surface is now two-sourced (schema fields, computed options) instead of
  one; a third table that wants a computed sort or filter reuses `extraSortOptions`/`extraFilters`
  directly, no new mechanism.
- Designs now has a bespoke list page (`features/designs/DesignsPage.tsx`), registered in
  `TABLE_LIST_OVERRIDES` alongside squares and yarns — see
  [app-architecture, extension point 4](../05-app-architecture.md#4-add-a-custom-screen--fixed_routes).
