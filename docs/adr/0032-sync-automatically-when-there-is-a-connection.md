# ADR 0032 — Sync automatically when there is a connection

**Status:** accepted · 2026-10-24 · supersedes the "Why not auto-sync" decision in
[ADR 0004](0004-operation-log-not-file-snapshots.md) and the sync engine doc

## Context

Since v1, pushing the queue has been a button. The reasoning (kept, rewritten, in
[the sync engine doc](../04-sync-engine.md#automatic-sync)) was that the queue is durable and the
read model hides the difference between synced and unsynced, so deferring costs almost nothing; the
one risk was forgetting, which the header badge was meant to cover.

In practice the risk was forgetting, and the badge did not cover it. The app now installs and opens
with no signal ([ADR 0026](0026-last-known-good-snapshot-for-offline-reads.md),
[ADR 0027](0027-hand-written-service-worker-and-install.md)), which makes "enter squares on the
train, sync later" the normal day, and "later" is exactly when nobody is looking at the badge.
Unsynced edits on a phone are invisible to the laptop, and on iOS the installed app and the Safari
tab do not even share a queue. The owner asked for the app to sync on its own once there is a
connection.

The v1 objections were real, so the question was not whether to automate it but how to automate it
without bringing them back:

1. **A commit per burst of edits** — or worse, per field — making `git log` unreadable.
2. **Background failures you might not notice.**
3. **The app writing to your repo while you are not looking.**

## Options

**Background Sync API (`sync` event in the service worker).** The textbook PWA answer: the browser
wakes the worker when connectivity returns, even with the app closed. Rejected for three reasons.
The worker would need the token, which lives in `localStorage` (unreachable from a worker); moving it
to IndexedDB so the worker can read it puts the credential somewhere a second piece of code can use
it, on a shared origin. The worker would have to carry the whole sync engine — schema loading, CSV
merge, the commit protocol — which [ADR 0027](0027-hand-written-service-worker-and-install.md) kept
it out of on purpose: it is a shell cache, and it never touches `api.github.com`. And it does not
exist in Safari or Firefox, so on the device this app is mostly used on (an iPhone) it would do
nothing.

**Periodic Background Sync.** Chromium-only, needs the app installed and engagement-gated, and has
the same token and scope problems.

**Sync on every edit.** Simplest. Brings back objection 1 in full: entering one square is four field
edits and would be four commits.

**Sync from the page, on a debounce plus the moments that matter.** The page already has the token,
the engine and the error UI. What it lacks is a way to run with the app closed — but an edit can only
be made with the app open, and the page gets a `visibilitychange` event as you leave it.

## Decision

The page pushes the queue on its own, using the same `appStore.sync` the button uses. A pure policy
in [`core/store/autoSync.ts`](../../src/core/store/autoSync.ts) decides when; `AppStore` owns one
timer and the event listeners.

| Trigger | Delay | Why |
|---|---|---|
| An edit is queued | 30 s after the *last* edit | Each edit resets the timer, so a burst is one commit — the **group commit** pattern |
| `online` fires | none | The connection just came back; this is the request |
| The app is hidden | none | Last chance before a phone freezes or kills it |
| The app is shown again | none | A frozen app misses `online`; coming back is when you'd notice |
| The app starts | none | A queue left over from a session that ended offline |
| A sync finishes with edits made during it | 30 s | Those edits' timer found the store busy and stood down |

Each objection is answered by a rule, not by a promise:

1. **Commit noise** — the idle delay groups a burst of edits into one commit, and the commit message
   still lists every field ([message.ts](../../src/core/store/message.ts)).
2. **Unnoticed failures** — failures are split by whether waiting will fix them. Not reaching GitHub
   (`NetworkError`) is the expected state offline and is not reported; the queue is the record of
   what is waiting, and the next trigger tries again. Anything else — an expired token, a branch
   that kept moving — sets `syncError` exactly as a manual sync would, and the header badge turns
   amber and stays.
3. **Writes while you are not looking** — the toggle is per device (Settings → This device → Sync
   automatically) and defaults on. A laptop you hand-edit CSVs from, or a dev server pointed at the
   real repo, can turn it off.

`navigator.onLine === false` skips the attempt, since there is no interface to try. `true` does not
mean GitHub is reachable (a captive portal is "online"), so it permits an attempt and the attempt
decides.

Alongside it, on the first queued edit of a session, the app asks for **persistent storage**
(`navigator.storage.persist()`). Under best-effort storage a browser may evict IndexedDB under
pressure, and Safari clears it after seven days without a visit unless the app is installed. Losing
a cache is a slow reload; losing the queue is losing edits that exist nowhere else.

## Consequences

- Edits reach the repo, and so the other devices, without anyone remembering to press anything. The
  Sync button stays for "now, please" and is the only path when the toggle is off.
- History is grouped by pause, not by intent. Two squares entered a minute apart are two commits;
  two entered within thirty seconds are one. Both are legible; neither is a commit per field.
- **Development with a token now writes to the real repo on its own**, thirty seconds after an
  edit, where it used to wait for a button. Point Settings → Branch at a scratch branch, or turn the
  toggle off, before experimenting. CLAUDE.md and the operations doc say so.
- The `hidden` push may be frozen part-way. That is safe for the reason every sync is safe: the ref
  only moves on the final fast-forward, and the queue is only trimmed after a success the page saw.
  If the commit landed but the page never heard, the next sync replays the same field-level
  operations onto a repo that already has them, which serialises to identical bytes and commits
  nothing (barring the same field changed elsewhere in between — the sync engine's known gap,
  unchanged). Replay being **idempotent** is what makes "try again whenever" a safe policy.
- Nothing syncs with the app fully closed. An edit cannot be made with the app closed either, and
  leaving the app is a trigger, so the gap is "left the app with no signal and never opened it
  again". The next open closes it.
- More GitHub API traffic than before — one sync per burst rather than per session. Each sync is a
  handful of requests against a 5,000/hour authenticated limit.
- A persistence prompt can appear in Firefox on the first edit. Elsewhere it is silent.
