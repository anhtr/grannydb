# ADR 0007 — React + TypeScript + Vite + Tailwind, with hash routing

**Status:** accepted · 2026-08-17

## Context

A mobile-first app that will grow features for years, deployed as a static bundle to a GitHub Pages
subpath. Small dataset, no server, one developer.

## Options

**React + TS + Vite + Tailwind.** Boring and well-trodden, which is the point when features will be
added for months. Largest ecosystem for the things likely to come next — a drag-and-drop grid for
the blanket layout, charts. Roughly 60 KB gzipped.

**Preact.** Same JSX, ~25 KB smaller. Occasional friction with React-ecosystem libraries.

**Svelte / SolidJS.** Smaller and faster still, smaller ecosystem, and more novelty than this
project needs.

**Vanilla TS.** Fastest possible load, nothing to churn. The schema-driven forms — the core of the
app — get significantly more code to write and maintain.

Separately, for routing: **History API** vs **hash**.

## Decision

React + TypeScript + Vite + Tailwind v4. Hash routing, hand-written in ~50 lines, no router
dependency.

## Consequences

- Bundle size is not a constraint worth optimising here; the app is used repeatedly from one device
  and cached.
- Hash routing is the right call specifically because of GitHub Pages: the site is served from
  `/grannydb/` with no server to rewrite deep links. History API routing would 404 on a refresh of
  `/grannydb/squares/S001` unless a `404.html` re-serves the app. With a hash, the browser never
  sends the path. Deep links, refresh and back all work with no deploy trick.
- URLs carry a `#`. Cosmetic.
- No router library, so nested layouts and route-level data loading would have to be hand-rolled if
  they are ever needed. At four route shapes, they are not.
- Tailwind keeps mobile-first styling fast; the palette is defined once in `styles.css` with both
  light and dark values explicit.
- State is a hand-written observable store rather than a library
  ([app architecture](../05-app-architecture.md)), which keeps `core/` free of React and therefore
  testable in Node.
