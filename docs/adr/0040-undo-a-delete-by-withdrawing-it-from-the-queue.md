# ADR 0040 - Undo a delete by withdrawing it from the queue

**Status:** accepted · 2026-11-10

## Context

Deleting a record takes two taps (Delete, Really delete) and shows what the delete would orphan.
That guards against the tap that was never meant. It does nothing for the delete that was meant and
was wrong - the wrong square of two that look alike - which is noticed a second *after* the list
comes back without it.

The message that now confirms a delete is the natural place for an Undo. The question is what Undo
does, given how a delete is stored: `appendChange` puts a `delete` operation in the queue and, in the
same step, **drops whatever was pending for that row**, because a delete supersedes it. So by the
time Undo is pressed, the queue no longer holds the edits - or the whole unsynced new record - that
the delete replaced.

## Options

**A compensating operation**: queue an upsert that writes the row back. This is how an append-only
log undoes things (a reversing entry in a ledger, `git revert`), and it would work even after the
delete has been pushed. But the row it writes back is a copy taken on this device at delete time,
whole: replayed at sync it overwrites every field, including ones another device has changed since,
which is the whole-row write invariant 3 exists to prevent. It also turns "nothing happened" into two
operations in the history, and for a record that was new and unsynced it has to re-create it and
hope the id is still free. Rejected.

**Hold the delete back for a few seconds** and only queue it when the message goes away. Undo is
then trivially "do nothing". But for those seconds the record is deleted on screen and not in the
queue, so closing the tab at the wrong moment silently keeps a record the person deleted - the queue
stops being the single account of what is pending. Rejected.

**Withdraw the delete from the queue and put back what it superseded.** The queue is a log of
operations that have not happened yet, as far as the repo is concerned; taking one out before it is
sent is not rewriting history, it is deciding not to make it. Needs the superseded operation kept
somewhere for as long as Undo is on offer.

## Decision

`appStore.remove` returns a `DeleteReceipt`: the id of the queued delete, plus the pending operation
it superseded and the position that held, if there was one (`queueDelete` in `queue.ts`).
`appStore.undoRemove(receipt)` calls `withdrawDelete`, which removes that delete and reinserts the
superseded operation with its original timestamp, so it replays in the order it always would have.
The queue afterwards is the queue from before the delete.

The receipt lives in the closure of the message's Undo button and nowhere else. It is not persisted:
an Undo that survived a reload would need a place on screen to live, and the Pending changes screen
already lets a queued delete be discarded.

Undo refuses, and says so, in the two cases where the delete is no longer the queue's to withdraw:
it has already been pushed (its id is not in the queue), or a push is in flight and may be carrying
it.

## Consequences

- Undo restores exactly the previous state, pending edits included, and leaves no trace in the
  commit history.
- It is only possible until the delete is synced. With automatic sync that is about thirty seconds,
  longer than the message is on screen; after that the way back is the repo's history, as before.
- Discarding a delete from Pending changes is not the same thing: it removes the delete but cannot
  bring back edits the delete superseded. That gap is unchanged.
- `remove` now returns a value, so the queue has a second way to shrink besides sync and discard.
  `withdrawDelete` is pure and pinned by tests in `queue.test.ts`.
