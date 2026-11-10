# ADR 0043 - The app's version is the newest changelog heading

**Status:** accepted · 2026-11-10

## Context

The app is installed on a phone and updates itself through a service worker, which means the copy
in hand can be older than the one deployed. "Is the fix on this phone yet?" had no answer short of
trying the thing that was broken. Settings should say which build is running.

That needs a version number that exists at build time, and this project has three candidates. They
disagree with each other in instructive ways.

## Options

**`package.json`'s `version`**: where a version conventionally lives, and one import away. It says
`0.1.0`, as it has since the first build, sixty changelog entries ago. Nothing reads it, nothing
publishes this package, so nothing has ever made anyone bump it. Using it would mean a second
number to remember on every change, and the first time it was forgotten the app would report a
version that is confidently wrong. Rejected.

**The commit sha** (`GITHUB_SHA` in the deploy workflow): exact, automatic, impossible to forget,
and it links straight to the code. It also changes on every commit, and in this repo most commits
are not code. Every sync of a square is a commit, and
[data commits deploy too](../06-operations.md#data-commits-deploy-too). A sha compiled into the
bundle would change the JS on each of those deploys, so its content hash and file name would
change, so the service worker's precache list would change, so every device would be told "a new
version is ready" after every synced square - an update prompt for an app that had not changed.
The worker is built carefully to avoid exactly that. Rejected. (Showing the *data's* commit is a
different thing, and Settings → Status already does.)

**A build timestamp**: the same problem as the sha, with less information. Rejected.

**The newest heading in `docs/CHANGELOG.md`.**

## Decision

Every changelog entry is headed `## YYYY-MM-DD - vX.Y.Z, title`, newest first. `latestRelease`
([`scripts/app-version.ts`](../../scripts/app-version.ts)) reads the first such heading, and
`vite.config.ts` passes the result to the bundle as two build-time constants, `__APP_VERSION__` and
`__APP_RELEASED__`. Settings → About shows them and links to the changelog.

The changelog is the one place a version number is already written on every change, because the
documentation rule requires an entry. So the version is derived from a thing that is maintained
anyway rather than maintained beside it - the same single-source idea as generating the published
bundle from the CSVs instead of keeping a second copy.

## Consequences

- Nothing new to remember. Writing the changelog entry *is* bumping the version.
- A data-only commit leaves the changelog alone, so the bundle is byte-identical and no update is
  offered.
- The version says which *described change* a build includes, not which commit. Two commits under
  one changelog entry are indistinguishable, and a code change made without an entry ships under
  the previous number. The documentation rule makes that a mistake already; this makes it a
  slightly more visible one.
- The heading's shape is now load-bearing. A heading written differently is skipped, and a
  changelog with no readable heading builds an app that says "unknown" rather than failing the
  build - a wrong label is not worth a failed deploy of someone's data. `appVersion.test.ts` reads
  the real file and fails if its first heading is not one the pattern understands, so that is
  caught in CI instead.
- The link to the changelog goes to the app's own repository (`DEFAULT_CONFIG`), not to wherever
  Settings points the data: someone tracking their squares in a fork's data repo is still running
  this code.
- `package.json` still says `0.1.0` and still means nothing.
