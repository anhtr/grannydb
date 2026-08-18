# ADR 0002 — Fine-grained PAT in localStorage for auth

**Status:** accepted · 2026-08-17

## Context

The app needs to write to the repo from a browser, with no server. Only the owner should be able to
write. The token must not need re-entering on every use — ideally once per device.

## Options

**"Sign in with GitHub" (OAuth web flow).** The familiar experience. Requires a client secret and a
server-side token exchange. There is no server.

**OAuth device flow.** Designed for clients that cannot hold a secret, needs only a client id — and
it still fails, because `github.com/login/oauth/access_token` sends no CORS headers. A browser
cannot complete the exchange. This is a hard blocker, not an inconvenience.

**A tiny serverless proxy** (Cloudflare Worker, Netlify function) to do the exchange. Would work,
and would mean the app is no longer serverless. One more thing to deploy, monitor and keep
credentialled, to save pasting a token twice a year.

**GitHub App with user-to-server tokens.** Same CORS wall on the exchange.

**Fine-grained PAT pasted by the user, stored in `localStorage`.** No server. Persists across
sessions. Scoped to one repo with one permission.

## Decision

Fine-grained PAT, `Contents: read and write` on `grannydb` only, stored in `localStorage`.

`localStorage` rather than `sessionStorage` specifically because the requirement is "paste once per
device" — `sessionStorage` dies with the tab.

## Consequences

- Onboarding is a manual step per device. Acceptable: it happens roughly once a year per device.
- The token is readable by any script on the origin — and *all* project pages under
  `anhtr.github.io` share that origin. Mitigated structurally: no third-party scripts at all, a
  strict CSP, and a token narrow enough that the worst case is edits to a granny square list.
- Token expiry shows up as a 401 at sync time. The sync screen surfaces it and the queue is
  untouched, so nothing is lost.
- Revocation is one click on GitHub, and the app holds no other state.
- A custom domain would remove the shared-origin problem entirely if it ever matters.
