# ADR 0039 - Previous and next follow the list as it was last shown

**Status:** accepted · 2026-11-10

## Context

Checking a run of records - the twelve squares blocked last weekend, every yarn that is running low -
meant list, record, back, next record, back. The record page had no way to step to its neighbour.

"Neighbour" needs an order, and the order worth following is the one the person was just looking at:
the list as filtered, searched and sorted. That order is the output of a small pipeline in
`RecordList`: the search text (session memory), the saved filters and sort rules (`Prefs`), the
schema's filter descriptors, and whatever `extraFilters` and `extraSortOptions` the table's own page
passes in (`YarnsPage`'s cross-table counts, `SquaresPage`'s any-colour filter). The record page is a
different screen, mounted after the list has unmounted, and has none of that except the prefs.

## Options

**Work the order out again on the record page.** Always correct against the current data, and
survives a reload. But the pipeline would have to move out of `RecordList` into something both
screens call, and the extras are the obstacle: they are passed in by feature pages, so the generic
record page would need to know each table's page-specific filters, which is the dependency from
`ui/` on `features/` that the `extra` slot on `RecordDetail` exists to avoid. It also could not see
the search text without that leaving session memory too. Rejected.

**Carry the order in the URL.** The usual web answer, since it survives reloads and can be shared.
The app's hash routes carry no query strings, a list of 400 ids does not fit in one, and encoding
the filters instead comes back to the first option. Rejected.

**Carry only the two neighbours on the link**, set when a row is tapped (`history.state`). Cheap,
but it is good for one step: the next page would need its own neighbours, which only the list knew.
Rejected.

**Remember the list's last order in memory**, keyed by table, and let the record page read it. The
list already has the answer; this keeps it instead of discarding it at unmount. No shared pipeline
and no knowledge of any table's extras. The cost is that it is a snapshot: it reflects the list as
last shown, not the data as it is now, and it does not survive a reload.

## Decision

`ui/listOrder.ts` holds one array of ids per table. `RecordList` writes it whenever its rows change
(`rememberListOrder`); `RecordDetail` reads it (`recordOrder`, `neighbours`) and shows
**Previous · n of N · Next** above the record. This is a cursor over a materialised result, the same
trade a paginated API makes when it hands out a cursor instead of re-running the query per page.

The two gaps in a snapshot are closed the plain way:

- **Stale entries.** Ids deleted since the list was shown are dropped when the order is read.
- **No snapshot.** On a reload or a shared link the list has not been opened, so the order falls
  back to every record by id.

A record that is not in the remembered order - created since, or hidden by the list's filters - gets
no pager at all, since there is no honest answer to what comes after it.

Stepping uses `navigate(..., { replace: true })`, so however many records are stepped through, Back
still returns to the list in one step, and the entry keeps its record of where it was opened from
(see the router notes in [05](../05-app-architecture.md)).

## Consequences

- Stepping through a filtered list works for every table, including ones whose order depends on
  page-supplied filters and sorts, with no new coupling between `ui/` and `features/`.
- The order can lag the data. Edit a square so it no longer matches the filter and it is still in the
  pager until the list is next shown. For a review pass this is the better behaviour - the record
  just edited does not vanish from under the cursor - but it is a snapshot, and the count beside the
  buttons is the snapshot's.
- After a reload the pager walks the whole table by id rather than the filtered list. Nothing says
  so on screen beyond the count changing.
- It is module-level state, like `listMemory`. Two tabs each have their own; nothing is shared or
  persisted, so there is nothing to migrate or clear.
- Returning to the list restores the scroll position it had when it was left, not the position of
  the record stepped to. Scrolling to the last record viewed would be the follow-up.
