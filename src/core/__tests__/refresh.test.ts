import { describe, expect, it, vi } from 'vitest'
import type { Snapshot } from '../github'
import { FOREGROUND_REFRESH_AFTER_MS, foregroundRefreshBlocker } from '../store/refresh'
import { appStore } from '../store'
import { buildBundle } from '../../../scripts/build-data'

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

const NOW = 1_800_000_000_000

function snapshotRead(agoMs: number, source: Snapshot['source'] = 'api'): Snapshot {
  return {
    commit: 'abc123',
    schemas: { version: 1, order: [], tables: {} },
    tables: {},
    project: {},
    source,
    fetchedAt: NOW - agoMs,
  }
}

const idle = { phase: 'ready' as const, syncing: false, online: true }

describe('whether coming back to the foreground re-reads', () => {
  it('re-reads once the data on screen is older than the threshold', () => {
    expect(foregroundRefreshBlocker({ ...idle, snapshot: snapshotRead(FOREGROUND_REFRESH_AFTER_MS) }, NOW)).toBeNull()
  })

  it('leaves a recent read alone', () => {
    expect(foregroundRefreshBlocker({ ...idle, snapshot: snapshotRead(FOREGROUND_REFRESH_AFTER_MS - 1) }, NOW)).toBe('fresh')
  })

  it('never counts the saved offline copy as fresh, however recently it was saved', () => {
    expect(foregroundRefreshBlocker({ ...idle, snapshot: snapshotRead(0, 'cache') }, NOW)).toBeNull()
  })

  it('retries a load that failed with nothing to show', () => {
    expect(foregroundRefreshBlocker({ ...idle, phase: 'error', snapshot: null }, NOW)).toBeNull()
  })

  it('stands down while a read or a push is in flight, and with no connection', () => {
    const stale = snapshotRead(FOREGROUND_REFRESH_AFTER_MS * 10)
    expect(foregroundRefreshBlocker({ ...idle, phase: 'loading', snapshot: stale }, NOW)).toBe('busy')
    expect(foregroundRefreshBlocker({ ...idle, syncing: true, snapshot: stale }, NOW)).toBe('busy')
    expect(foregroundRefreshBlocker({ ...idle, online: false, snapshot: stale }, NOW)).toBe('offline')
  })
})

describe('a re-read nobody asked for', () => {
  const { bundle } = buildBundle('src/core/__tests__/fixtures/data')
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })

  it('leaves the screen as it was when it fails, instead of swapping in the offline copy', async () => {
    const original = globalThis.fetch
    globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify(bundle), { status: 200 }))
    await appStore.init()
    const before = appStore.getState().snapshot
    expect(before?.source).toBe('bundle')

    globalThis.fetch = () => Promise.reject(new TypeError('Failed to fetch'))
    await appStore.reload(undefined, { quiet: true })
    const state = appStore.getState()
    globalThis.fetch = original

    expect(state.phase).toBe('ready')
    expect(state.error).toBeNull()
    expect(state.snapshot).toBe(before)
  })

  it('takes the newer data when it succeeds', async () => {
    const original = globalThis.fetch
    globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify(bundle), { status: 200 }))
    const before = appStore.getState().snapshot
    await appStore.reload(undefined, { quiet: true })
    globalThis.fetch = original

    expect(appStore.getState().snapshot).not.toBe(before)
    expect(appStore.getState().snapshot?.source).toBe('bundle')
  })
})
