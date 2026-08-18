import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { buildBundle } from './scripts/build-data'

/**
 * Generates `data/bundle.json` from the CSVs.
 *
 * In `build` it emits the file as an asset and fails the build on invalid data, so a broken
 * hand-edit never ships. In `serve` it answers the request from disk on every request, so editing
 * a CSV and refreshing just works.
 */
function dataBundlePlugin(): Plugin {
  let urlPath = '/data/bundle.json'
  let isBuild = false

  return {
    name: 'grannydb-data-bundle',

    configResolved(config) {
      isBuild = config.command === 'build'
      // The app requests `${BASE_URL}data/bundle.json`, and BASE_URL is `config.base` (`/grannydb/`
      // in this repo). Matching only `/data/bundle.json` never fires under that base, so the request
      // falls through to the SPA index instead, `readFromBundle` fails to parse it as JSON, and the
      // app silently falls back to fetching the live GitHub repo instead of local files.
      urlPath = `${config.base.replace(/\/$/, '')}/data/bundle.json`
    },

    buildStart() {
      if (!isBuild) return
      const { bundle, issueCount } = buildBundle()
      if (issueCount > 0) {
        this.error(`Data validation failed with ${issueCount} issue(s). See the log above.`)
      }
      this.emitFile({
        type: 'asset',
        fileName: 'data/bundle.json',
        source: JSON.stringify(bundle),
      })
    },

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith(urlPath)) return next()
        try {
          const { bundle, issueCount } = buildBundle()
          if (issueCount > 0) {
            // Surface it rather than serving data the build would reject.
            res.statusCode = 500
            res.end(JSON.stringify({ error: `${issueCount} data validation issue(s)` }))
            return
          }
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(bundle))
        } catch (error) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'failed' }))
        }
      })
      server.watcher.add('data')
    },
  }
}

export default defineConfig({
  // GitHub Pages serves this project from https://<user>.github.io/grannydb/.
  base: process.env.BASE_PATH ?? '/grannydb/',
  plugins: [react(), tailwindcss(), dataBundlePlugin()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
