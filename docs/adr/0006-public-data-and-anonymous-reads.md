# ADR 0006 — Public data, anonymous read-only access

**Status:** accepted · 2026-08-17

## Context

The initial request was for the site to be readable by visitors *even if the repo goes private*.

That is not physically possible. A static site has no secrets: anything the page can use to read
private data is visible to anyone who views source. Data an anonymous stranger can read is public
data, wherever it is stored. So the real choice is between public data and no anonymous access.

## Options

**Public data, anyone can browse.** Repo public. Anonymous visitors get a read-only view. A shareable
gallery of the blanket. If the repo later goes private, a generated snapshot published to the public
site keeps the gallery working — the data is public either way.

**Private data, token required for everything.** No token means a login screen. Genuinely private.
No shareable link, and Pages from a private repo needs GitHub Pro.

## Decision

Public data, anonymous read-only. Editing UI is hidden without a token.

Confirmed with the owner: the concern about going private is about the *code*, not the square data.

## Consequences

- Three read paths, tried in order: authenticated API, then the build-time bundle, then
  `raw.githubusercontent.com`. The fallback chain means the site works signed in, signed out, and on
  a dev server with no bundle built.
- Anonymous readers get the bundle — a materialised view, one request, pre-parsed. It lags the repo
  by one deploy (~1 minute), which only affects anonymous visitors; signed-in users read live.
- Editing controls are gated on a token being present, which is UI convenience rather than security.
  The actual security is that writing needs a token GitHub will accept.
- If the code later needs to be private, the routes are listed in the operations doc, and the data
  location being configurable ([ADR 0008](0008-single-repo-with-configurable-data-location.md))
  covers the awkward one.
