/**
 * Constants Vite substitutes at build time (`define` in `vite.config.ts`), so the running app can
 * say which build it is. Both are empty strings if the changelog had no heading to read them from.
 * Only `features/` and `ui/` may read them: `core/` also runs in Node, outside Vite, where nothing
 * would have substituted them.
 */
declare const __APP_VERSION__: string
declare const __APP_RELEASED__: string
