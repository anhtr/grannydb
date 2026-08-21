# ADR 0023 — Sort becomes a user-editable, priority-ordered list of keys

**Status:** accepted · 2026-08-20 · supersedes the "not built" call in [ADR 0020](0020-default-sort-secondary-key.md#consequences)

## Context

[ADR 0020](0020-default-sort-secondary-key.md) added `defaultSort.thenBy` — a second key that only
breaks ties on a table's *default* sort, and only while that default is still the active one. It
explicitly declined to build a general, person-controlled compound sort, on the grounds that only one
table wanted one specific secondary key and nothing had asked for more.

Something has now asked for more: sort by more than one field, of your own choosing, in whatever
priority you want (e.g. squares by design, then by construction within a design — not the schema's
`main_yarn`/`construction_type` pairing). `thenBy`'s restriction is exactly the wrong shape for this —
it is gated on "is this still the default sort", which is precisely what a person overriding the sort
their own way is not doing.

## Options

**Add a second `<select>` next to the first**, mirroring `thenBy` but person-controlled. Cheapest
change, but caps priority at two keys and still needs a third control (or a cap) the next time someone
wants to break a tie a level further — squares alone already has four sortable fields plus id/title.

**A priority-ordered list the person builds**, any number of keys, reorderable. More UI (a panel
instead of two inline controls) but the one shape that does not need revisiting again if a third or
fourth tiebreaker is ever wanted, and it subsumes `thenBy` cleanly: the schema's `defaultSort` (plus
`thenBy`) just becomes the *seed* of that list rather than a separately-gated mechanism.

## Decision

The priority-ordered list. `ListPrefs.sortKey`/`sortDir` (`core/prefs`) become `sorts: SortRule[]`
(`{ key, dir }[]`), applied in array order — each rule only breaks ties left by the ones before it.
`RecordList.tsx`'s `sortRows`/`compareValues` take a `SortSpec[]` instead of a primary plus an optional
gated secondary; the old "only while `key` still equals `defaultSort.key`" special case is gone; a
person's added rules simply stay in the list until they remove them.

A new `SortPanel` replaces the old select-plus-arrow control: each active rule shows as a numbered row
with an ascending/descending toggle, up/down buttons to change its priority, and a remove button, plus
an "add a field" dropdown for anything not already in the list. Reordering is up/down buttons rather
than drag-and-drop — it works the same on touch and with a screen reader, without a drag
implementation to maintain for what, at these list sizes (tens of fields, not hundreds of rows), is a
short list.

`defaultSort`/`defaultSort.thenBy` keep their schema meaning unchanged: the sort a list opens with
before anyone has picked their own. They now seed the *initial* `sorts` array (`defaultSorts()` in
`RecordList.tsx`) instead of driving a runtime-gated tie-break — `squares.json`'s
`{ "key": "main_yarn", "thenBy": "construction_type" }` still opens the list sorted by colour then
construction, exactly as before, but a person can now add a third key, reorder the two seeded ones, or
remove one, same as any sort they build from scratch.

An existing device's saved `{ sortKey, sortDir }` (pre-dating this change) is read once and converted
to a one-rule `sorts` array on load, so shipping this does not silently reset anyone's remembered sort.

## Consequences

- `ListPrefs` (`core/prefs/index.ts`) changes shape; the migration above is the only thing depending on
  the old fields, and it can be deleted once no device is expected to still be carrying the old shape.
- `sortRows` is simpler, not more complex, despite doing more: one loop over `SortSpec[]` replaces the
  primary/secondary special case, and the gating condition ADR 0020 needed is gone entirely because
  nothing needs gating — ties are broken by whatever is actually in the list.
- [ADR 0020](0020-default-sort-secondary-key.md)'s Decision and the mechanics it describes (the gated
  secondary spec) are historical — they explain why `thenBy` exists and what it originally did, but the
  gating behaviour itself no longer exists. Its Context and the choice of `thenBy` as a schema field
  stand; only the last Consequences bullet ("a compound sort picker is still not built") is corrected
  here.
- `ui/__tests__/RecordList.sort.test.ts` covers three-level tie-breaking, not just two, since the list
  no longer caps out at a primary and one gated secondary.
