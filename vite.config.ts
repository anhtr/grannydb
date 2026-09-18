import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
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

/**
 * Ships `src/sw/sw.js` as `dist/sw.js` with the hashed asset names baked in.
 *
 * The worker cannot import the manifest and cannot guess the filenames, since they only exist once
 * rollup has hashed them — so the list is substituted here, where it is known. Only the shell is
 * precached: the HTML document and the JS/CSS it loads. Sourcemaps and `data/bundle.json` are left
 * out on purpose (see the header comment in `sw.js`).
 */
function serviceWorkerPlugin(): Plugin {
  let base = '/'

  return {
    name: 'grannydb-service-worker',

    configResolved(config) {
      base = config.base
    },

    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle)
        .filter((name) => name.endsWith('.js') || name.endsWith('.css'))
        .sort()

      // index.html first: the worker serves it for every navigation, hash routing having made every
      // route the same document.
      const precache = [`${base}index.html`, ...assets.map((name) => `${base}${name}`)]

      // A build that changes nothing must produce the same worker, or every deploy would prompt an
      // update. Hashed filenames already encode the JS and CSS; the document is hashed explicitly
      // because editing index.html alone (a CSP change, say) leaves every asset name untouched.
      const html = bundle['index.html']
      const htmlSource = html && html.type === 'asset' ? String(html.source) : ''
      const version = createHash('sha256')
        .update(precache.join('|'))
        .update(htmlSource)
        .digest('hex')
        .slice(0, 12)

      const template = readFileSync('src/sw/sw.js', 'utf8')
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        // replaceAll, not replace: both names appear in the worker's own header comment too.
        source: template
          .replaceAll('__VERSION__', version)
          .replaceAll('__PRECACHE__', JSON.stringify(precache)),
      })
    },
  }
}

export default defineConfig({
  // GitHub Pages serves this project from https://<user>.github.io/grannydb/.
  base: process.env.BASE_PATH ?? '/grannydb/',
  plugins: [react(), tailwindcss(), dataBundlePlugin(), serviceWorkerPlugin()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
