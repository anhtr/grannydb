# ADR 0020 — `defaultSort` gets an optional secondary key, not a compound sort picker

**Status:** accepted · 2026-08-19 · the "no compound picker" call is superseded by
[ADR 0023](0023-priority-ordered-multi-key-sort.md); `thenBy` itself is unchanged

## Context

Squares needed more sort options — by construction, by main colour, by design, alongside the existing
id and date — which is just marking more fields `"sortable": true`; the generic dropdown
(`RecordList.tsx`) already turns any sortable field into an option. But the *opening* order asked for
was two-level: group by main colour, and within a colour, by construction — something no single
`sortKey` expresses, since every sort (built-in or field-based) currently breaks ties by title then id,
not by a second field of the schema's choosing.

## Options

**A compound sort picker in the UI** — let a person choose a primary *and* a secondary field from the
dropdown, for any table, at any time. The most general answer, but a second `<select>` next to the
first doubles the sort control's surface for a need that, so far, is exactly one table wanting exactly
one specific secondary key as its *default* — not a general "sort by two things" feature anyone has
asked to control themselves yet.

**Hard-code the tie-break for squares specifically** — special-case `SquareRow`'s sort. Solves this one
table but is exactly the kind of per-table branch the schema-as-data approach
([ADR 0005](0005-schema-as-data.md)) exists to avoid; the next table that wants the same thing gets its
own special case instead of a schema flag.

**`defaultSort` gains an optional `thenBy`.** A second key, same restriction as `key` itself (`"id"`,
`"title"`, or a sortable field), used only to break ties on the *default* sort — not a general
secondary-sort control. Minimal schema surface, no new UI element, and generalises to any table that
wants the same shape of default without new code.

## Decision

`thenBy` (plus optional `thenDirection`). Parsed in
[`core/schema/load.ts`](../../src/core/schema/load.ts) with the same "must be id/title/sortable" check
`key` already gets. `squares.json` sets `{ "key": "main_yarn", "thenBy": "construction_type" }`.

In [`ui/RecordList.tsx`](../../src/ui/RecordList.tsx), `sortRows`/`compareValues` now took a `SortSpec`
(`{ key, field, dir }`) instead of three loose parameters, so a primary and an optional secondary spec
shared one comparison function. The secondary spec was only built when the list's *current* sort key
still equalled `defaultSort.key` — the moment a person picked a different primary sort from the
dropdown, the secondary tie-break was dropped, since a person who asked to sort by Design was not
asking for construction to keep quietly shaping the order underneath it.
**As of [ADR 0023](0023-priority-ordered-multi-key-sort.md), this paragraph is history, not current
behaviour**: `sortRows` takes a `SortSpec[]` now, `thenBy` only seeds the person's own editable list of
sort rules, and the gating condition described above no longer exists.

Making `construction_type` sortable also exposed a latent gap: `compareValues` was reading a sort
field's raw stored cell, which for an `inheritFrom` field like `construction_type` is usually blank —
every square inheriting its construction from its design would have sorted as an empty string instead
of its actual effective value. Fixed alongside this change: sorting an inheriting field now resolves
`effectiveValue()` first, the same way filtering already did (see
[ADR 0016](0016-field-level-inherited-values.md)'s updated Consequences).

## Consequences

- `SortSpec` is exported from `RecordList.tsx` so `sortRows`/`compareValues` are unit-testable without
  mounting a component — see `ui/__tests__/RecordList.sort.test.ts`.
- Any table can add a `thenBy` to its own `defaultSort` for free; nothing beyond the two schema keys
  is required.
- A compound *user-facing* sort picker was not built at the time — superseded by
  [ADR 0023](0023-priority-ordered-multi-key-sort.md), which built exactly that once it was actually
  asked for.
