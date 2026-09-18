import { describe, expect, it, vi } from 'vitest'
import { GitHubError, NetworkError, plainText } from '../github/client'
import type { Snapshot } from '../github'
import { DEFAULT_CONFIG } from '../github/config'
import { isStoredSnapshot, snapshotKey, toCached } from '../store/snapshotCache'
import { appStore } from '../store'
import { buildBundle } from '../../../scripts/build-data'

// An in-memory stand-in for IndexedDB. The store's own guards mean a missing `indexedDB` degrades
// to "no cache" rather than failing, which would make an offline test pass for the wrong reason.
vi.mock('idb-keyval', () => {
  const store = new Map<string, unknown>()
  return {
    get: (key: string) => Promise.resolve(store.get(key)),
    set: (key: string, value: unknown) => {
      store.set(key, value)
      return Promise.resolve()
    },
    del: (key: string) => {
      store.delete(key)
      return Promise.resolve()
    },
  }
})

const snapshot: Snapshot = {
  commit: 'abc123',
  schemas: { version: 1, order: ['squares'], tables: {} },
  tables: { squares: { columns: ['id'], rows: [{ id: 'S001' }] } },
  source: 'api',
  fetchedAt: 1_700_000_000_000,
}

describe('snapshot cache key', () => {
  it('varies with every part of the data location', () => {
    const base = snapshotKey(DEFAULT_CONFIG)
    const keys = [
      base,
      snapshotKey({ ...DEFAULT_CONFIG, owner: 'someone-else' }),
      snapshotKey({ ...DEFAULT_CONFIG, repo: 'other' }),
      snapshotKey({ ...DEFAULT_CONFIG, branch: 'scratch' }),
      snapshotKey({ ...DEFAULT_CONFIG, dataDir: 'other-data' }),
    ]
    // Pointing Settings at a different repo or a scratch branch must not show the cached rows of
    // whatever was there before.
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('restoring a cached snapshot', () => {
  it('marks the source and keeps the time it was originally read', () => {
    const cached = toCached(snapshot)
    expect(cached.source).toBe('cache')
    // The "showing data from…" line is only honest if this survives the round trip.
    expect(cached.fetchedAt).toBe(snapshot.fetchedAt)
    expect(cached.tables).toEqual(snapshot.tables)
    expect(cached.commit).toBe('abc123')
  })

  it('rejects anything that is not a snapshot an older build wrote', () => {
    expect(isStoredSnapshot(snapshot)).toBe(true)
    expect(isStoredSnapshot(undefined)).toBe(false)
    expect(isStoredSnapshot(null)).toBe(false)
    expect(isStoredSnapshot('{}')).toBe(false)
    expect(isStoredSnapshot({ ...snapshot, fetchedAt: undefined })).toBe(false)
    expect(isStoredSnapshot({ ...snapshot, tables: null })).toBe(false)
    expect(isStoredSnapshot({ ...snapshot, schemas: { tables: {} } })).toBe(false)
  })
})

describe('network errors', () => {
  it('names a failed connection rather than showing "Failed to fetch"', async () => {
    const original = globalThis.fetch
    globalThis.fetch = () => Promise.reject(new TypeError('Failed to fetch'))
    try {
      await expect(plainText('https://example.test/x')).rejects.toBeInstanceOf(NetworkError)
    } finally {
      globalThis.fetch = original
    }
  })

  it('leaves an aborted request alone', async () => {
    const original = globalThis.fetch
    const abort = new Error('The operation was aborted.')
    abort.name = 'AbortError'
    globalThis.fetch = () => Promise.reject(abort)
    try {
      await expect(plainText('https://example.test/x')).rejects.toBe(abort)
    } finally {
      globalThis.fetch = original
    }
  })

  it('leaves a GitHub answer alone', async () => {
    const original = globalThis.fetch
    globalThis.fetch = () =>
      Promise.resolve(new Response('nope', { status: 404, statusText: 'Not Found' }))
    try {
      await expect(plainText('https://example.test/x')).rejects.toBeInstanceOf(GitHubError)
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('loading with no network', () => {
  const { bundle } = buildBundle('src/core/__tests__/fixtures/data')

  // Settings live in localStorage, which a Node test environment does not have.
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })

  it('falls back to the copy saved on the device, and says so', async () => {
    const original = globalThis.fetch

    // First load, online: the anonymous bundle path, which also seeds the offline copy.
    globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify(bundle), { status: 200 }))
    await appStore.init()
    expect(appStore.getState().phase).toBe('ready')
    expect(appStore.getState().snapshot?.source).toBe('bundle')
    const online = appStore.getState().data

    // Second load, on a plane.
    globalThis.fetch = () => Promise.reject(new TypeError('Failed to fetch'))
    await appStore.reload()
    const state = appStore.getState()
    globalThis.fetch = original

    // Every screen needs `snapshot.schemas`, so falling back has to produce a real snapshot and a
    // ready phase, not an error with the rows attached.
    expect(state.phase).toBe('ready')
    expect(state.error).toBeNull()
    expect(state.snapshot?.source).toBe('cache')
    expect(state.data).toEqual(online)
  })

  it('reports the failure when there is nothing saved yet', async () => {
    const original = globalThis.fetch
    globalThis.fetch = () => Promise.reject(new TypeError('Failed to fetch'))
    // A data location never read on this device has no cached copy to fall back to.
    await appStore.setConfig({ ...appStore.getState().config, branch: 'never-visited' })
    const state = appStore.getState()
    globalThis.fetch = original

    expect(state.phase).toBe('error')
    expect(state.error).toContain('offline')
  })
})
