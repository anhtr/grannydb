# ADR 0037 — Re-read when the app comes back to the foreground, if the data is over a minute old

**Status:** accepted · 2026-11-09

## Context

The app read the repo at start-up, after its own sync, and when the network came back to a device
that was showing its saved copy. Nothing else triggered a read. A tab left open on the laptop
therefore kept showing the morning's data after an evening of entering squares on the phone, and
the only fix was Settings → Reload from GitHub, which first requires knowing the screen is stale.

Stale data on screen is mostly a display problem, because a sync always re-reads before it commits.
It is not only that: `nextId` numbers a new record from the rows on screen, so a stale device hands
out an id the other device already used. [ADR 0036](0036-renumber-a-clashing-new-record-at-sync-time.md)
repairs that at sync time, but the repair renumbers a record the person may already have written
on a label.

## Options

**Poll on a timer.** Keeps an open tab current without anyone touching it. It also spends requests
all night on a tab nobody is looking at, and browsers throttle or freeze timers in background tabs
anyway, so it would not even do what it promises on a phone.

**Re-read on every return to the foreground.** Simple, and the moment is right: the data is about
to be looked at. But switching to a pattern in another app and back happens every minute or two
while crocheting, and each read is a handful of requests that would nearly always learn nothing.

**Re-read on return to the foreground, only when the snapshot is older than a threshold.** The
same moment, minus the reads that cannot have missed much.

**Subscribe to changes.** There is no server to push from. Not available to a static site.

## Decision

The third. [`refresh.ts`](../../src/core/store/refresh.ts) holds the policy as a pure function,
`foregroundRefreshBlocker`, beside `autoSync.ts` and shaped like it; `AppStore` asks it on
`visibilitychange`. It re-reads when all of these hold:

- no read and no push is in flight (a sync ends with its own read of the commit it made);
- the browser does not report being offline;
- the snapshot was read more than `FOREGROUND_REFRESH_AFTER_MS` (60 seconds) ago, **or** it is the
  saved offline copy, which is never treated as fresh, **or** there is no snapshot at all because
  the first load failed.

The read is *quiet*: `reload(undefined, { quiet: true })` keeps whatever is on screen if it fails.
An ordinary failed read falls back to the saved copy and marks the screen offline, which is the
right answer to pressing a button and the wrong one to glancing at a tab in a tunnel.

## Consequences

- A device that was left open catches up within a second or so of being looked at, without a
  button.
- A stale device is much less likely to hand out an id another device has used, so renumbering at
  sync becomes rarer. It is not eliminated: two devices that are both offline can still clash.
- The read replaces the snapshot under whatever screen is open. Lists and detail pages simply
  re-render. An open form was the hazard: it used to copy the whole row at the first keystroke and
  hand that copy to `save`, which diffs against the row *now*. After a re-read, every field the
  other device had changed would have differed from the stale copy and been queued, reverting it.
  `RecordForm` therefore keeps only the fields that were actually touched and reads the rest live,
  so an untouched field shows the newer value and is left out of the save. A field edited on both
  devices is still last-writer-wins, as it always was.
- Up to one extra read per minute of active switching. With a token that is a few requests against
  a 5,000-an-hour limit, and the head check is a 304 when nothing moved
  ([ADR 0035](0035-never-cache-the-branch-head.md)). Without a token it re-fetches the published
  bundle from the site's own origin.
- A tab that stays in the foreground, untouched, on a desk still goes stale. Nothing here polls.
