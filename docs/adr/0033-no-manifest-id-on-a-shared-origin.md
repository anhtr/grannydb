# ADR 0033 — No manifest `id`: let identity default to `start_url` on a shared origin

**Status:** accepted · 2026-10-24

## Context

v0.1.33 added `"id": "./"` to the web manifest, on the belief that it resolved like every other
manifest member — against the manifest's URL — and so pinned the identity browsers already derived
from `start_url` (`https://anhtr.github.io/grannydb/`).

It does not. `id` alone is resolved against **`start_url`'s origin**, so `"./"`, `"/"` and `"."`
all mean `https://anhtr.github.io/`. grannydb claimed the identity of the whole origin, and since
an app's identity is how a browser decides "is this already installed?", another project page under
the same github.io user could not be installed alongside it. Another case of the shared origin
([ADR 0006](0006-public-data-and-anonymous-reads.md), the security posture) turning a local choice
into a neighbour's problem.

## Options

**Hardcode `"id": "/grannydb/"`.** Correct for this deploy, and the form DevTools recommends. It is
also the base path written into a second place, which invariant 5 exists to stop: a `BASE_PATH`
build, or a fork served from another repo name, would install under grannydb's identity.

**Generate the manifest at build time**, with `id` from Vite's `base`. Correct everywhere. Costs
moving the manifest out of `public/`, an emit step in `build`, and a middleware in `serve` so dev
still has one — machinery to say what the default already says.

**Omit `id`.** The spec's default is the resolved `start_url`, and `start_url` is relative to the
manifest, so it is `/grannydb/` here and the right directory under any base path.

## Decision

Omit it. `src/sw/__tests__/manifest.test.ts` resolves the identity the way the spec does and
requires it to sit inside the manifest's own scope, so putting a bare relative `id` back fails CI
rather than a neighbour's install button.

## Consequences

- Installs from before v0.1.33 keep their identity; nothing about them changed.
- An install made from v0.1.33 is, to the browser, a different app (identity: the origin root).
  Uninstall it and install again. Its queue and token live in origin storage, not in the
  installation, so on Android and desktop nothing is lost by doing so; on iOS, sync first, since a
  home-screen app has its own storage there (see operations).
- DevTools → Application → Manifest notes that `id` is not specified. It is a recommendation, not an
  install blocker, and is the cost of not writing the base path down twice.
- Identity now follows `start_url`. Changing `start_url` — adding a query string, say — would make
  every existing install a different app. If that is ever wanted, that is the moment to generate
  `id` at build time.
