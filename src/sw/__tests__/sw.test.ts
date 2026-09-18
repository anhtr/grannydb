/**
 * The service worker, run in a fake worker global.
 *
 * Worth testing rather than trusting: it is the one piece of code in the repo that can silently
 * start answering requests it was never meant to see, and the consequence — an authenticated GitHub
 * response sitting in a cache on an origin shared with every other page under this github.io user —
 * is the exposure ADR 0006 and the security posture are built around. The prose says it never
 * touches a cross-origin request; this is what makes that a fact.
 *
 * It runs the template with the placeholders filled in, rather than `dist/sw.js`, so it needs no
 * build.
 */
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'

const BASE = '/grannydb/'
const ORIGIN = 'https://anhtr.github.io'
const PRECACHE = [`${BASE}index.html`, `${BASE}assets/index-abc123.js`, `${BASE}assets/index-def456.css`]

type Handler = (event: Record<string, unknown>) => void

class FakeCache {
  entries = new Map<string, string>()
  addAll(urls: string[]): Promise<void> {
    for (const url of urls) this.entries.set(url, `body:${url}`)
    return Promise.resolve()
  }
  match(key: string): Promise<string | undefined> {
    return Promise.resolve(this.entries.get(key))
  }
}

function load() {
  const source = readFileSync('src/sw/sw.js', 'utf8')
    .replaceAll('__VERSION__', 'testversion')
    .replaceAll('__PRECACHE__', JSON.stringify(PRECACHE))

  const stores = new Map<string, FakeCache>([['grannydb-previous', new FakeCache()]])
  const caches = {
    open: (name: string) => {
      if (!stores.has(name)) stores.set(name, new FakeCache())
      return Promise.resolve(stores.get(name))
    },
    keys: () => Promise.resolve([...stores.keys()]),
    delete: (name: string) => Promise.resolve(stores.delete(name)),
    match: async (key: string) => {
      for (const store of stores.values()) {
        const hit = await store.match(key)
        if (hit) return hit
      }
      return undefined
    },
  }

  const handlers: Record<string, Handler> = {}
  let claimed = false
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, handler: Handler) => {
      handlers[type] = handler
    },
    clients: {
      claim: () => {
        claimed = true
        return Promise.resolve()
      },
    },
    skipWaiting: () => Promise.resolve(),
  }

  new Function('self', 'caches', 'fetch', 'URL', source)(self, caches, () => 'network', URL)

  const dispatch = async (type: string, event: Record<string, unknown> = {}): Promise<void> => {
    const waits: Promise<unknown>[] = []
    handlers[type]?.({ waitUntil: (p: Promise<unknown>) => waits.push(p), ...event })
    await Promise.all(waits)
  }

  /** What the worker answers with, or 'passthrough' when it declines to handle the request. */
  const handle = async (url: string, init: { mode?: string; method?: string } = {}): Promise<string> => {
    let answer: unknown = 'passthrough'
    handlers.fetch?.({
      request: { url, mode: init.mode ?? 'no-cors', method: init.method ?? 'GET' },
      respondWith: (value: unknown) => {
        answer = value
      },
    })
    return String(await answer)
  }

  return { dispatch, handle, stores, claimed: () => claimed }
}

describe('the service worker', () => {
  let sw: ReturnType<typeof load>

  beforeEach(async () => {
    sw = load()
    await sw.dispatch('install')
  })

  it('precaches the shell and nothing else', () => {
    const cache = sw.stores.get('grannydb-testversion')
    expect([...(cache?.entries.keys() ?? [])]).toEqual(PRECACHE)
  })

  it('drops older caches on activate, since asset names are content-hashed', async () => {
    await sw.dispatch('activate')
    expect([...sw.stores.keys()]).toEqual(['grannydb-testversion'])
    expect(sw.claimed()).toBe(true)
  })

  it('never intercepts a cross-origin request', async () => {
    expect(await sw.handle('https://api.github.com/repos/a/b/git/ref/heads/main')).toBe('passthrough')
    expect(await sw.handle('https://api.github.com/repos/a/b/git/blobs', { method: 'POST' })).toBe(
      'passthrough',
    )
    expect(await sw.handle('https://raw.githubusercontent.com/a/b/main/data/squares.csv')).toBe(
      'passthrough',
    )
  })

  it('serves the cached document for any route, hash routing having made them one page', async () => {
    const shell = `body:${BASE}index.html`
    expect(await sw.handle(`${ORIGIN}${BASE}`, { mode: 'navigate' })).toBe(shell)
    expect(await sw.handle(`${ORIGIN}${BASE}#/squares/S041/edit`, { mode: 'navigate' })).toBe(shell)
  })

  it('serves precached assets from the cache', async () => {
    expect(await sw.handle(`${ORIGIN}${BASE}assets/index-abc123.js`)).toBe(
      `body:${BASE}assets/index-abc123.js`,
    )
  })

  it('leaves the data bundle to the network, so there is one story about stale data', async () => {
    expect(await sw.handle(`${ORIGIN}${BASE}data/bundle.json`)).toBe('passthrough')
  })
})
