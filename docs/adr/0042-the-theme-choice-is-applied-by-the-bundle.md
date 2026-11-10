# ADR 0042 - The theme choice is applied by the bundle, not by an inline script

**Status:** accepted · 2026-11-10

## Context

The app has always had two palettes and has always let the system pick: dark when
`prefers-color-scheme` says dark, light otherwise, decided entirely in CSS. That is wrong for one
ordinary situation. A phone set to dark, a tracker opened in daylight to match a yarn against the
colour on screen: the person wants *this app* light and everything else left alone.

So Settings now has Match the device / Light / Dark, saved with the other per-device preferences
(`Prefs.theme` in `localStorage`). Two things follow from that. The stylesheet needs something to
key off besides the media query. And a stored choice can only be read by script, which raises the
question every theme switch runs into: script runs after the browser has started painting, so when
does the choice take effect?

## Options

**An inline script in `<head>`**: a few lines in `index.html` that read `localStorage` and set an
attribute before the first paint. This is the standard answer and it has no flash at all. It is
also the one thing the page's content security policy exists to refuse. `script-src 'self'` allows
no inline script, and that line is what stands between a GitHub token in `localStorage` and any
markup that ever finds its way into the page ([06](../06-operations.md#security-posture)). Allowing
this script means a hash in the policy that has to be recomputed whenever the script changes, or
`'unsafe-inline'`. A security rule traded for a cosmetic one. Rejected.

**A small blocking script in `public/`**: the same lines as a separate file, loaded with a plain
`<script src>` before the stylesheet. The policy allows it. But it sits outside the bundle: not
type-checked, not tested, and it would need its own copy of how prefs are stored and which values
are valid, to be kept in step by hand with `core/prefs`. It also adds a request that blocks
rendering on every load, for every device, to serve the ones that changed a setting. Rejected.

**Keep the choice in a cookie or the URL so the server can render it**: there is no server. Rejected.

**Apply it from the app's own script, as early as that runs.**

## Decision

`applyTheme` ([`app/theme.ts`](../../src/app/theme.ts)) sets `data-theme="light"` or `"dark"` on the
root element, or removes the attribute for "Match the device". `main.tsx` calls it before the first
React render, reading prefs straight from storage, and again whenever the store's prefs change.

The stylesheet has one definition of "dark applies", a `dark` variant redefined in
[`styles.css`](../../src/styles.css):

- the system asks for dark **and** the root is not marked light, or
- the root is marked dark.

Both the palette variables and every `dark:` utility go through it, so there is no second rule to
keep in step. `color-scheme` follows the attribute too, so the browser's own parts (scrollbars, the
date picker) match the page. The two `theme-color` metas are given the chosen colour so the status
bar of an installed app matches as well.

"Match the device" is the absence of the attribute, not a resolved value. The CSS then behaves
exactly as it did before there was a setting, and follows the system changing at sunset with no
listener in the page.

## Consequences

- The security policy is untouched, and the logic is ordinary bundled code with tests
  (`theme.test.ts`, `prefs.test.ts`).
- **A device whose choice differs from its system setting can see the system's palette for a moment
  on a cold start**, between the first paint of `index.html` and the bundle running. In practice
  the page is an empty `<div>` on the page background until then, and an installed app loads the
  bundle from the service worker's cache, so it is one flash of background colour. It is still the
  cost, and it lands on exactly the people who used the feature.
- A device that never opens the setting pays nothing: no attribute, no extra request, the same CSS
  path as before.
- Every `dark:` rule is now emitted twice (once under the media query, once for the attribute). A
  few kilobytes of CSS before compression.
- The web manifest's `background_color` and `theme_color` are static, so the splash screen of an
  installed app is always the light one whatever is chosen here.
- The palette's two background colours now appear in three places (`styles.css`, `index.html`,
  `theme.ts`), because a meta tag cannot read a CSS variable.
