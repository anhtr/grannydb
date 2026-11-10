import type { Theme } from '../core/prefs'

/**
 * The page background in each palette, for the browser's own chrome (the status bar of an installed
 * app, the address bar on Android). They repeat `--color-paper` from `styles.css` and the two
 * `theme-color` metas in `index.html`, because a meta tag cannot read a CSS variable.
 */
const CHROME_COLOUR = { light: '#faf7f2', dark: '#1c1917' } as const

/**
 * Put a theme choice into effect: `data-theme` on the root element, which `styles.css` keys the
 * palette and `color-scheme` off, and the `theme-color` metas.
 *
 * "system" removes the attribute rather than resolving it to light or dark here. The stylesheet then
 * follows `prefers-color-scheme` by itself, as it did before there was a choice, so the page tracks
 * the system changing (sunset, say) with no listener, and a device that never touches the setting
 * runs no theme code that matters.
 *
 * Called from `main.tsx` before the first render and again whenever prefs change. Not from an inline
 * script in `index.html`, which is the usual way to beat the first paint: the CSP allows no inline
 * script. The cost is a possible flash of the system's palette on a cold load, for a device whose
 * choice differs from its system setting - see ADR 0042.
 */
export function applyTheme(theme: Theme, doc: Document = document): void {
  const root = doc.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)

  for (const meta of doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    // Each meta keeps its media query, so under "system" the browser still picks between them; with
    // a choice made, both carry the same colour and it no longer matters which one it picks.
    const own = (meta.getAttribute('media') ?? '').includes('dark') ? 'dark' : 'light'
    meta.setAttribute('content', CHROME_COLOUR[theme === 'system' ? own : theme])
  }
}
