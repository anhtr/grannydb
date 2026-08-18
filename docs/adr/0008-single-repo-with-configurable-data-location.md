# ADR 0008 — One repo, but the data location is configuration

**Status:** accepted · 2026-08-17

## Context

App and data could live together or apart. Apart would let the app be public while the data is
private, or vice versa. Together is simpler. The owner may later want the *code* private.

## Options

**One repo, app and data together.** Simplest to build and operate. One clone, one history, data
visible next to the code that reads it.

**Two repos from the start.** App public, data separate. Flexible, and immediately more setup: two
clones, cross-repo tokens, two histories to reason about — paying today for a maybe.

**One repo, with the data location as a runtime config value.** Same simplicity as one repo, but
owner, repo, branch and data directory are settings with baked-in defaults rather than constants.

## Decision

One public repo. Data location is configuration, overridable in Settings, defaulting to
`anhtr/grannydb`, `main`, `data/`.

## Consequences

- Splitting the data into its own repo later is a settings change, not a rewrite. Every read and
  write already takes a `RepoConfig`.
- The same mechanism gives a free scratch mode: point Branch at a throwaway branch and experiment
  without touching `main`.
- Nothing in the codebase may hardcode owner/repo/branch/path. The defaults live in exactly one
  place, `DEFAULT_CONFIG` in [`config.ts`](../../src/core/github/config.ts).
- Data commits trigger a Pages deploy, because app and data share a repo. Deliberate — see
  [ADR 0009](0009-validate-in-the-build-pipeline.md) and the operations doc.
